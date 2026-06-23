package presence

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
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

func newManager(t *testing.T) (*Manager, *fakePub, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pub := newFakePub()
	// user 1's partner is user 2.
	partners := func(_ context.Context, userID int64) ([]int64, error) {
		if userID == 1 {
			return []int64{2}, nil
		}
		return nil, nil
	}
	return NewManager(rdb, pub, partners, 30*time.Second), pub, mr
}

func TestManager_OnlineDedupAndOffline(t *testing.T) {
	m, pub, mr := newManager(t)
	defer mr.Close()
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
	m, _, mr := newManager(t)
	defer mr.Close()
	ctx := context.Background()
	_ = m.Online(ctx, 1)

	mr.FastForward(20 * time.Second) // still within TTL
	if err := m.Heartbeat(ctx, 1); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	mr.FastForward(20 * time.Second) // 40s total, but heartbeat reset the 30s TTL at 20s
	if online, _ := m.Snapshot(ctx, 1); !online {
		t.Fatal("expected still online after heartbeat refresh")
	}
}
