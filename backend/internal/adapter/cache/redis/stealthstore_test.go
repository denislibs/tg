package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestStealthStore_GetSet(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	store := NewStealthStore(rdb)
	ctx := context.Background()

	// Never activated → zero value, no error.
	got, err := store.Get(ctx, 7)
	if err != nil {
		t.Fatalf("Get(absent): %v", err)
	}
	if !got.ActiveUntil.IsZero() || !got.CooldownUntil.IsZero() {
		t.Fatalf("absent should be zero, got %+v", got)
	}

	active := time.Now().Add(25 * time.Minute).Truncate(time.Second)
	cooldown := time.Now().Add(time.Hour).Truncate(time.Second)
	if err := store.Set(ctx, 7, domain.StealthMode{ActiveUntil: active, CooldownUntil: cooldown}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err = store.Get(ctx, 7)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.ActiveUntil.Equal(active) || !got.CooldownUntil.Equal(cooldown) {
		t.Fatalf("roundtrip mismatch: got %+v want active=%v cooldown=%v", got, active, cooldown)
	}
}
