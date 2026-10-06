package presence

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakePub struct {
	mu    sync.Mutex
	got   map[int64]int
	frame map[int64][]byte
}

func newFakePub() *fakePub { return &fakePub{got: map[int64]int{}, frame: map[int64][]byte{}} }
func (p *fakePub) PublishToUser(_ context.Context, userID int64, frame []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.got[userID]++
	p.frame[userID] = frame
	return nil
}

// last — последний кадр, ушедший получателю.
func (p *fakePub) last(userID int64) []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.frame[userID]
}
func (p *fakePub) count(userID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.got[userID]
}

// fakeStore is an in-memory PresenceStore with a manually advanceable clock so
// tests can expire presence keys deterministically (mirrors miniredis FastForward).
type fakeStore struct {
	mu       sync.Mutex
	now      time.Time
	expiry   map[int64]time.Time // presence key expiry
	lastSeen map[int64]int64
	// announced — объявленный партнёрам дедлайн онлайна (userStatusOnline.expires).
	announced map[int64]time.Time
}

func newFakeStore() *fakeStore {
	return &fakeStore{now: time.Unix(1_790_000_000, 0), expiry: map[int64]time.Time{}, lastSeen: map[int64]int64{}, announced: map[int64]time.Time{}}
}

func (s *fakeStore) clock() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now
}

func (s *fakeStore) Announce(_ context.Context, userID int64, deadline time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.announced[userID] = deadline
	return nil
}

func (s *fakeStore) AnnouncedExpires(_ context.Context, userID int64) (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.announced[userID]
	if !ok || !d.After(s.now) {
		return time.Time{}, nil
	}
	return d, nil
}

func (s *fakeStore) fastForward(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.now = s.now.Add(d)
}

// online reports whether the key is present and unexpired (caller holds lock).
func (s *fakeStore) onlineLocked(userID int64) bool {
	exp, ok := s.expiry[userID]
	if !ok {
		return false
	}
	if !exp.After(s.now) {
		delete(s.expiry, userID)
		return false
	}
	return true
}

func (s *fakeStore) SetOnlineNX(_ context.Context, userID int64, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.onlineLocked(userID) {
		return false, nil
	}
	s.expiry[userID] = s.now.Add(ttl)
	return true, nil
}

func (s *fakeStore) Refresh(_ context.Context, userID int64, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.onlineLocked(userID) {
		return false, nil
	}
	s.expiry[userID] = s.now.Add(ttl)
	return true, nil
}

func (s *fakeStore) SetOffline(_ context.Context, userID int64, lastSeen int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.expiry, userID)
	delete(s.announced, userID)
	s.lastSeen[userID] = lastSeen
	return nil
}

func (s *fakeStore) IsOnline(_ context.Context, userID int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.onlineLocked(userID), nil
}

func (s *fakeStore) CountOnline(_ context.Context, userIDs []int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, id := range userIDs {
		if s.onlineLocked(id) {
			n++
		}
	}
	return n, nil
}

func (s *fakeStore) LastSeen(_ context.Context, userID int64) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastSeen[userID], nil
}

// OnlineExpires — дедлайн ключа присутствия (userStatusOnline.expires): именно
// его отсутствие оставляло пира онлайн навсегда при потерянном кадре.
func (s *fakeStore) OnlineExpires(_ context.Context, userID int64) (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.onlineLocked(userID) {
		return time.Time{}, nil
	}
	return s.expiry[userID], nil
}

func newManager(t *testing.T) (*Manager, *fakePub, *fakeStore) {
	t.Helper()
	store := newFakeStore()
	pub := newFakePub()
	// user 1's partner is user 2.
	partners := func(_ context.Context, userID int64) ([]int64, error) {
		if userID == 1 {
			return []int64{2}, nil
		}
		return nil, nil
	}
	m := NewManager(store, pub, partners, 30*time.Second)
	m.now = store.clock
	return m, pub, store
}

// lastExpires — expires последнего кадра онлайна, ушедшего получателю.
func lastExpires(t *testing.T, pub *fakePub, userID int64) int64 {
	t.Helper()
	var live struct {
		D struct {
			Status struct {
				Underscore string `json:"_"`
				Expires    int64  `json:"expires"`
			} `json:"status"`
		} `json:"d"`
	}
	if err := json.Unmarshal(pub.last(userID), &live); err != nil {
		t.Fatalf("разбор кадра: %v", err)
	}
	if live.D.Status.Underscore != domain.UserStatusOnlineTag {
		t.Fatalf("последний кадр = %q; want userStatusOnline", live.D.Status.Underscore)
	}
	return live.D.Status.Expires
}

func TestManager_OnlineDedupAndOffline(t *testing.T) {
	m, pub, _ := newManager(t)
	ctx := context.Background()

	// First Online → one presence frame to partner 2.
	if err := m.Online(ctx, 1); err != nil {
		t.Fatalf("online: %v", err)
	}
	// Second Online (e.g. another device) → no new announce.
	_ = m.Online(ctx, 1)
	if pub.count(2) != 1 {
		t.Fatalf("expected 1 online announce, got %d", pub.count(2))
	}
	if online, _, _ := m.Status(ctx, 1); !online {
		t.Fatal("expected user 1 online")
	}

	// Offline → another presence frame + last-seen recorded.
	if err := m.Offline(ctx, 1); err != nil {
		t.Fatalf("offline: %v", err)
	}
	if pub.count(2) != 2 {
		t.Fatalf("expected offline announce, total=%d", pub.count(2))
	}
	online, _, lastSeen := m.Status(ctx, 1)
	if online || lastSeen.IsZero() {
		t.Fatalf("after offline: online=%v lastSeen=%v", online, lastSeen)
	}
}

func TestManager_HeartbeatRefreshes(t *testing.T) {
	m, _, store := newManager(t)
	ctx := context.Background()
	_ = m.Online(ctx, 1)

	store.fastForward(20 * time.Second) // still within TTL
	if err := m.Heartbeat(ctx, 1); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	store.fastForward(20 * time.Second) // 40s total, but heartbeat reset the 30s TTL at 20s
	if online, _, _ := m.Status(ctx, 1); !online {
		t.Fatal("expected still online after heartbeat refresh")
	}
}

func TestManager_HeartbeatReestablishesWhenExpired(t *testing.T) {
	m, pub, store := newManager(t)
	ctx := context.Background()
	_ = m.Online(ctx, 1)
	if pub.count(2) != 1 {
		t.Fatalf("expected 1 online announce, got %d", pub.count(2))
	}

	// Let the presence key expire, then heartbeat → re-establish + re-announce.
	store.fastForward(31 * time.Second)
	if err := m.Heartbeat(ctx, 1); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	if pub.count(2) != 2 {
		t.Fatalf("expected re-announce after expiry, got %d", pub.count(2))
	}
	if online, _, _ := m.Status(ctx, 1); !online {
		t.Fatal("expected online after heartbeat re-establish")
	}
}

// Присутствие на проводе — конструктор UserStatus со СРОКОМ ГОДНОСТИ.
//
// Здесь проверяется дефект 1 разбора: прежний кадр {online:true, last_seen}
// срока годности не имел, и потерянный кадр оставлял человека онлайн НАВСЕГДА.
// В схеме userStatusOnline несёт expires, и клиент деградирует online →
// offline по таймеру сам (tweb appUsersManager.ts:880-889). Источник у нас был
// всегда — TTL ключа присутствия, — просто на провод не выпускался.
func TestManager_UserStatusCarriesExpiry(t *testing.T) {
	m, pub, store := newManager(t)
	ctx := context.Background()

	if err := m.Online(ctx, 1); err != nil {
		t.Fatalf("online: %v", err)
	}
	st := m.UserStatus(ctx, 1, true)
	online, ok := st.(domain.UserStatusOnline)
	if !ok {
		t.Fatalf("статус онлайна = %#v; want userStatusOnline", st)
	}
	if online.Tag() != domain.UserStatusOnlineTag {
		t.Fatalf("дискриминатор = %q", online.Tag())
	}
	// Дедлайн — объявленный горизонт онлайна от текущего момента фейкового часа
	// (а не TTL ключа: ключ продлевается каждые 25 с молча, и дедлайн TTL
	// устаревал бы раньше, чем партнёр получит следующий кадр).
	want := store.now.Add(onlineHorizon).Unix()
	if int64(online.Expires) != want {
		t.Fatalf("expires = %d; want %d (объявленный горизонт)", online.Expires, want)
	}

	// Тот же дедлайн уходит партнёру в кадре: без него клиент не смог бы
	// погасить статус, не получив следующего кадра.
	var live struct {
		D struct {
			Status struct {
				Underscore string `json:"_"`
				Expires    int64  `json:"expires"`
			} `json:"status"`
		} `json:"d"`
	}
	if err := json.Unmarshal(pub.last(2), &live); err != nil {
		t.Fatalf("разбор кадра: %v", err)
	}
	if live.D.Status.Underscore != domain.UserStatusOnlineTag || live.D.Status.Expires != want {
		t.Fatalf("кадр присутствия = %+v; want userStatusOnline с expires=%d", live.D.Status, want)
	}

	// Скрытое правилом last_seen присутствие — ДРУГОЙ конструктор, а не
	// «онлайн с нулевым временем»: приватность выражена самим статусом.
	if hidden := m.UserStatus(ctx, 1, false); hidden.Tag() != domain.UserStatusRecentlyTag {
		t.Fatalf("скрытый статус = %q; want userStatusRecently", hidden.Tag())
	}

	// Ключ истёк — статус становится офлайном с временем последнего захода.
	_ = m.Offline(ctx, 1)
	if st := m.UserStatus(ctx, 1, true); st.Tag() != domain.UserStatusOfflineTag {
		t.Fatalf("после Offline статус = %q; want userStatusOffline", st.Tag())
	}
}

// Онлайн продлевается кадром, а не молча. Telegram держит собеседника «в сети»
// потоком updateUserStatus: tweb зовёт account.updateStatus каждые 50 с
// (appImManager.ts:360), и каждый вызов уходит зрителям новым userStatusOnline
// со свежим expires. У нас пульс — WS-heartbeat, и прежде он лишь продлевал
// TTL ключа: партнёр получал ОДИН кадр онлайна с дедлайном через 35 с, после
// чего клиент (degradeExpiredPresence, порт updateUsersStatuses) честно гасил
// статус — человек в сети, а подпись «был(а) в сети только что».
func TestManager_HeartbeatReannouncesBeforeExpiry(t *testing.T) {
	m, pub, store := newManager(t)
	ctx := context.Background()
	_ = m.Online(ctx, 1)
	if pub.count(2) != 1 {
		t.Fatalf("expected 1 online announce, got %d", pub.count(2))
	}

	// Держим соединение 10 минут пульсом раз в 25 с (pingPeriod WS): после
	// каждого пульса последний полученный партнёром кадр обязан обещать онлайн
	// дальше СЛЕДУЮЩЕГО пульса — иначе между пульсами клиент погасит статус
	// живого человека.
	const pulse = 25 * time.Second
	for i := 0; i < 24; i++ {
		store.fastForward(pulse)
		if err := m.Heartbeat(ctx, 1); err != nil {
			t.Fatalf("heartbeat: %v", err)
		}
		if exp, next := lastExpires(t, pub, 2), store.clock().Add(pulse).Unix(); exp <= next {
			t.Fatalf("шаг %d: последний кадр обещает онлайн до %d, а следующий пульс в %d", i, exp, next)
		}
	}
	// И не на каждый пульс: веер уходит всем партнёрам, а кадр нужен лишь
	// перед истечением обещанного — примерно раз в 50 с, как у tweb.
	if n := pub.count(2); n > 1+24/2 {
		t.Fatalf("кадров онлайна за 24 пульса: %d; ждали не больше %d", n, 1+24/2)
	}
	// Снимок (GET /presence, /users/{id}) обещает тот же дедлайн, что и кадр.
	if _, exp, _ := m.Status(ctx, 1); exp.Unix() != lastExpires(t, pub, 2) {
		t.Fatalf("снимок expires=%d, кадр expires=%d", exp.Unix(), lastExpires(t, pub, 2))
	}
}

// Б-84: «N онлайн» — сколько из состава держат ключ присутствия; ушедший
// офлайн не считается.
func TestManager_CountOnline(t *testing.T) {
	m, _, _ := newManager(t)
	ctx := context.Background()
	_ = m.Online(ctx, 1)
	_ = m.Online(ctx, 2)
	_ = m.Online(ctx, 3)
	_ = m.Offline(ctx, 3)
	n, err := m.CountOnline(ctx, []int64{1, 2, 3, 4})
	if err != nil || n != 2 {
		t.Fatalf("CountOnline = %d, %v; want 2", n, err)
	}
}

func (s *fakeStore) Snapshots(_ context.Context, userIDs []int64) (map[int64]Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[int64]Snapshot, len(userIDs))
	for _, id := range userIDs {
		sn := Snapshot{Online: s.onlineLocked(id), Announced: s.announced[id], LastSeen: s.lastSeen[id]}
		if sn.Online {
			sn.Expires = s.expiry[id]
		}
		out[id] = sn
	}
	return out, nil
}
