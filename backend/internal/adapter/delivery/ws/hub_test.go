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
	hub.SubscribeChannel(ctx, domain.ToPeerID(5, true), sink, SubView)
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
	hub.UnsubscribeChannel(ctx, domain.ToPeerID(5, true), sink, SubView)
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
	chHub := &Hub{channelSubs: map[domain.PeerID]map[Sink]SubReason{-5: {newClosedChanSink(): SubView}}}
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

// A5-01: выбывший из канала (вышел, исключён, забанен) больше не получает
// живые посты — кадр chat_removed, уходящий ему, снимает его сокеты с топика
// канала. Без этого сокет оставался подписан до переподключения.
func TestHub_ChatRemovedUnsubscribesChannel(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	subRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pubRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer subRDB.Close()
	defer pubRDB.Close()
	ctx := context.Background()

	hub := NewHub(ctx, subRDB)
	defer hub.Close()

	gone, stays := newFakeSink(), newFakeSink()
	hub.Register(ctx, 7, 100, gone)
	hub.Register(ctx, 8, 200, stays)
	peer := domain.ToPeerID(5, true)
	hub.SubscribeChannel(ctx, peer, gone, SubMember)
	hub.SubscribeChannel(ctx, peer, stays, SubMember)
	time.Sleep(100 * time.Millisecond)

	pub := rtredis.NewRedisPublisher(pubRDB)
	removed := []byte(`{"d":{"_":"updateChatRemoved","peer":{"_":"peerChannel","channel_id":5}},"pts":3,"t":"chat_removed"}`)
	if err := pub.PublishToUser(ctx, 7, removed); err != nil {
		t.Fatalf("publish chat_removed: %v", err)
	}
	select {
	case got := <-gone.ch:
		if string(got) != string(removed) {
			t.Fatalf("сам кадр chat_removed должен дойти, got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("chat_removed not delivered")
	}

	if err := pub.PublishToChannel(ctx, 5, []byte(`post`)); err != nil {
		t.Fatalf("publish post: %v", err)
	}
	select {
	case got := <-stays.ch:
		if string(got) != "post" {
			t.Fatalf("оставшийся подписчик: got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("оставшийся подписчик не получил пост")
	}
	select {
	case got := <-gone.ch:
		t.Fatalf("выбывший получил пост канала: %q", got)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestChatRemovedPeer(t *testing.T) {
	if p, ok := chatRemovedPeer([]byte(`{"t":"chat_removed","d":{"peer":{"_":"peerChannel","channel_id":9}}}`)); !ok || p != domain.ToPeerID(9, true) {
		t.Fatalf("chat_removed: %v %v", p, ok)
	}
	// Упоминание строки в ТЕКСТЕ другого кадра — не сигнал.
	if _, ok := chatRemovedPeer([]byte(`{"t":"new_message","d":{"message":"chat_removed"}}`)); ok {
		t.Fatal("new_message с текстом chat_removed принят за выбытие")
	}
}

// Вступивший в канал получает его посты сразу, без перезагрузки и без
// открытия канала (A2-02): кадр updateChannel подписывает все его локальные
// сокеты на топик — через гейт доступа. Посторонний (гейт отказал) — нет.
func TestHub_UpdateChannelSubscribesUserSockets(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	subRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pubRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer subRDB.Close()
	defer pubRDB.Close()
	ctx := context.Background()

	hub := NewHub(ctx, subRDB)
	defer hub.Close()
	hub.SetChannelGate(func(_ context.Context, userID int64, peer domain.PeerID) bool {
		return userID == 7 && peer == domain.ToPeerID(5, true)
	})

	tab1, tab2, stranger := newFakeSink(), newFakeSink(), newFakeSink()
	hub.Register(ctx, 7, 100, tab1)
	hub.Register(ctx, 7, 101, tab2)
	hub.Register(ctx, 8, 200, stranger)
	time.Sleep(100 * time.Millisecond)

	pub := rtredis.NewRedisPublisher(pubRDB)
	for _, uid := range []int64{7, 8} {
		joined := []byte(`{"d":{"_":"updateChannel","channel_id":5},"pts":4,"t":"channel"}`)
		if err := pub.PublishToUser(ctx, uid, joined); err != nil {
			t.Fatalf("publish updateChannel: %v", err)
		}
	}
	for _, s := range []*fakeSink{tab1, tab2, stranger} {
		select {
		case <-s.ch: // сам кадр доходит
		case <-time.After(2 * time.Second):
			t.Fatal("updateChannel not delivered")
		}
	}
	time.Sleep(100 * time.Millisecond)

	if err := pub.PublishToChannel(ctx, 5, []byte(`post`)); err != nil {
		t.Fatalf("publish post: %v", err)
	}
	for name, s := range map[string]*fakeSink{"tab1": tab1, "tab2": tab2} {
		select {
		case got := <-s.ch:
			if string(got) != "post" {
				t.Fatalf("%s: got %q", name, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s вступившего не получил пост канала", name)
		}
	}
	select {
	case got := <-stranger.ch:
		t.Fatalf("гейт отказал, но посторонний получил пост: %q", got)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestChannelJoinedPeer(t *testing.T) {
	if p, ok := channelJoinedPeer([]byte(`{"t":"channel","d":{"_":"updateChannel","channel_id":9}}`)); !ok || p != domain.ToPeerID(9, true) {
		t.Fatalf("updateChannel: %v %v", p, ok)
	}
	if _, ok := channelJoinedPeer([]byte(`{"t":"new_message","d":{"message":"updateChannel"}}`)); ok {
		t.Fatal("текст updateChannel в чужом кадре принят за вступление")
	}
}

// Блокер ревью #407: закрытие ленты (unsubscribe_channel) снимало подписку
// участника, выданную при подключении, — посты канала переставали приходить
// до реконнекта (а при SharedWorker — во всех вкладках). Причины подписки
// снимаются независимо: участнику топик держится до выбытия.
func TestHub_ViewUnsubscribeKeepsMemberSubscription(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	subRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pubRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer subRDB.Close()
	defer pubRDB.Close()
	ctx := context.Background()
	hub := NewHub(ctx, subRDB)
	defer hub.Close()

	member, viewer := newFakeSink(), newFakeSink()
	hub.Register(ctx, 7, 100, member)
	hub.Register(ctx, 8, 200, viewer)
	peer := domain.ToPeerID(5, true)
	hub.SubscribeChannels(ctx, []domain.PeerID{peer, domain.ToPeerID(6, true)}, member, SubMember)
	hub.SubscribeChannel(ctx, peer, member, SubView) // открыл ленту
	hub.SubscribeChannel(ctx, peer, viewer, SubView) // не участник, открыл ленту
	hub.UnsubscribeChannel(ctx, peer, member, SubView)
	hub.UnsubscribeChannel(ctx, peer, viewer, SubView)
	time.Sleep(100 * time.Millisecond)

	pub := rtredis.NewRedisPublisher(pubRDB)
	if err := pub.PublishToChannel(ctx, 5, []byte(`post`)); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-member.ch:
		if string(got) != "post" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("участник закрыл ленту канала и перестал получать его посты")
	}
	select {
	case got := <-viewer.ch:
		t.Fatalf("не участник после закрытия ленты получил пост: %q", got)
	case <-time.After(300 * time.Millisecond):
	}
	// Пачка: второй канал из той же подписки тоже живой.
	if err := pub.PublishToChannel(ctx, 6, []byte(`post6`)); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-member.ch:
		if string(got) != "post6" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("пачечная подписка не подписала второй канал")
	}
}

func TestChannelStateFrame(t *testing.T) {
	got := string(channelStateFrame([]domain.ChannelCursor{{ChatID: 5, Pts: 9}}))
	if got != `{"d":{"channels":[[-5,9]]},"t":"channel_state"}` {
		t.Fatalf("channel_state = %s", got)
	}
}
