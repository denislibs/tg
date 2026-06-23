// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out.
package ws

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Sink is anything a delivered frame can be written to (a Conn in production,
// a fake in tests).
type Sink interface {
	Send(frame []byte)
}

// Hub tracks this replica's connections per user and routes Redis-published
// frames on channel "user:{id}" to the matching local sinks.
type Hub struct {
	mu     sync.RWMutex
	conns  map[int64]map[Sink]struct{}
	rdb    *redis.Client
	pubsub *redis.PubSub
}

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:  make(map[int64]map[Sink]struct{}),
		rdb:    rdb,
		pubsub: rdb.Subscribe(ctx), // no channels yet; added on demand
	}
	go h.run()
	return h
}

func userChannel(userID int64) string { return "user:" + strconv.FormatInt(userID, 10) }

func userIDFromChannel(ch string) (int64, bool) {
	const prefix = "user:"
	if !strings.HasPrefix(ch, prefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(ch, prefix), 10, 64)
	return id, err == nil
}

func (h *Hub) run() {
	for msg := range h.pubsub.Channel() {
		if userID, ok := userIDFromChannel(msg.Channel); ok {
			h.deliver(userID, []byte(msg.Payload))
		}
	}
}

// Register adds a sink for a user, subscribing to its Redis channel on the first
// connection.
func (h *Hub) Register(ctx context.Context, userID int64, s Sink) {
	h.mu.Lock()
	first := len(h.conns[userID]) == 0
	if first {
		h.conns[userID] = make(map[Sink]struct{})
	}
	h.conns[userID][s] = struct{}{}
	h.mu.Unlock()
	if first {
		_ = h.pubsub.Subscribe(ctx, userChannel(userID))
	}
}

// Unregister removes a sink, unsubscribing when the user has no more local conns.
func (h *Hub) Unregister(ctx context.Context, userID int64, s Sink) {
	h.mu.Lock()
	set := h.conns[userID]
	delete(set, s)
	last := len(set) == 0
	if last {
		delete(h.conns, userID)
	}
	h.mu.Unlock()
	if last {
		_ = h.pubsub.Unsubscribe(ctx, userChannel(userID))
	}
}

func (h *Hub) deliver(userID int64, frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.conns[userID] {
		s.Send(frame)
	}
}

// Close shuts down the Redis subscription.
func (h *Hub) Close() error { return h.pubsub.Close() }
