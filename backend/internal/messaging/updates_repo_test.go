package messaging

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestUpdatesRepo_AppendAndSince(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewUpdatesRepo()
	ctx := context.Background()
	u := seedUser(t, pool, "+740")

	s, _ := repo.GetUserState(ctx, pool, u)
	if s.Pts != 0 {
		t.Fatalf("initial pts = %d, want 0", s.Pts)
	}

	p1, err := repo.AppendUpdate(ctx, pool, u, 1, 100, "new_message", json.RawMessage(`{"a":1}`))
	if err != nil || p1 != 1 {
		t.Fatalf("AppendUpdate 1 = %d, %v", p1, err)
	}
	p2, _ := repo.AppendUpdate(ctx, pool, u, 1, 101, "read", json.RawMessage(`{"b":2}`))
	if p2 != 2 {
		t.Fatalf("AppendUpdate 2 = %d, want 2", p2)
	}

	state, _ := repo.GetUserState(ctx, pool, u)
	if state.Pts != 2 || state.Date != 101 {
		t.Fatalf("state = %+v, want pts=2 date=101", state)
	}

	ups, err := repo.UpdatesSince(ctx, pool, u, 0, 10)
	if err != nil || len(ups) != 2 || ups[0].Pts != 1 || ups[1].Type != "read" {
		t.Fatalf("UpdatesSince = %+v, %v", ups, err)
	}
	tail, _ := repo.UpdatesSince(ctx, pool, u, 1, 10)
	if len(tail) != 1 || tail[0].Pts != 2 {
		t.Fatalf("tail = %+v", tail)
	}
}
