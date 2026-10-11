package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

func TestTopicsRepo_GeneralPinEditOrder(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewTopicsRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7912")

	var chat int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, is_forum) VALUES ('group', true) RETURNING id`).Scan(&chat); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	// EnsureGeneralTopic идемпотентна: повторный вызов возвращает ту же тему.
	g1, err := r.EnsureGeneralTopic(ctx, chat, user)
	if err != nil || !g1.IsGeneral || g1.Title != "General" {
		t.Fatalf("EnsureGeneralTopic: %+v, %v", g1, err)
	}
	g2, err := r.EnsureGeneralTopic(ctx, chat, user)
	if err != nil || g2.ID != g1.ID {
		t.Fatalf("EnsureGeneralTopic not idempotent: %+v vs %+v (%v)", g2, g1, err)
	}

	// Две обычные темы.
	a, err := r.Create(ctx, domain.ForumTopicRecord{ChatID: chat, RootMsgID: 0, Title: "Alpha", IconColor: 1, CreatedBy: user})
	if err != nil {
		t.Fatalf("create Alpha: %v", err)
	}
	b, err := r.Create(ctx, domain.ForumTopicRecord{ChatID: chat, RootMsgID: 0, Title: "Beta", IconEmoji: "🔥", CreatedBy: user})
	if err != nil {
		t.Fatalf("create Beta: %v", err)
	}

	// Закрепляем Alpha — должна идти сразу после General.
	if err := r.SetPinned(ctx, a.ID, true); err != nil {
		t.Fatalf("SetPinned: %v", err)
	}
	list, err := r.ListByChat(ctx, chat, user)
	if err != nil || len(list) != 3 {
		t.Fatalf("ListByChat: %d rows, %v", len(list), err)
	}
	if !list[0].Topic.IsGeneral {
		t.Fatalf("General must be first, got %+v", list[0].Topic)
	}
	if list[1].Topic.ID != a.ID || !list[1].Topic.Pinned {
		t.Fatalf("pinned Alpha must be second, got %+v", list[1].Topic)
	}
	if list[2].Topic.ID != b.ID {
		t.Fatalf("Beta must be last, got %+v", list[2].Topic)
	}
	if list[2].Topic.IconEmoji != "🔥" {
		t.Fatalf("Beta emoji not persisted: %q", list[2].Topic.IconEmoji)
	}

	// Правка одной записью: название, значок, скрытие (цвет не правится — у
	// messages.editForumTopic его нет).
	title, emoji, hidden := "Beta2", "🚀", true
	if err := r.Update(ctx, b.ID, domain.MessageActionTopicEdit{Title: &title, IconEmojiEmoticon: &emoji, Hidden: &hidden}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	list = mustList(t, r, chat, user)
	if list[2].Topic.Title != "Beta2" || list[2].Topic.IconEmoji != "🚀" || !list[2].Topic.Hidden {
		t.Fatalf("after edit/hide: %+v", list[2].Topic)
	}
	// Ревью п. 5: правка одного поля не трогает остальные — параллельная
	// правка (закрыли тему) не затирается снимком другой правки.
	closed := true
	if err := r.Update(ctx, b.ID, domain.MessageActionTopicEdit{Closed: &closed}); err != nil {
		t.Fatal(err)
	}
	title2 := "Beta3"
	if err := r.Update(ctx, b.ID, domain.MessageActionTopicEdit{Title: &title2}); err != nil {
		t.Fatal(err)
	}
	list = mustList(t, r, chat, user)
	if got := list[2].Topic; got.Title != "Beta3" || !got.Closed || !got.Hidden || got.IconEmoji != "🚀" {
		t.Fatalf("правка названия затёрла другие поля: %+v", got)
	}
}

// TestTopicsRepo_ReadStateMuteUnread покрывает per-topic dialog-состояние:
// unread (чужое сообщение считается, своё — нет), MarkTopicRead → 0, mute-тоггл,
// last_out по последнему сообщению.
func TestTopicsRepo_ReadStateMuteUnread(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewTopicsRepo(pool)
	ctx := context.Background()
	me := seedUser(t, pool, "+7900")
	other := seedUser(t, pool, "+7901")

	var chat int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, is_forum) VALUES ('group', true) RETURNING id`).Scan(&chat); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	for _, u := range []int64{me, other} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')`, chat, u); err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}

	// Тема с root_msg_id = сервисное сообщение (seq 1).
	var rootID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'service','created') RETURNING id`,
		chat, me).Scan(&rootID); err != nil {
		t.Fatalf("seed root msg: %v", err)
	}
	topic, err := r.Create(ctx, domain.ForumTopicRecord{ChatID: chat, RootMsgID: rootID, Title: "Topic", CreatedBy: me})
	if err != nil {
		t.Fatalf("create topic: %v", err)
	}

	// Ответ в теме от other (seq 2) и от me (seq 3, последнее → last_out).
	seedThreadMsg := func(seq, sender int64) int64 {
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,$2,$3,'text','hi',$4) RETURNING id`,
			chat, seq, sender, rootID).Scan(&id); err != nil {
			t.Fatalf("seed thread msg: %v", err)
		}
		return id
	}
	_ = seedThreadMsg(2, other)
	meMsg := seedThreadMsg(3, me)

	find := func(list []domain.TopicRow) domain.TopicRow {
		for _, row := range list {
			if row.Topic.ID == topic.ID {
				return row
			}
		}
		t.Fatalf("topic %d not in list", topic.ID)
		return domain.TopicRow{}
	}

	// До прочтения: только чужое сообщение (seq 2) непрочитано → unread=1,
	// своё (seq 3) не считается. Последнее сообщение выдаётся ССЫЛКОЙ — ключ
	// строки плюс номер в чате; «моё ли оно» выводит клиент из самого
	// сообщения, серверного last_out больше нет.
	list, err := r.ListByChat(ctx, chat, me)
	if err != nil {
		t.Fatalf("ListByChat: %v", err)
	}
	row := find(list)
	if row.UnreadCount != 1 {
		t.Fatalf("unread before read = %d; want 1", row.UnreadCount)
	}
	if row.LastMsgID != meMsg {
		t.Fatalf("last_msg_id = %d; want %d", row.LastMsgID, meMsg)
	}
	if row.LastMsgSeq != 3 {
		t.Fatalf("last_seq = %d; want 3", row.LastMsgSeq)
	}
	if row.LastReadSeq != 0 {
		t.Fatalf("read_inbox_max_id before read = %d; want 0", row.LastReadSeq)
	}
	if row.MuteUntil != nil {
		t.Fatalf("mute_until want nil by default, got %v", row.MuteUntil)
	}

	// MarkTopicRead до seq 3 → unread=0.
	if err := r.SetTopicRead(ctx, chat, rootID, me, 3); err != nil {
		t.Fatalf("SetTopicRead: %v", err)
	}
	row = find(mustList(t, r, chat, me))
	if row.UnreadCount != 0 {
		t.Fatalf("unread after read = %d; want 0", row.UnreadCount)
	}
	// Горизонт чтения зрителя едет наружу (read_inbox_max_id конструктора).
	if row.LastReadSeq != 3 {
		t.Fatalf("read_inbox_max_id after read = %d; want 3", row.LastReadSeq)
	}
	// GREATEST: повторная пометка меньшим seq не откатывает.
	if err := r.SetTopicRead(ctx, chat, rootID, me, 1); err != nil {
		t.Fatalf("SetTopicRead lower: %v", err)
	}
	if find(mustList(t, r, chat, me)).UnreadCount != 0 {
		t.Fatalf("unread must stay 0 after lower read")
	}

	// Мьют — СРОК: ставится, читается; «снять» — явный ноль, а не NULL
	// (NULL — тему не трогали, наследует чат: три состояния).
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	if err := r.SetTopicMuteUntil(ctx, chat, rootID, me, until); err != nil {
		t.Fatalf("SetTopicMuteUntil on: %v", err)
	}
	if got := find(mustList(t, r, chat, me)).MuteUntil; got == nil || !got.Equal(until) {
		t.Fatalf("mute_until = %v, want %v", got, until)
	}
	if err := r.SetTopicMuteUntil(ctx, chat, rootID, me, time.Unix(0, 0)); err != nil {
		t.Fatalf("SetTopicMuteUntil off: %v", err)
	}
	if got := find(mustList(t, r, chat, me)).MuteUntil; got == nil || got.Unix() != 0 {
		t.Fatalf("mute_until after explicit unmute = %v, want 0", got)
	}
	if got := find(mustList(t, r, chat, other)).MuteUntil; got != nil {
		t.Fatalf("нетронутая тема у other: mute_until = %v, want nil", got)
	}

	// A1-19: read_outbox_max_id — горизонт ОСТАЛЬНЫХ. me прочитал до 3, значит
	// у other ✓✓ до 3; у самого me остальные (other) не читали — 0.
	if got := find(mustList(t, r, chat, other)).ReadOutboxSeq; got != 3 {
		t.Fatalf("read_outbox для other = %d, want 3", got)
	}
	if got := find(mustList(t, r, chat, me)).ReadOutboxSeq; got != 0 {
		t.Fatalf("read_outbox для me = %d, want 0", got)
	}

	// Со стороны other: ссылка на последнее сообщение ОДНА И ТА ЖЕ (она не
	// зависит от зрителя), а состояние чтения — своё. other ничего не читал,
	// чужие для него seq2(own→нет)+seq3(me) = 1.
	rowOther := find(mustList(t, r, chat, other))
	if rowOther.LastMsgID != meMsg || rowOther.LastMsgSeq != 3 {
		t.Fatalf("ссылка на последнее для other = %d/%d; want %d/3", rowOther.LastMsgID, rowOther.LastMsgSeq, meMsg)
	}
	if rowOther.UnreadCount != 1 {
		t.Fatalf("unread for other = %d; want 1 (seq3 from me)", rowOther.UnreadCount)
	}
}

func mustList(t *testing.T, r *TopicsRepo, chat, user int64) []domain.TopicRow {
	t.Helper()
	list, err := r.ListByChat(context.Background(), chat, user)
	if err != nil {
		t.Fatalf("ListByChat: %v", err)
	}
	return list
}

// Ф-5, п. 1 и п. 5: General — номер 1 и выборка «без треда, кроме служебок
// создания тем»; тема — номер своей служебки создания; A1-19 — непрочитанные
// реакции темы.
func TestTopicsRepo_GeneralAndNumbers(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewTopicsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	me := seedUser(t, pool, "+7930")
	other := seedUser(t, pool, "+7931")

	var chat int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, is_forum) VALUES ('group', true) RETURNING id`).Scan(&chat); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	for _, u := range []int64{me, other} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')`, chat, u); err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}
	general, err := r.EnsureGeneralTopic(ctx, chat, me)
	if err != nil {
		t.Fatal(err)
	}
	insert := func(seq, sender int64, typ string, root *int64) int64 {
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,$2,$3,$4,'x',$5) RETURNING id`,
			chat, seq, sender, typ, root).Scan(&id); err != nil {
			t.Fatalf("seed msg %d: %v", seq, err)
		}
		return id
	}
	_ = insert(1, me, "service", nil) // служебка создания чата
	topicRoot := insert(2, me, "service", nil)
	topic, err := r.Create(ctx, domain.ForumTopicRecord{ChatID: chat, RootMsgID: topicRoot, Title: "Тема", CreatedBy: me})
	if err != nil {
		t.Fatal(err)
	}
	inTopic := insert(3, me, "text", &topicRoot)
	generalMsg := insert(4, other, "text", nil)
	if _, err := pool.Exec(ctx,
		`INSERT INTO message_mentions (chat_id, message_id, seq, user_id) VALUES ($1,$2,4,$3)`, chat, generalMsg, me); err != nil {
		t.Fatal(err)
	}
	// Непрочитанная реакция other на МОЁ сообщение в теме.
	if _, err := pool.Exec(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji, unread) VALUES ($1,$2,'👍',true)`, inTopic, other); err != nil {
		t.Fatal(err)
	}
	// Счётчики чата — их ведут штатные пути (вставка упоминания, реакция);
	// счётчики тем — подмножество, при нуле в чате не считаются.
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET unread_mentions_count = 1, unread_reactions = 1 WHERE chat_id=$1 AND user_id=$2`, chat, me); err != nil {
		t.Fatal(err)
	}

	byID := map[int64]domain.TopicRow{}
	for _, row := range mustList(t, r, chat, me) {
		byID[row.Topic.ID] = row
	}
	g := byID[general.ID]
	if g.Topic.Number() != domain.GeneralTopicID {
		t.Fatalf("номер General = %d", g.Topic.Number())
	}
	if g.LastMsgSeq != 4 || g.UnreadCount != 1 || g.UnreadMentions != 1 {
		t.Fatalf("General: top=%d unread=%d mentions=%d; want 4/1/1 (служебка темы seq 2 и сообщение темы — не General)",
			g.LastMsgSeq, g.UnreadCount, g.UnreadMentions)
	}
	tp := byID[topic.ID]
	if tp.Topic.Number() != 2 || tp.LastMsgSeq != 3 || tp.UnreadReactions != 1 {
		t.Fatalf("тема: number=%d top=%d reactions=%d; want 2/3/1", tp.Topic.Number(), tp.LastMsgSeq, tp.UnreadReactions)
	}
	if got := byID[topic.ID]; got.UnreadMentions != 0 || got.UnreadCount != 0 {
		t.Fatalf("тема: чужое упоминание General попало в тему: %+v", got)
	}

	// Адресация номером: 1 — General, номер служебки — тема, ключ строки — нет.
	if got, err := r.ByNumber(ctx, chat, domain.GeneralTopicID); err != nil || got.ID != general.ID {
		t.Fatalf("ByNumber(1) = %+v, %v; want General", got, err)
	}
	if got, err := r.ByNumber(ctx, chat, 2); err != nil || got.ID != topic.ID || got.RootMsgSeq != 2 {
		t.Fatalf("ByNumber(2) = %+v, %v; want тема", got, err)
	}
	if _, err := r.ByNumber(ctx, chat, 3); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ByNumber(сообщение не-служебка) = %v; want ErrNotFound", err)
	}

	roots, err := r.TopicRoots(ctx, []int64{topicRoot, generalMsg, 0})
	if err != nil || !roots[topicRoot] || len(roots) != 1 {
		t.Fatalf("TopicRoots = %v, %v", roots, err)
	}

	// История General через страж: служебка создания чата и сообщение без
	// треда — да; служебка темы и сообщение темы — нет.
	root := domain.GeneralThreadRoot
	hist, err := msgs.GetHistory(ctx, chat, me, 0, 0, 50, &root, "")
	if err != nil {
		t.Fatal(err)
	}
	var seqs []int64
	for _, m := range hist {
		seqs = append(seqs, m.Seq)
	}
	if len(seqs) != 2 || seqs[0] != 4 || seqs[1] != 1 {
		t.Fatalf("история General = %v; want [4 1]", seqs)
	}
	if n, err := msgs.CountThread(ctx, chat, domain.GeneralThreadRoot); err != nil || n != 2 {
		t.Fatalf("CountThread(General) = %d, %v; want 2", n, err)
	}
	around, err := msgs.GetAround(ctx, chat, me, 4, 10, &root)
	if err != nil || len(around) != 2 {
		t.Fatalf("GetAround(General) = %d msgs, %v; want 2", len(around), err)
	}
	// Обычный тред — прежний: корень и его ответы.
	hist, err = msgs.GetHistory(ctx, chat, me, 0, 0, 50, &topicRoot, "")
	if err != nil || len(hist) != 2 {
		t.Fatalf("история темы = %d msgs, %v; want 2", len(hist), err)
	}

	// Ревью п. 4: горизонт General при деплое — записи темы нет, действует
	// горизонт чата (прочитано всё до него, General в том числе).
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET last_read_seq = 4 WHERE chat_id=$1 AND user_id=$2`, chat, me); err != nil {
		t.Fatal(err)
	}
	for _, row := range mustList(t, r, chat, me) {
		if row.Topic.IsGeneral && (row.UnreadCount != 0 || row.UnreadMentions != 0 || row.LastReadSeq != 4) {
			t.Fatalf("General после горизонта чата 4: unread=%d mentions=%d read=%d; want 0/0/4",
				row.UnreadCount, row.UnreadMentions, row.LastReadSeq)
		}
	}
	// read_outbox у other — горизонт чата me: и у General, и у обычной темы
	// (✓✓ — максимум входящих горизонтов остальных).
	for _, row := range mustList(t, r, chat, other) {
		if row.ReadOutboxSeq != 4 {
			t.Fatalf("read_outbox у other (тема %d) = %d; want 4", row.Topic.Number(), row.ReadOutboxSeq)
		}
	}
	// Обычная тема: горизонт чата other гасит её непрочитанное без записи темы.
	if got := byNumber(t, r, chat, other, 2); got.UnreadCount != 1 {
		t.Fatalf("тема у other до горизонта чата: unread = %d; want 1", got.UnreadCount)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET last_read_seq = 3 WHERE chat_id=$1 AND user_id=$2`, chat, other); err != nil {
		t.Fatal(err)
	}
	if got := byNumber(t, r, chat, other, 2); got.UnreadCount != 0 || got.LastReadSeq != 3 {
		t.Fatalf("тема у other после горизонта чата 3: unread=%d read=%d; want 0/3", got.UnreadCount, got.LastReadSeq)
	}
	// Читатель публичного форума без вступления: непрочитанного нет.
	stranger := seedUser(t, pool, "+7932")
	for _, row := range mustList(t, r, chat, stranger) {
		if row.UnreadCount != 0 {
			t.Fatalf("не участник: unread темы %d = %d; want 0", row.Topic.Number(), row.UnreadCount)
		}
	}

	// Медиа и счётчики поиска General: фото без треда — да, фото темы — нет.
	_ = insert(5, other, "photo", nil)
	_ = insert(6, other, "photo", &topicRoot)
	media, count, err := msgs.MediaHistory(ctx, chat, me, "media", usecasechat.MediaPage{Limit: 50, ThreadRoot: &root})
	if err != nil || count != 1 || len(media) != 1 || media[0].Seq != 5 {
		t.Fatalf("MediaHistory(General) = %d msgs, count %d, %v; want [5]", len(media), count, err)
	}
	media, count, err = msgs.MediaHistory(ctx, chat, me, "media", usecasechat.MediaPage{Limit: 50, ThreadRoot: &topicRoot})
	if err != nil || count != 1 || len(media) != 1 || media[0].Seq != 6 {
		t.Fatalf("MediaHistory(тема) = %d msgs, count %d, %v; want [6]", len(media), count, err)
	}
	counters, err := msgs.SearchCounters(ctx, chat, me, []string{"media"}, &root)
	if err != nil || counters["media"] != 1 {
		t.Fatalf("SearchCounters(General) = %v, %v; want media=1", counters, err)
	}
	all, err := msgs.SearchCounters(ctx, chat, me, []string{"media"}, nil)
	if err != nil || all["media"] != 2 {
		t.Fatalf("SearchCounters(чат) = %v, %v; want media=2", all, err)
	}
	// /threads General (ListThread) — только сообщения General, без корня.
	thread, err := msgs.ListThread(ctx, chat, me, domain.GeneralThreadRoot, 0, 50)
	if err != nil || len(thread) != 3 {
		t.Fatalf("ListThread(General) = %d msgs, %v; want 3 (seq 1, 4, 5)", len(thread), err)
	}
	// Тред, корень которого не тема (накоплен до включения тем, комментарии
	// к посту), — в General: у сообщения нет forum_topic (tweb
	// getMessageThreadId.ts:17-23).
	_ = insert(7, other, "text", &generalMsg)
	hist, err = msgs.GetHistory(ctx, chat, me, 0, 0, 50, &root, "")
	if err != nil || len(hist) == 0 || hist[0].Seq != 7 {
		t.Fatalf("история General без сообщения не-темного треда: %v, %v", hist, err)
	}
	if got := byNumber(t, r, chat, me, domain.GeneralTopicID); got.LastMsgSeq != 7 {
		t.Fatalf("top_message General = %d; want 7", got.LastMsgSeq)
	}
	if got := byNumber(t, r, chat, me, 2); got.LastMsgSeq == 7 {
		t.Fatal("сообщение не-темного треда попало в тему")
	}
}

func byNumber(t *testing.T, r *TopicsRepo, chat, user, number int64) domain.TopicRow {
	t.Helper()
	for _, row := range mustList(t, r, chat, user) {
		if row.Topic.Number() == number {
			return row
		}
	}
	t.Fatalf("темы %d нет в списке", number)
	return domain.TopicRow{}
}
