package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
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
	a, err := r.Create(ctx, domain.ForumTopic{ChatID: chat, RootMsgID: 0, Title: "Alpha", IconColor: 1, CreatedBy: user})
	if err != nil {
		t.Fatalf("create Alpha: %v", err)
	}
	b, err := r.Create(ctx, domain.ForumTopic{ChatID: chat, RootMsgID: 0, Title: "Beta", IconEmoji: "🔥", CreatedBy: user})
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

	// Edit + Hidden.
	if err := r.EditTopic(ctx, b.ID, "Beta2", "🚀", 3); err != nil {
		t.Fatalf("EditTopic: %v", err)
	}
	if err := r.SetHidden(ctx, b.ID, true); err != nil {
		t.Fatalf("SetHidden: %v", err)
	}
	got, err := r.ByID(ctx, b.ID)
	if err != nil || got.Title != "Beta2" || got.IconEmoji != "🚀" || got.IconColor != 3 || !got.Hidden {
		t.Fatalf("after edit/hide: %+v, %v", got, err)
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

	// Тема с root_msg_id = сервисное сообщение (seq 1).
	var rootID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'service','created') RETURNING id`,
		chat, me).Scan(&rootID); err != nil {
		t.Fatalf("seed root msg: %v", err)
	}
	topic, err := r.Create(ctx, domain.ForumTopic{ChatID: chat, RootMsgID: rootID, Title: "Topic", CreatedBy: me})
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
	// своё (seq 3) не считается; last_out=true (последнее — от me), last_seq=3.
	list, err := r.ListByChat(ctx, chat, me)
	if err != nil {
		t.Fatalf("ListByChat: %v", err)
	}
	row := find(list)
	if row.UnreadCount != 1 {
		t.Fatalf("unread before read = %d; want 1", row.UnreadCount)
	}
	if !row.LastOut {
		t.Fatalf("last_out want true (last msg from me)")
	}
	if row.LastMsgSeq != 3 {
		t.Fatalf("last_seq = %d; want 3", row.LastMsgSeq)
	}
	if row.Muted {
		t.Fatalf("muted want false by default")
	}

	// MarkTopicRead до seq 3 → unread=0.
	if err := r.SetTopicRead(ctx, chat, rootID, me, 3); err != nil {
		t.Fatalf("SetTopicRead: %v", err)
	}
	row = find(mustList(t, r, chat, me))
	if row.UnreadCount != 0 {
		t.Fatalf("unread after read = %d; want 0", row.UnreadCount)
	}
	// GREATEST: повторная пометка меньшим seq не откатывает.
	if err := r.SetTopicRead(ctx, chat, rootID, me, 1); err != nil {
		t.Fatalf("SetTopicRead lower: %v", err)
	}
	if find(mustList(t, r, chat, me)).UnreadCount != 0 {
		t.Fatalf("unread must stay 0 after lower read")
	}

	// mute-тоггл.
	if err := r.SetTopicMuted(ctx, chat, rootID, me, true); err != nil {
		t.Fatalf("SetTopicMuted on: %v", err)
	}
	if !find(mustList(t, r, chat, me)).Muted {
		t.Fatalf("muted want true after mute")
	}
	if err := r.SetTopicMuted(ctx, chat, rootID, me, false); err != nil {
		t.Fatalf("SetTopicMuted off: %v", err)
	}
	if find(mustList(t, r, chat, me)).Muted {
		t.Fatalf("muted want false after unmute")
	}

	// Со стороны other: последнее сообщение — от me → last_out=false; своё seq3
	// прочитано? нет — other ничего не читал, чужие для него = seq1(service? нет,
	// service не в треде) + seq3(me). unread для other считает seq2(own→нет)+seq3(me)=1.
	_ = meMsg
	rowOther := find(mustList(t, r, chat, other))
	if rowOther.LastOut {
		t.Fatalf("last_out for other want false")
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
