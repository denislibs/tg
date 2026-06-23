package redisstore

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/auth"
)

func TestSessionCache_RoundTrip(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	c, _ := Connect(context.Background(), "redis://"+mr.Addr())
	defer c.Close()
	cache := NewSessionCache(c)
	ctx := context.Background()

	// Miss returns (nil, nil).
	got, err := cache.GetSession(ctx, "h1")
	if err != nil || got != nil {
		t.Fatalf("miss = %v, %v; want nil,nil", got, err)
	}

	want := auth.CachedSession{User: auth.User{ID: 7, Phone: "+700", DisplayName: "Bob"}, DeviceID: 3}
	if err := cache.SetSession(ctx, "h1", want, time.Minute); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err = cache.GetSession(ctx, "h1")
	if err != nil || got == nil || got.User.ID != 7 || got.DeviceID != 3 {
		t.Fatalf("get = %+v, %v", got, err)
	}

	if err := cache.DelSession(ctx, "h1"); err != nil {
		t.Fatalf("del: %v", err)
	}
	got, _ = cache.GetSession(ctx, "h1")
	if got != nil {
		t.Fatal("expected miss after delete")
	}

	// TTL: the key disappears after its duration elapses.
	if err := cache.SetSession(ctx, "h2", want, 5*time.Second); err != nil {
		t.Fatalf("set for ttl: %v", err)
	}
	mr.FastForward(6 * time.Second)
	got, _ = cache.GetSession(ctx, "h2")
	if got != nil {
		t.Fatal("expected key expired after TTL")
	}
}
