package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func TestPresenceStore_RoundTrip(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	store := NewPresenceStore(rdb)
	const uid int64 = 7
	const ttl = 30 * time.Second

	// First SetOnlineNX transitions offline→online.
	set, err := store.SetOnlineNX(ctx, uid, ttl)
	if err != nil || !set {
		t.Fatalf("SetOnlineNX first: set=%v err=%v", set, err)
	}
	// Second is a no-op (already online).
	set, err = store.SetOnlineNX(ctx, uid, ttl)
	if err != nil || set {
		t.Fatalf("SetOnlineNX second: set=%v err=%v", set, err)
	}

	if online, err := store.IsOnline(ctx, uid); err != nil || !online {
		t.Fatalf("IsOnline: online=%v err=%v", online, err)
	}

	// Refresh on a live key returns true.
	if existed, err := store.Refresh(ctx, uid, ttl); err != nil || !existed {
		t.Fatalf("Refresh live: existed=%v err=%v", existed, err)
	}

	// Offline clears presence and records last-seen.
	const ls int64 = 123456789
	if err := store.SetOffline(ctx, uid, ls); err != nil {
		t.Fatalf("SetOffline: %v", err)
	}
	if online, err := store.IsOnline(ctx, uid); err != nil || online {
		t.Fatalf("IsOnline after offline: online=%v err=%v", online, err)
	}
	if got, err := store.LastSeen(ctx, uid); err != nil || got != ls {
		t.Fatalf("LastSeen: got=%d err=%v", got, err)
	}

	// Refresh on an expired/absent key returns false.
	if existed, err := store.Refresh(ctx, uid, ttl); err != nil || existed {
		t.Fatalf("Refresh absent: existed=%v err=%v", existed, err)
	}
}
