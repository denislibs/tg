// Package presence tracks online/last-seen state via a PresenceStore port and
// fans presence changes out to a user's chat partners.
package presence

import (
	"context"
	"encoding/json"
	"time"
)

// Publisher delivers a frame to a user's realtime channel (satisfied by the
// realtime RedisPublisher).
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the user ids that should see a user's presence.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

// PresenceStore abstracts the online/last-seen storage (Redis in prod).
type PresenceStore interface {
	SetOnlineNX(ctx context.Context, userID int64, ttl time.Duration) (set bool, err error) // true if transitioned offline→online
	Refresh(ctx context.Context, userID int64, ttl time.Duration) (existed bool, err error) // false if the key had expired
	SetOffline(ctx context.Context, userID int64, lastSeen int64) error
	IsOnline(ctx context.Context, userID int64) (bool, error)
	LastSeen(ctx context.Context, userID int64) (int64, error)
}

type Manager struct {
	store    PresenceStore
	pub      Publisher
	partners PartnersFunc
	ttl      time.Duration
}

func NewManager(store PresenceStore, pub Publisher, partners PartnersFunc, ttl time.Duration) *Manager {
	return &Manager{store: store, pub: pub, partners: partners, ttl: ttl}
}

// Online marks a user online. It fans out a presence(online) frame only on the
// transition from offline → online (SET NX), so multiple devices/replicas don't
// each re-announce.
func (m *Manager) Online(ctx context.Context, userID int64) error {
	set, err := m.store.SetOnlineNX(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !set { // already online elsewhere — just refresh the TTL
		_, _ = m.store.Refresh(ctx, userID, m.ttl)
		return nil
	}
	return m.fanout(ctx, userID, true, 0)
}

// Heartbeat refreshes the online TTL; if the key had expired it re-establishes
// presence (which re-announces online).
func (m *Manager) Heartbeat(ctx context.Context, userID int64) error {
	existed, err := m.store.Refresh(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !existed {
		return m.Online(ctx, userID)
	}
	return nil
}

// Offline marks a user offline, records last-seen, and fans out presence(offline).
func (m *Manager) Offline(ctx context.Context, userID int64) error {
	now := time.Now().UnixMilli()
	_ = m.store.SetOffline(ctx, userID, now)
	return m.fanout(ctx, userID, false, now)
}

// IsOnline reports whether a user is currently online. It satisfies the HTTP
// layer's PresenceQuery seam (used by GET /chats/{id}/members).
func (m *Manager) IsOnline(ctx context.Context, userID int64) (bool, error) {
	return m.store.IsOnline(ctx, userID)
}

// Snapshot returns whether a user is currently online and their last-seen (ms).
func (m *Manager) Snapshot(ctx context.Context, userID int64) (online bool, lastSeen int64) {
	online, _ = m.store.IsOnline(ctx, userID)
	lastSeen, _ = m.store.LastSeen(ctx, userID)
	return online, lastSeen
}

func (m *Manager) fanout(ctx context.Context, userID int64, online bool, lastSeen int64) error {
	partners, err := m.partners(ctx, userID)
	if err != nil {
		return err
	}
	frame, _ := json.Marshal(map[string]any{
		"t": "presence",
		"d": map[string]any{"user_id": userID, "online": online, "last_seen": lastSeen},
	})
	for _, p := range partners {
		_ = m.pub.PublishToUser(ctx, p, frame)
	}
	return nil
}
