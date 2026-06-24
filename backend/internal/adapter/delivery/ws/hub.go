// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out
// (user:{id} delivery) and device close-on-revoke (device:{id} control).
package ws

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Sink is a connection a frame can be written to and that can be force-closed.
type Sink interface {
	Send(frame []byte)
	Close()
}

type Hub struct {
	mu          sync.RWMutex
	conns       map[int64]map[Sink]struct{} // by user id
	deviceConns map[int64]map[Sink]struct{} // by device id
	channelSubs map[int64]map[Sink]struct{} // by channel id (live channel posts)
	rdb         *redis.Client
	pubsub      *redis.PubSub
}

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:       make(map[int64]map[Sink]struct{}),
		deviceConns: make(map[int64]map[Sink]struct{}),
		channelSubs: make(map[int64]map[Sink]struct{}),
		rdb:         rdb,
		pubsub:      rdb.Subscribe(ctx),
	}
	go h.run()
	return h
}

func userChannel(userID int64) string     { return "user:" + strconv.FormatInt(userID, 10) }
func deviceChannel(deviceID int64) string { return "device:" + strconv.FormatInt(deviceID, 10) }
func channelTopic(channelID int64) string { return "channel:" + strconv.FormatInt(channelID, 10) }

func idFromChannel(ch, prefix string) (int64, bool) {
	if !strings.HasPrefix(ch, prefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(ch, prefix), 10, 64)
	return id, err == nil
}

func (h *Hub) run() {
	for msg := range h.pubsub.Channel() {
		if userID, ok := idFromChannel(msg.Channel, "user:"); ok {
			h.deliver(userID, []byte(msg.Payload))
		} else if deviceID, ok := idFromChannel(msg.Channel, "device:"); ok {
			h.closeDevice(deviceID)
		} else if chID, ok := idFromChannel(msg.Channel, "channel:"); ok {
			h.deliverChannel(chID, []byte(msg.Payload))
		}
	}
}

// Register adds a sink under its user and device, subscribing to the relevant
// Redis channels on the first connection for each.
func (h *Hub) Register(ctx context.Context, userID, deviceID int64, s Sink) {
	h.mu.Lock()
	firstUser := len(h.conns[userID]) == 0
	if firstUser {
		h.conns[userID] = make(map[Sink]struct{})
	}
	h.conns[userID][s] = struct{}{}
	firstDevice := len(h.deviceConns[deviceID]) == 0
	if firstDevice {
		h.deviceConns[deviceID] = make(map[Sink]struct{})
	}
	h.deviceConns[deviceID][s] = struct{}{}
	h.mu.Unlock()
	if firstUser {
		_ = h.pubsub.Subscribe(ctx, userChannel(userID))
	}
	if firstDevice {
		_ = h.pubsub.Subscribe(ctx, deviceChannel(deviceID))
	}
}

// Unregister removes a sink and unsubscribes when a user/device has no more local
// connections. Returns whether this was the user's last local connection.
func (h *Hub) Unregister(ctx context.Context, userID, deviceID int64, s Sink) (lastUser bool) {
	h.mu.Lock()
	delete(h.conns[userID], s)
	lastUser = len(h.conns[userID]) == 0
	if lastUser {
		delete(h.conns, userID)
	}
	delete(h.deviceConns[deviceID], s)
	lastDevice := len(h.deviceConns[deviceID]) == 0
	if lastDevice {
		delete(h.deviceConns, deviceID)
	}
	// Drop this sink from every channel subscription so a disconnecting conn
	// doesn't leak channel topic subscriptions; collect now-empty topics to
	// unsubscribe outside the lock.
	var emptiedChannels []int64
	for chID, subs := range h.channelSubs {
		if _, ok := subs[s]; ok {
			delete(subs, s)
			if len(subs) == 0 {
				delete(h.channelSubs, chID)
				emptiedChannels = append(emptiedChannels, chID)
			}
		}
	}
	h.mu.Unlock()
	if lastUser {
		_ = h.pubsub.Unsubscribe(ctx, userChannel(userID))
	}
	if lastDevice {
		_ = h.pubsub.Unsubscribe(ctx, deviceChannel(deviceID))
	}
	for _, chID := range emptiedChannels {
		_ = h.pubsub.Unsubscribe(ctx, channelTopic(chID))
	}
	return lastUser
}

// SubscribeChannel adds a sink to a channel's local subscriber set, subscribing
// the Redis topic on the first local subscriber.
func (h *Hub) SubscribeChannel(ctx context.Context, channelID int64, s Sink) {
	h.mu.Lock()
	subs := h.channelSubs[channelID]
	first := len(subs) == 0
	if first {
		subs = make(map[Sink]struct{})
		h.channelSubs[channelID] = subs
	}
	subs[s] = struct{}{}
	h.mu.Unlock()
	if first {
		_ = h.pubsub.Subscribe(ctx, channelTopic(channelID))
	}
}

// UnsubscribeChannel removes a sink from a channel's local subscriber set,
// unsubscribing the Redis topic when the last local subscriber leaves.
func (h *Hub) UnsubscribeChannel(ctx context.Context, channelID int64, s Sink) {
	h.mu.Lock()
	subs := h.channelSubs[channelID]
	last := false
	if subs != nil {
		delete(subs, s)
		if len(subs) == 0 {
			delete(h.channelSubs, channelID)
			last = true
		}
	}
	h.mu.Unlock()
	if last {
		_ = h.pubsub.Unsubscribe(ctx, channelTopic(channelID))
	}
}

func (h *Hub) deliverChannel(channelID int64, frame []byte) {
	h.mu.RLock()
	sinks := make([]Sink, 0, len(h.channelSubs[channelID]))
	for s := range h.channelSubs[channelID] {
		sinks = append(sinks, s)
	}
	h.mu.RUnlock()
	for _, s := range sinks {
		s.Send(frame)
	}
}

func (h *Hub) deliver(userID int64, frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.conns[userID] {
		s.Send(frame)
	}
}

func (h *Hub) closeDevice(deviceID int64) {
	h.mu.RLock()
	sinks := make([]Sink, 0, len(h.deviceConns[deviceID]))
	for s := range h.deviceConns[deviceID] {
		sinks = append(sinks, s)
	}
	h.mu.RUnlock()
	// Close outside the lock: Close triggers the conn's readPump to exit, which
	// calls Unregister (needs the write lock) — closing under RLock would deadlock.
	for _, s := range sinks {
		s.Close()
	}
}

func (h *Hub) Close() error { return h.pubsub.Close() }
