package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// VA2-03: флаг звонка в строках списка и карточках спрашивает эфиры пачкой —
// один SELECT по первичному ключу, только активные.
func TestLivestreamRepo_ActiveAmong(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7610")
	live := createGroupLike(t, pool, "channel", owner)
	idle := createGroupLike(t, pool, "channel", owner)
	never := createGroupLike(t, pool, "channel", owner)
	r := NewLivestreamRepo(pool)

	if err := r.Upsert(ctx, domain.Livestream{ChatID: live, StreamKey: "k1", Active: true}); err != nil {
		t.Fatal(err)
	}
	if err := r.Upsert(ctx, domain.Livestream{ChatID: idle, StreamKey: "k2"}); err != nil {
		t.Fatal(err)
	}

	got, err := r.ActiveAmong(ctx, []int64{live, idle, never})
	if err != nil {
		t.Fatalf("ActiveAmong: %v", err)
	}
	if len(got) != 1 || !got[live] {
		t.Fatalf("ActiveAmong = %v, want только %d", got, live)
	}
	if empty, err := r.ActiveAmong(ctx, nil); err != nil || len(empty) != 0 {
		t.Fatalf("пустой вопрос: %v %v", empty, err)
	}
}
