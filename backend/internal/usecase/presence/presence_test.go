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
}

func newFakeStore() *fakeStore {
	return &fakeStore{now: time.Unix(0, 0), expiry: map[int64]time.Time{}, lastSeen: map[int64]int64{}}
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
	s.lastSeen[userID] = lastSeen
	return nil
}

func (s *fakeStore) IsOnline(_ context.Context, userID int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.onlineLocked(userID), nil
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
	return NewManager(store, pub, partners, 30*time.Second), pub, store
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
	// Дедлайн — ровно TTL ключа присутствия от текущего момента фейкового часа.
	want := store.now.Add(30 * time.Second).Unix()
	if int64(online.Expires) != want {
		t.Fatalf("expires = %d; want %d (дедлайн TTL ключа)", online.Expires, want)
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
