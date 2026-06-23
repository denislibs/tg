package realtime

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisPublisher_PublishToUser(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	sub := rdb.Subscribe(ctx, UserChannel(42))
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil { // wait for subscription confirmation
		t.Fatalf("subscribe: %v", err)
	}
	ch := sub.Channel()

	pub := NewRedisPublisher(rdb)
	if err := pub.PublishToUser(ctx, 42, []byte(`{"t":"new_message"}`)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case msg := <-ch:
		if msg.Payload != `{"t":"new_message"}` {
			t.Fatalf("unexpected payload: %q", msg.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive published frame")
	}
}

func TestRedisPublisher_NotifyRevoked(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	sub := rdb.Subscribe(ctx, DeviceChannel(99))
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	ch := sub.Channel()

	if err := NewRedisPublisher(rdb).NotifyRevoked(ctx, 99); err != nil {
		t.Fatalf("notify: %v", err)
	}
	select {
	case msg := <-ch:
		if msg.Payload != "close" {
			t.Fatalf("payload = %q", msg.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no close signal received")
	}
}
