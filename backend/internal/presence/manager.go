// Package presence tracks online/last-seen state in Redis and fans presence
// changes out to a user's chat partners.
package presence

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Publisher delivers a frame to a user's realtime channel (satisfied by the
// realtime.RedisPublisher).
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the user ids that should see a user's presence.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

type Manager struct {
	rdb      *redis.Client
	pub      Publisher
	partners PartnersFunc
	ttl      time.Duration
}

func NewManager(rdb *redis.Client, pub Publisher, partners PartnersFunc, ttl time.Duration) *Manager {
	return &Manager{rdb: rdb, pub: pub, partners: partners, ttl: ttl}
}

func presKey(userID int64) string     { return "presence:" + strconv.FormatInt(userID, 10) }
func lastSeenKey(userID int64) string { return "lastseen:" + strconv.FormatInt(userID, 10) }

// Online marks a user online. It fans out a presence(online) frame only on the
// transition from offline → online (SET NX), so multiple devices/replicas don't
// each re-announce.
func (m *Manager) Online(ctx context.Context, userID int64) error {
	set, err := m.rdb.SetNX(ctx, presKey(userID), "1", m.ttl).Result()
	if err != nil {
		return err
	}
	if !set { // already online elsewhere — just refresh the TTL
		m.rdb.Expire(ctx, presKey(userID), m.ttl)
		return nil
	}
	return m.fanout(ctx, userID, true, 0)
}

// Heartbeat refreshes the online TTL; if the key had expired it re-establishes
// presence (which re-announces online).
func (m *Manager) Heartbeat(ctx context.Context, userID int64) error {
	ok, err := m.rdb.Expire(ctx, presKey(userID), m.ttl).Result()
	if err != nil {
		return err
	}
	if !ok {
		return m.Online(ctx, userID)
	}
	return nil
}

// Offline marks a user offline, records last-seen, and fans out presence(offline).
func (m *Manager) Offline(ctx context.Context, userID int64) error {
	now := time.Now().UnixMilli()
	m.rdb.Del(ctx, presKey(userID))
	m.rdb.Set(ctx, lastSeenKey(userID), now, 0)
	return m.fanout(ctx, userID, false, now)
}

// Snapshot returns whether a user is currently online and their last-seen (ms).
func (m *Manager) Snapshot(ctx context.Context, userID int64) (online bool, lastSeen int64) {
	n, _ := m.rdb.Exists(ctx, presKey(userID)).Result()
	online = n > 0
	lastSeen, _ = m.rdb.Get(ctx, lastSeenKey(userID)).Int64()
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
