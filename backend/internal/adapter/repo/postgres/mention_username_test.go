package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// «@username» в тексте сообщения — непрочитанное упоминание адресата
// (Telegram unread_mentions_count), как text_mention. Имя сервер резолвит сам
// по users.username (CITEXT) среди участников чата: юзкейс Send поверх
// настоящих репозиториев, счётчик — колонка chat_members.
func TestSend_UsernameMention_UnreadMentionsCount(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	alice := seedUser(t, pool, "+79990000301")
	bob := seedUser(t, pool, "+79990000302")
	carol := seedUser(t, pool, "+79990000303")
	dave := seedUser(t, pool, "+79990000304") // не участник
	setUsername(t, pool, alice, "alice_ivanova")
	setUsername(t, pool, bob, "bob_petrov")
	setUsername(t, pool, carol, "carol_x")
	setUsername(t, pool, dave, "dave_out")

	groups := NewGroupRepo(pool)
	chatID := createGroupLike(t, pool, "group", alice)
	for _, uid := range []int64{bob, carol} {
		if err := groups.AddMember(ctx, chatID, uid, domain.RoleMember, 0); err != nil {
			t.Fatalf("add member %d: %v", uid, err)
		}
	}
	// Публичный чат в общем пространстве имён (0134) — не пользователь.
	if _, err := groups.CreateMultiMember(ctx, "channel", "ch", "", "public_chan", true, alice); err != nil {
		t.Fatalf("public channel: %v", err)
	}

	in := usecasechat.New(
		NewTxManager(pool),
		NewChatsRepo(pool),
		NewMessagesRepo(pool),
		NewUpdatesRepo(pool),
		NewReactionsRepo(pool),
		nil, groups, nil, nil, nil, nil,
	)

	m, err := in.Send(ctx, usecasechat.SendInput{
		ChatID: chatID, SenderID: alice, Type: "text",
		Text: "@Bob_Petrov тест упоминания, @alice_ivanova @dave_out @public_chan carol@carol_x.com",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	for uid, want := range map[int64]int{alice: 0, bob: 1, carol: 0} {
		if got := unreadMentions(t, pool, chatID, uid); got != want {
			t.Fatalf("user %d unread_mentions_count = %d, want %d", uid, got, want)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM message_mentions WHERE message_id=$1`, m.ID).Scan(&rows); err != nil {
		t.Fatalf("message_mentions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("message_mentions rows = %d, want 1 (только bob)", rows)
	}
	// Разметку сообщения сервер не трогает: @username размечает клиент на показе.
	var entities *string
	if err := pool.QueryRow(ctx, `SELECT entities::text FROM messages WHERE id=$1`, m.ID).Scan(&entities); err != nil {
		t.Fatalf("entities: %v", err)
	}
	if entities != nil && *entities != "[]" && *entities != "null" {
		t.Fatalf("entities = %s, want пусто", *entities)
	}

	// Прочтение чата снимает упоминание (существующая логика MarkRead).
	if err := in.MarkRead(ctx, chatID, bob, m.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if got := unreadMentions(t, pool, chatID, bob); got != 0 {
		t.Fatalf("after read unread_mentions_count = %d, want 0", got)
	}
}

func setUsername(t *testing.T, pool *pgxpool.Pool, userID int64, username string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET username=$2 WHERE id=$1`, userID, username); err != nil {
		t.Fatalf("set username %s: %v", username, err)
	}
}

func unreadMentions(t *testing.T, pool *pgxpool.Pool, chatID, userID int64) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT unread_mentions_count FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&n); err != nil {
		t.Fatalf("unread_mentions_count(%d): %v", userID, err)
	}
	return n
}

// Флаги и жизненный цикл упоминания поверх настоящих репозиториев: строка
// message_mentions переживает прочтение (mentioned), «непрочитано» —
// media_unread у адресата; ответ, правка и пересылка наполняют её так же, как
// отправка; readMessageContents гасит одно упоминание.
func TestMention_Lifecycle_Postgres(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	alice := seedUser(t, pool, "+79990000311")
	bob := seedUser(t, pool, "+79990000312")
	carol := seedUser(t, pool, "+79990000313")
	setUsername(t, pool, bob, "bob_petrov")
	setUsername(t, pool, carol, "carol_x")
	groups := NewGroupRepo(pool)
	chatID := createGroupLike(t, pool, "group", alice)
	for _, uid := range []int64{bob, carol} {
		if err := groups.AddMember(ctx, chatID, uid, domain.RoleMember, 0); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	chats := NewChatsRepo(pool)
	in := usecasechat.New(NewTxManager(pool), chats, NewMessagesRepo(pool), NewUpdatesRepo(pool),
		NewReactionsRepo(pool), nil, groups, nil, nil, nil, nil)
	flags := func(viewer int64, m domain.Message) map[string]bool {
		t.Helper()
		w, err := in.MessagesWire(ctx, viewer, []domain.Message{m})
		if err != nil {
			t.Fatalf("MessagesWire: %v", err)
		}
		return w[0].(domain.MessageReal).PFlags
	}
	want := func(step string, uid int64, n int) {
		t.Helper()
		if got := unreadMentions(t, pool, chatID, uid); got != n {
			t.Fatalf("%s: user %d unread_mentions_count = %d, want %d", step, uid, got, n)
		}
	}

	// 1. Ответ Алисы на сообщение Боба — упоминание Боба.
	orig, err := in.Send(ctx, usecasechat.SendInput{ChatID: chatID, SenderID: bob, Type: "text", Text: "вопрос"})
	if err != nil {
		t.Fatalf("orig: %v", err)
	}
	seq := orig.Seq
	reply, err := in.Send(ctx, usecasechat.SendInput{ChatID: chatID, SenderID: alice, Type: "text", Text: "ответ", ReplyToID: &seq})
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	want("ответ", bob, 1)
	want("ответ", carol, 0)
	if f := flags(bob, reply); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("ответ у Боба: pFlags = %v", f)
	}

	// 2. Правка: добавили @carol_x — Кэрол +1; убрали — снова 0.
	m, err := in.Send(ctx, usecasechat.SendInput{ChatID: chatID, SenderID: alice, Type: "text", Text: "без упоминаний"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if _, err := in.EditMessage(ctx, chatID, m.ID, alice, "теперь @carol_x", nil); err != nil {
		t.Fatalf("edit add: %v", err)
	}
	want("правка +", carol, 1)
	if _, err := in.EditMessage(ctx, chatID, m.ID, alice, "снова без", nil); err != nil {
		t.Fatalf("edit remove: %v", err)
	}
	want("правка −", carol, 0)

	// 3. Пересылка текста с @bob_petrov в группу — Бобу +1.
	priv := createPrivate(t, pool, alice, carol)
	src, err := in.Send(ctx, usecasechat.SendInput{ChatID: priv, SenderID: alice, Type: "text", Text: "@bob_petrov глянь"})
	if err != nil {
		t.Fatalf("src: %v", err)
	}
	fwd, err := in.ForwardMessages(ctx, usecasechat.ForwardInput{FromChatID: priv, ToChatID: chatID, MsgIDs: []int64{src.ID}, SenderID: alice})
	if err != nil || len(fwd) != 1 {
		t.Fatalf("forward: %v %v", fwd, err)
	}
	want("пересылка", bob, 2)

	// 4. Прочтение содержимого ответа — Бобу −1, mentioned остаётся.
	if err := in.ReadMedia(ctx, chatID, bob, reply.ID); err != nil {
		t.Fatalf("ReadMedia: %v", err)
	}
	want("readMessageContents", bob, 1)
	if f := flags(bob, reply); !f["mentioned"] || f["media_unread"] {
		t.Fatalf("ответ у Боба после прочтения: pFlags = %v", f)
	}
	if seqNext, err := chats.NextMention(ctx, chatID, bob, 0); err != nil || seqNext != fwd[0].Seq {
		t.Fatalf("NextMention = %d %v, want %d (прочитанное пропущено)", seqNext, err, fwd[0].Seq)
	}

	// 5. Прочтение чата — счётчик 0, строки остались (mentioned в истории).
	if err := in.MarkRead(ctx, chatID, bob, fwd[0].Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	want("прочтение чата", bob, 0)
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_mentions WHERE chat_id=$1 AND user_id=$2`, chatID, bob).Scan(&rows); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if rows != 2 {
		t.Fatalf("строк упоминаний Боба = %d, want 2 (прочтение строку не удаляет)", rows)
	}
	if f := flags(bob, fwd[0]); !f["mentioned"] || f["media_unread"] {
		t.Fatalf("пересланное у Боба после прочтения: pFlags = %v", f)
	}
}
