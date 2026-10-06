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

// Объявленный партнёрам дедлайн онлайна (userStatusOnline.expires последнего
// кадра) живёт ровно до себя и гаснет вместе с офлайном: снимок присутствия
// обязан обещать то же, что последний кадр, и не дольше.
func TestPresenceStore_AnnouncedExpires(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	store := NewPresenceStore(rdb)
	const uid int64 = 7

	if got, err := store.AnnouncedExpires(ctx, uid); err != nil || !got.IsZero() {
		t.Fatalf("до объявления: got=%v err=%v; want нулевое время", got, err)
	}

	deadline := time.Now().Add(90 * time.Second).Truncate(time.Millisecond)
	if err := store.Announce(ctx, uid, deadline); err != nil {
		t.Fatalf("Announce: %v", err)
	}
	if got, err := store.AnnouncedExpires(ctx, uid); err != nil || !got.Equal(deadline) {
		t.Fatalf("после объявления: got=%v err=%v; want %v", got, err, deadline)
	}
	if ttl := mr.TTL(announcedKey(uid)); ttl <= 0 || ttl > 90*time.Second {
		t.Fatalf("ключ объявления живёт %v; want до дедлайна (≤90 с)", ttl)
	}

	if err := store.SetOffline(ctx, uid, 1); err != nil {
		t.Fatalf("SetOffline: %v", err)
	}
	if got, err := store.AnnouncedExpires(ctx, uid); err != nil || !got.IsZero() {
		t.Fatalf("после офлайна: got=%v err=%v; want нулевое время", got, err)
	}
}

// Б-84: «N онлайн» — EXISTS по многим ключам, пачками.
func TestPresenceStore_CountOnline(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	store := NewPresenceStore(rdb)
	ids := make([]int64, 0, 2500)
	for id := int64(1); id <= 2500; id++ {
		ids = append(ids, id)
		if id%2 == 0 {
			if _, err := store.SetOnlineNX(ctx, id, time.Minute); err != nil {
				t.Fatal(err)
			}
		}
	}
	n, err := store.CountOnline(ctx, ids)
	if err != nil || n != 1250 {
		t.Fatalf("CountOnline = %d, %v; want 1250", n, err)
	}
	if n, _ := store.CountOnline(ctx, nil); n != 0 {
		t.Fatalf("пустой состав: %d", n)
	}
}

// Ревью #404 п. 8: кэш «N онлайн» чата живёт ttl.
func TestPresenceStore_OnlinesCache(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	store := NewPresenceStore(rdb)
	if _, ok, err := store.CachedOnlines(ctx, 5); err != nil || ok {
		t.Fatalf("пустой кэш: ok=%v err=%v", ok, err)
	}
	if err := store.CacheOnlines(ctx, 5, 7, time.Minute); err != nil {
		t.Fatal(err)
	}
	if n, ok, _ := store.CachedOnlines(ctx, 5); !ok || n != 7 {
		t.Fatalf("кэш: %d %v", n, ok)
	}
	mr.FastForward(2 * time.Minute)
	if _, ok, _ := store.CachedOnlines(ctx, 5); ok {
		t.Fatal("кэш пережил ttl")
	}
}

// Снимки присутствия пачки одним конвейером (ревью #405, №5).
func TestPresenceStore_Snapshots(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	store := NewPresenceStore(rdb)
	if _, err := store.SetOnlineNX(ctx, 1, time.Minute); err != nil {
		t.Fatal(err)
	}
	_ = store.SetOffline(ctx, 2, 1_700_000_000_000)
	snaps, err := store.Snapshots(ctx, []int64{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if !snaps[1].Online || snaps[1].Expires.IsZero() {
		t.Fatalf("онлайн: %+v", snaps[1])
	}
	if snaps[2].Online || snaps[2].LastSeen != 1_700_000_000_000 {
		t.Fatalf("офлайн: %+v", snaps[2])
	}
	if snaps[3].Online || snaps[3].LastSeen != 0 {
		t.Fatalf("неизвестный: %+v", snaps[3])
	}
}
