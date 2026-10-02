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
