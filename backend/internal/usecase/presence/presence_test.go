package presence

import (
	"context"
	"sync"
	"testing"
	"time"
)

type fakePub struct {
	mu  sync.Mutex
	got map[int64]int
}

func newFakePub() *fakePub { return &fakePub{got: map[int64]int{}} }
func (p *fakePub) PublishToUser(_ context.Context, userID int64, _ []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.got[userID]++
	return nil
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
	if online, _ := m.Snapshot(ctx, 1); !online {
		t.Fatal("expected user 1 online")
	}

	// Offline → another presence frame + last-seen recorded.
	if err := m.Offline(ctx, 1); err != nil {
		t.Fatalf("offline: %v", err)
	}
	if pub.count(2) != 2 {
		t.Fatalf("expected offline announce, total=%d", pub.count(2))
	}
	online, lastSeen := m.Snapshot(ctx, 1)
	if online || lastSeen == 0 {
		t.Fatalf("after offline: online=%v lastSeen=%d", online, lastSeen)
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
	if online, _ := m.Snapshot(ctx, 1); !online {
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
	if online, _ := m.Snapshot(ctx, 1); !online {
		t.Fatal("expected online after heartbeat re-establish")
	}
}
