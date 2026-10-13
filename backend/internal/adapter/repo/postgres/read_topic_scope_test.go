package postgres

import (
	"context"
	"slices"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф-6, задача 18: ReadReactionsIn и ClearMentionsIn сужаются темой форума теми
// же предикатами, что строки списка тем (threadFilter/generalMember).
func TestChatsRepo_ReadInTopicScope(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	reacts := NewReactionsRepo(pool)
	topics := NewTopicsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7700")
	b := seedUser(t, pool, "+7701")
	chatID := createGroupLike(t, pool, "group", a)
	if _, err := pool.Exec(ctx, `UPDATE chats SET is_forum = true WHERE id = $1`, chatID); err != nil {
		t.Fatal(err)
	}
	if err := NewGroupRepo(pool).AddMember(ctx, chatID, b, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := topics.EnsureGeneralTopic(ctx, chatID, a); err != nil {
		t.Fatal(err)
	}
	msgs := NewMessagesRepo(pool)
	service := func() int64 {
		var id int64
		seq, _ := msgs.NextSeq(ctx, chatID)
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,$2,$3,'service','t') RETURNING id`,
			chatID, seq, a).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	rootA, rootB := service(), service()
	for _, root := range []int64{rootA, rootB} {
		if _, err := topics.Create(ctx, domain.ForumTopicRecord{ChatID: chatID, RootMsgID: root, Title: "t", CreatedBy: a}); err != nil {
			t.Fatal(err)
		}
	}
	post := func(root *int64) domain.Message {
		seq, _ := msgs.NextSeq(ctx, chatID)
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x", ThreadRootID: root})
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	mA, mB, mG, mB2 := post(&rootA), post(&rootB), post(nil), post(&rootB)
	for _, m := range []domain.Message{mA, mB, mG, mB2} {
		if err := reacts.Add(ctx, m.ID, b, "❤", true); err != nil {
			t.Fatal(err)
		}
		if err := chats.AddMention(ctx, chatID, m.ID, m.Seq, a); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := chats.RecountUnreadReactions(ctx, chatID, a); err != nil {
		t.Fatal(err)
	}
	ids := func(ms []domain.Message) []int64 {
		out := make([]int64, len(ms))
		for n, m := range ms {
			out[n] = m.ID
		}
		return out
	}

	// ❤: тема A — только mA; остальные остаются.
	got, more, err := chats.ReadReactionsIn(ctx, chatID, a, &domain.TopicScope{RootID: rootA}, 100)
	if err != nil || more || !slices.Equal(ids(got), []int64{mA.ID}) {
		t.Fatalf("тема A: %v more=%v err=%v; want [%d]", ids(got), more, err, mA.ID)
	}
	if _, _, r := memberCounters(t, pool, chatID, a); r != 3 {
		t.Fatalf("после темы A unread_reactions = %d, want 3", r)
	}
	// General — сообщения вне тем.
	got, _, err = chats.ReadReactionsIn(ctx, chatID, a, &domain.TopicScope{General: true}, 100)
	if err != nil || !slices.Equal(ids(got), []int64{mG.ID}) {
		t.Fatalf("General: %v err=%v; want [%d]", ids(got), err, mG.ID)
	}
	// Весь чат с пределом 1: одно сообщение и остаток.
	got, more, err = chats.ReadReactionsIn(ctx, chatID, a, nil, 1)
	if err != nil || !more || !slices.Equal(ids(got), []int64{mB.ID}) {
		t.Fatalf("предел: %v more=%v err=%v; want [%d] и остаток", ids(got), more, err, mB.ID)
	}
	got, more, err = chats.ReadReactionsIn(ctx, chatID, a, nil, 100)
	if err != nil || more || !slices.Equal(ids(got), []int64{mB2.ID}) {
		t.Fatalf("остаток: %v more=%v err=%v; want [%d]", ids(got), more, err, mB2.ID)
	}
	if got, more, _ = chats.ReadReactionsIn(ctx, chatID, a, nil, 100); len(got) != 0 || more {
		t.Fatalf("повтор снял ещё %v", ids(got))
	}

	// «@»: те же срезы.
	cleared, more, err := chats.ClearMentionsIn(ctx, chatID, a, &domain.TopicScope{RootID: rootA}, 100)
	if err != nil || more || !slices.Equal(cleared, []int64{mA.Seq}) {
		t.Fatalf("@ тема A: %v more=%v err=%v; want [%d]", cleared, more, err, mA.Seq)
	}
	if _, m, _ := memberCounters(t, pool, chatID, a); m != 3 {
		t.Fatalf("после темы A unread_mentions_count = %d, want 3", m)
	}
	cleared, _, err = chats.ClearMentionsIn(ctx, chatID, a, &domain.TopicScope{General: true}, 100)
	if err != nil || !slices.Equal(cleared, []int64{mG.Seq}) {
		t.Fatalf("@ General: %v err=%v; want [%d]", cleared, err, mG.Seq)
	}
	cleared, more, err = chats.ClearMentionsIn(ctx, chatID, a, nil, 1)
	if err != nil || !more || !slices.Equal(cleared, []int64{mB.Seq}) {
		t.Fatalf("@ предел: %v more=%v err=%v; want [%d] и остаток", cleared, more, err, mB.Seq)
	}
	cleared, more, err = chats.ClearMentionsIn(ctx, chatID, a, nil, 100)
	if err != nil || more || !slices.Equal(cleared, []int64{mB2.Seq}) {
		t.Fatalf("@ остаток: %v more=%v err=%v; want [%d]", cleared, more, err, mB2.Seq)
	}
	if _, m, _ := memberCounters(t, pool, chatID, a); m != 0 {
		t.Fatalf("в конце unread_mentions_count = %d, want 0", m)
	}
}
