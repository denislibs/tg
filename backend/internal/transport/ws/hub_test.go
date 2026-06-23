package ws

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/realtime"
	"github.com/redis/go-redis/v9"
)

type fakeSink struct{ ch chan []byte }

func newFakeSink() *fakeSink { return &fakeSink{ch: make(chan []byte, 4)} }

// Send is non-blocking so it can never stall hub.deliver while it holds the
// read lock (mirrors production Conn.Send behaviour).
func (s *fakeSink) Send(frame []byte) {
	select {
	case s.ch <- frame:
	default:
	}
}

func TestHub_DeliversPublishedFrame(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	subRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pubRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer subRDB.Close()
	defer pubRDB.Close()
	ctx := context.Background()

	hub := NewHub(ctx, subRDB)
	defer hub.Close()

	sink := newFakeSink()
	hub.Register(ctx, 7, sink)
	// Give the subscription a moment to register on miniredis.
	time.Sleep(100 * time.Millisecond)

	pub := realtime.NewRedisPublisher(pubRDB)
	if err := pub.PublishToUser(ctx, 7, []byte(`hello`)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case got := <-sink.ch:
		if string(got) != "hello" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("frame not delivered to sink")
	}

	// After unregister, no further delivery.
	hub.Unregister(ctx, 7, sink)
	time.Sleep(100 * time.Millisecond)
	_ = pub.PublishToUser(ctx, 7, []byte(`again`))
	select {
	case got := <-sink.ch:
		t.Fatalf("unexpected delivery after unregister: %q", got)
	case <-time.After(300 * time.Millisecond):
		// good: nothing delivered
	}
}
