package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_CreatePrivateChat_Idempotent(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+750")
	b := seedUser(t, pool, "+751")

	id1, err := s.CreatePrivateChat(ctx, a, b)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id2, err := s.CreatePrivateChat(ctx, b, a)
	if err != nil || id1 != id2 {
		t.Fatalf("expected same chat, got %d and %d (err %v)", id1, id2, err)
	}
	dialogs, _ := s.ListDialogs(ctx, a)
	if len(dialogs) != 1 {
		t.Fatalf("expected 1 dialog, got %d", len(dialogs))
	}
}
