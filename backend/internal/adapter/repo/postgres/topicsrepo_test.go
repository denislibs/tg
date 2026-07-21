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
	list, err := r.ListByChat(ctx, chat)
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
