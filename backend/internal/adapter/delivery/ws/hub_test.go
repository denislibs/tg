package ws

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/redis/go-redis/v9"
)

type fakeSink struct {
	ch     chan []byte
	mu     sync.Mutex
	closed bool
}

func newFakeSink() *fakeSink { return &fakeSink{ch: make(chan []byte, 4)} }

// Send is non-blocking so it can never stall hub.deliver while it holds the
// read lock (mirrors production Conn.Send behaviour).
func (s *fakeSink) Send(frame []byte) {
	select {
	case s.ch <- frame:
	default:
	}
}

func (s *fakeSink) Close() {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
}

func (s *fakeSink) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
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
	hub.Register(ctx, 7, 100, sink)
	// Give the subscription a moment to register on miniredis.
	time.Sleep(100 * time.Millisecond)

	pub := rtredis.NewRedisPublisher(pubRDB)
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
	hub.Unregister(ctx, 7, 100, sink)
	time.Sleep(100 * time.Millisecond)
	_ = pub.PublishToUser(ctx, 7, []byte(`again`))
	select {
	case got := <-sink.ch:
		t.Fatalf("unexpected delivery after unregister: %q", got)
	case <-time.After(300 * time.Millisecond):
		// good: nothing delivered
	}
}

func TestHub_DeliversChannelFrame(t *testing.T) {
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
	// Топик канала адресуется знаковым ключом пира (-5), как и всё остальное.
	hub.SubscribeChannel(ctx, domain.ToPeerID(5, true), sink)
	// Give the subscription a moment to register on miniredis.
	time.Sleep(100 * time.Millisecond)

	pub := rtredis.NewRedisPublisher(pubRDB)
	if err := pub.PublishToChannel(ctx, 5, []byte(`post`)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case got := <-sink.ch:
		if string(got) != "post" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("frame not delivered to channel sink")
	}

	// After unsubscribe, no further delivery.
	hub.UnsubscribeChannel(ctx, domain.ToPeerID(5, true), sink)
	time.Sleep(100 * time.Millisecond)
	_ = pub.PublishToChannel(ctx, 5, []byte(`again`))
	select {
	case got := <-sink.ch:
		t.Fatalf("unexpected delivery after unsubscribe: %q", got)
	case <-time.After(300 * time.Millisecond):
		// good: nothing delivered
	}
}

// closedChanSink.Send паникует «send on closed channel» — ровно та паника, что
// возникала в гонке deliverChannel↔conn.close(c.send) (REL-1).
type closedChanSink struct{ ch chan []byte }

func newClosedChanSink() *closedChanSink {
	c := make(chan []byte)
	close(c)
	return &closedChanSink{ch: c}
}
func (s *closedChanSink) Send(frame []byte) { s.ch <- frame } // panic: send on closed channel
func (s *closedChanSink) Close()            {}

// route не должен пропускать панику из Send наружу (иначе горутина hub.run и весь
// процесс падают). Проверяем оба фан-аут-пути — канальный и пользовательский.
func TestHub_RouteRecoversFromPanickingSink(t *testing.T) {
	chHub := &Hub{channelSubs: map[domain.PeerID]map[Sink]struct{}{-5: {newClosedChanSink(): {}}}}
	chHub.route(&redis.Message{Channel: "channel:-5", Payload: "x"})

	userHub := &Hub{conns: map[int64]map[Sink]struct{}{7: {newClosedChanSink(): {}}}}
	userHub.route(&redis.Message{Channel: "user:7", Payload: "y"})
	// Если дошли сюда без падения процесса — recover в route сработал.
}

func TestHub_ClosesDeviceOnRevoke(t *testing.T) {
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
	hub.Register(ctx, 7, 100, sink)
	time.Sleep(100 * time.Millisecond)

	// Publishing a close on the device channel must close the sink.
	if err := pubRDB.Publish(ctx, "device:100", "close").Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if sink.isClosed() {
			return // success
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("sink was not closed on device-revoke signal")
}
