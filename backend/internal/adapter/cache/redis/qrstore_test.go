package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestQRStore_PutGetDelete(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	store := NewQRStore(rdb)
	ctx := context.Background()

	rec := domain.QRLogin{Status: domain.QRPending, Platform: "web", CreatedAt: time.Now()}
	if err := store.Put(ctx, "hash1", rec, time.Minute); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := store.Get(ctx, "hash1")
	if err != nil || got.Status != domain.QRPending || got.Platform != "web" {
		t.Fatalf("Get: %+v err=%v", got, err)
	}
	// Unknown key → ErrNotFound.
	if _, err := store.Get(ctx, "nope"); err != domain.ErrNotFound {
		t.Fatalf("Get unknown: got %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, "hash1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := store.Get(ctx, "hash1"); err != domain.ErrNotFound {
		t.Fatalf("Get after delete: got %v, want ErrNotFound", err)
	}
}
