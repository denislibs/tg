// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out
// (user:{id} delivery) and device close-on-revoke (device:{id} control).
package ws

import (
	"bytes"
	"context"
	"encoding/json"
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
	conns       map[int64]map[Sink]struct{}          // by user id
	deviceConns map[int64]map[Sink]struct{}          // by device id
	channelSubs map[domain.PeerID]map[Sink]SubReason // by channel peer id: why the sink reads the topic
	rdb         *redis.Client
	pubsub      *redis.PubSub
	// channelGate — читает ли пользователь топик пира (usecase
	// CanSubscribeChannel). nil — подписок по кадру updateChannel нет.
	channelGate ChannelGate
}

// ChannelGate — правило «кто читает топик пира»: то же, что у кадра
// subscribe_channel (Interactor.CanSubscribeChannel).
type ChannelGate func(ctx context.Context, userID int64, peer domain.PeerID) bool

// SetChannelGate связывает хаб с правилом доступа к топикам: по нему хаб
// подписывает сокеты пользователя на канал, в который тот вступил (кадр
// updateChannel). Зовётся при сборке, до первого соединения.
func (h *Hub) SetChannelGate(g ChannelGate) { h.channelGate = g }

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:       make(map[int64]map[Sink]struct{}),
		deviceConns: make(map[int64]map[Sink]struct{}),
		channelSubs: make(map[domain.PeerID]map[Sink]SubReason),
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
		frame := []byte(msg.Payload)
		if peer, removed := chatRemovedPeer(frame); removed {
			h.unsubscribeUserChannel(context.Background(), userID, peer)
		}
		if peer, joined := channelJoinedPeer(frame); joined {
			h.subscribeUserChannel(userID, peer)
		}
		h.deliver(userID, frame)
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

// SubReason — почему сокет читает топик канала. Причин две, и снимаются они
// независимо: отписка ленты не имеет права снять подписку участника.
//
//   - SubMember — участник канала: топик держится от подключения (или
//     вступления, кадр updateChannel) до выбытия (chat_removed). У оригинала
//     сервер шлёт updateNewChannelMessage всем онлайн-сессиям участников;
//   - SubView — открытая лента у НЕ участника (публичный канал читается без
//     вступления): кадр subscribe_channel, аналог tweb setFetchHistoryInterval /
//     subscribeToChannelUpdates, который нужен только не участнику
//     (isFetchIntervalNeeded). Снимается unsubscribe_channel.
type SubReason uint8

const (
	SubMember SubReason = 1 << iota
	SubView
	subAll = SubMember | SubView
)

// SubscribeChannel добавляет сокету причину читать топик канала; Redis-топик
// подписывается на первом локальном подписчике.
func (h *Hub) SubscribeChannel(ctx context.Context, peer domain.PeerID, s Sink, why SubReason) {
	h.SubscribeChannels(ctx, []domain.PeerID{peer}, s, why)
}

// SubscribeChannels — то же пачкой: все новые для реплики топики уходят одним
// SUBSCRIBE (подключение участника с сотнями каналов — один вызов Redis).
func (h *Hub) SubscribeChannels(ctx context.Context, peers []domain.PeerID, s Sink, why SubReason) {
	var fresh []string
	h.mu.Lock()
	for _, peer := range peers {
		subs := h.channelSubs[peer]
		if len(subs) == 0 {
			subs = make(map[Sink]SubReason)
			h.channelSubs[peer] = subs
			fresh = append(fresh, channelTopic(peer))
		}
		subs[s] |= why
	}
	h.mu.Unlock()
	if len(fresh) > 0 {
		if err := h.pubsub.Subscribe(ctx, fresh...); err != nil {
			log.Printf("ws hub: subscribe %d channel topics: %v", len(fresh), err)
		}
	}
}

// UnsubscribeChannel снимает с сокета причину why; сокет уходит из топика,
// только когда причин не осталось, а Redis-топик — с последним сокетом.
func (h *Hub) UnsubscribeChannel(ctx context.Context, peer domain.PeerID, s Sink, why SubReason) {
	h.mu.Lock()
	subs := h.channelSubs[peer]
	last := false
	if reason, ok := subs[s]; ok {
		if rest := reason &^ why; rest != 0 {
			subs[s] = rest
		} else {
			delete(subs, s)
		}
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

// chatRemovedFrame — признак кадра chat_removed в теле: дешёвый отсев до
// разбора JSON, чтобы не разбирать каждый кадр пользователя.
var chatRemovedFrame = []byte(`"chat_removed"`)

// chatRemovedPeer — пир чата, который пользователь потерял (кадр
// chat_removed: выход, исключение, бан — их шлёт RemoveMember). ok=false —
// это другой кадр.
func chatRemovedPeer(frame []byte) (domain.PeerID, bool) {
	if !bytes.Contains(frame, chatRemovedFrame) {
		return domain.NullPeerID, false
	}
	var f struct {
		T string `json:"t"`
		D struct {
			Peer json.RawMessage `json:"peer"`
		} `json:"d"`
	}
	if json.Unmarshal(frame, &f) != nil || f.T != "chat_removed" {
		return domain.NullPeerID, false
	}
	p, err := domain.UnmarshalPeer(f.D.Peer)
	if err != nil || p == nil {
		return domain.NullPeerID, false
	}
	return domain.GetPeerID(p), true
}

// unsubscribeUserChannel снимает с топика пира все локальные сокеты
// пользователя: выбывший из канала (вышел, исключён, забанен) больше не
// читает его, и живые посты ему идти не должны. Сигнал — кадр chat_removed,
// который ему и так уходит; он приходит в каждую реплику, где у пользователя
// есть сокеты, поэтому отписка работает и между репликами.
func (h *Hub) unsubscribeUserChannel(ctx context.Context, userID int64, peer domain.PeerID) {
	h.mu.RLock()
	sinks := make([]Sink, 0, len(h.conns[userID]))
	for s := range h.conns[userID] {
		sinks = append(sinks, s)
	}
	h.mu.RUnlock()
	for _, s := range sinks {
		h.UnsubscribeChannel(ctx, peer, s, subAll)
	}
}

// channelJoinedFrame — признак кадра updateChannel в теле (дешёвый отсев).
var channelJoinedFrame = []byte(`"updateChannel"`)

// channelJoinedPeer — канал, в который пользователь вступил (кадр
// updateChannel, его шлёт announceChannelJoin). ok=false — другой кадр.
func channelJoinedPeer(frame []byte) (domain.PeerID, bool) {
	if !bytes.Contains(frame, channelJoinedFrame) {
		return domain.NullPeerID, false
	}
	var f struct {
		D struct {
			Underscore string `json:"_"`
			ChannelID  int64  `json:"channel_id"`
		} `json:"d"`
	}
	if json.Unmarshal(frame, &f) != nil || f.D.Underscore != domain.UpdateChannelTag || f.D.ChannelID <= 0 {
		return domain.NullPeerID, false
	}
	return domain.ToPeerID(f.D.ChannelID, true), true
}

// subscribeUserChannel подписывает все локальные сокеты пользователя на
// топик канала, в который он вступил (причина — участник), через то же правило
// доступа, что и кадр subscribe_channel. Пара к unsubscribeUserChannel: кадр
// приходит в каждую реплику, где у пользователя есть сокеты.
//
// Гейт ходит в базу, поэтому вне цикла pub/sub: route — единственный
// потребитель кадров реплики, и ожидание базы задержало бы доставку всем.
// Кадры канала, вышедшие до подписки, вступивший добирает догоном по разрыву,
// а строку диалога — перечитыванием по тому же updateChannel.
func (h *Hub) subscribeUserChannel(userID int64, peer domain.PeerID) {
	if h.channelGate == nil {
		return
	}
	go func() {
		defer saferun.Recover("ws.hub.subscribeUserChannel")
		ctx := context.Background()
		if !h.channelGate(ctx, userID, peer) {
			return
		}
		h.mu.RLock()
		sinks := make([]Sink, 0, len(h.conns[userID]))
		for s := range h.conns[userID] {
			sinks = append(sinks, s)
		}
		h.mu.RUnlock()
		for _, s := range sinks {
			h.SubscribeChannel(ctx, peer, s, SubMember)
		}
	}()
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
