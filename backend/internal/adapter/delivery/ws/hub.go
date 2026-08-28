// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out
// (user:{id} delivery) and device close-on-revoke (device:{id} control).
package ws

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/pkg/saferun"
)

// sub/unsub — обёртки над pubsub с логом: молчаливый сбой подписки означал бы,
// что соединение не получает кросс-реплика фан-аут без единого следа.
func (h *Hub) sub(ctx context.Context, topic string) {
	if err := h.pubsub.Subscribe(ctx, topic); err != nil {
		log.Printf("ws hub: subscribe %s: %v", topic, err)
	}
}

func (h *Hub) unsub(ctx context.Context, topic string) {
	if err := h.pubsub.Unsubscribe(ctx, topic); err != nil {
		log.Printf("ws hub: unsubscribe %s: %v", topic, err)
	}
}

// Sink is a connection a frame can be written to and that can be force-closed.
type Sink interface {
	Send(frame []byte)
	Close()
}

type Hub struct {
	mu          sync.RWMutex
	conns       map[int64]map[Sink]struct{}         // by user id
	deviceConns map[int64]map[Sink]struct{}         // by device id
	channelSubs map[domain.PeerID]map[Sink]struct{} // by channel peer id (live channel posts)
	rdb         *redis.Client
	pubsub      *redis.PubSub
}

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:       make(map[int64]map[Sink]struct{}),
		deviceConns: make(map[int64]map[Sink]struct{}),
		channelSubs: make(map[domain.PeerID]map[Sink]struct{}),
		rdb:         rdb,
		pubsub:      rdb.Subscribe(ctx),
	}
	go h.run()
	return h
}

func userChannel(userID int64) string     { return "user:" + strconv.FormatInt(userID, 10) }
func deviceChannel(deviceID int64) string { return "device:" + strconv.FormatInt(deviceID, 10) }

// channelTopic — тот же ключ, что у публикующей стороны
// (adapter/realtime/redis.ChannelTopic): знаковый идентификатор пира.
func channelTopic(peer domain.PeerID) string {
	return "channel:" + strconv.FormatInt(int64(peer), 10)
}

func idFromChannel(ch, prefix string) (int64, bool) {
	if !strings.HasPrefix(ch, prefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(ch, prefix), 10, 64)
	return id, err == nil
}

func (h *Hub) run() {
	// Паника при обработке одного pub/sub-сообщения не должна убивать весь
	// fan-out (и процесс) — гасим на каждый кадр, цикл продолжается.
	for msg := range h.pubsub.Channel() {
		h.route(msg)
	}
}

func (h *Hub) route(msg *redis.Message) {
	defer saferun.Recover("ws.hub.route")
	if userID, ok := idFromChannel(msg.Channel, "user:"); ok {
		h.deliver(userID, []byte(msg.Payload))
	} else if deviceID, ok := idFromChannel(msg.Channel, "device:"); ok {
		h.closeDevice(deviceID)
	} else if chID, ok := idFromChannel(msg.Channel, "channel:"); ok {
		h.deliverChannel(domain.PeerID(chID), []byte(msg.Payload))
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
		h.sub(ctx, userChannel(userID))
	}
	if firstDevice {
		h.sub(ctx, deviceChannel(deviceID))
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
	var emptiedChannels []domain.PeerID
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
		h.unsub(ctx, userChannel(userID))
	}
	if lastDevice {
		h.unsub(ctx, deviceChannel(deviceID))
	}
	for _, chID := range emptiedChannels {
		h.unsub(ctx, channelTopic(chID))
	}
	return lastUser
}

// SubscribeChannel adds a sink to a channel's local subscriber set, subscribing
// the Redis topic on the first local subscriber.
func (h *Hub) SubscribeChannel(ctx context.Context, peer domain.PeerID, s Sink) {
	h.mu.Lock()
	subs := h.channelSubs[peer]
	first := len(subs) == 0
	if first {
		subs = make(map[Sink]struct{})
		h.channelSubs[peer] = subs
	}
	subs[s] = struct{}{}
	h.mu.Unlock()
	if first {
		h.sub(ctx, channelTopic(peer))
	}
}

// UnsubscribeChannel removes a sink from a channel's local subscriber set,
// unsubscribing the Redis topic when the last local subscriber leaves.
func (h *Hub) UnsubscribeChannel(ctx context.Context, peer domain.PeerID, s Sink) {
	h.mu.Lock()
	subs := h.channelSubs[peer]
	last := false
	if subs != nil {
		delete(subs, s)
		if len(subs) == 0 {
			delete(h.channelSubs, peer)
			last = true
		}
	}
	h.mu.Unlock()
	if last {
		h.unsub(ctx, channelTopic(peer))
	}
}

func (h *Hub) deliverChannel(peer domain.PeerID, frame []byte) {
	// Send держим ПОД RLock (как deliver), а не по снимку с отпущенным локом:
	// иначе между снимком и Send сокет мог быть Unregister'ен (write-lock) и
	// его send-канал закрыт (conn.run: close после Unregister) — и Send в
	// закрытый канал паникнул бы (send-on-closed игнорирует select/default).
	// Под RLock Unregister заблокирован, поэтому close ещё не произошёл; либо
	// сокет уже удалён из channelSubs и в итерацию не попадёт. Send неблокирующий.
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.channelSubs[peer] {
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
