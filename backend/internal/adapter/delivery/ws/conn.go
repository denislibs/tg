package ws

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 25 * time.Second
	maxMessageSize = 1 << 20 // 1 MiB
	sendBuffer     = 32
)

// Presence is the subset of presence.Manager the connection uses (kept as an
// interface so ws doesn't import presence).
type Presence interface {
	Online(ctx context.Context, userID int64) error
	Heartbeat(ctx context.Context, userID int64) error
	Offline(ctx context.Context, userID int64) error
}

// Conn is one client WebSocket connection. It implements Sink.
type Conn struct {
	ws       *websocket.Conn
	hub      *Hub
	svc      *usecasechat.Interactor
	presence Presence
	userID   int64
	deviceID int64
	send     chan []byte
	// активный групповой звонок этого соединения (0 — нет): при обрыве
	// сокета участника автоматически выводим из звонка.
	groupCallChat int64
}

func newConn(ws *websocket.Conn, hub *Hub, svc *usecasechat.Interactor, presence Presence, userID, deviceID int64) *Conn {
	return &Conn{ws: ws, hub: hub, svc: svc, presence: presence, userID: userID, deviceID: deviceID, send: make(chan []byte, sendBuffer)}
}

// Close force-closes the underlying socket (used by the hub on revoke). The
// read pump then exits and run() cleans up.
func (c *Conn) Close() { _ = c.ws.Close() }

// Send queues a frame for the writer. Drops the frame if the buffer is full
// (a stuck client must not block fan-out).
func (c *Conn) Send(frame []byte) {
	select {
	case c.send <- frame:
	default:
	}
}

func (c *Conn) run(ctx context.Context) {
	c.hub.Register(ctx, c.userID, c.deviceID, c)
	if c.presence != nil {
		_ = c.presence.Online(ctx, c.userID)
	}
	go c.writePump(ctx)
	c.readPump(ctx) // blocks until the connection closes
	// Cleanup must not ride the request context: on an abrupt client disconnect
	// it may already be cancelled, which would silently skip the Redis
	// unsubscribe and the offline fan-out (last_seen / presence(offline)).
	cleanupCtx := context.Background()
	if c.groupCallChat != 0 {
		_ = c.svc.LeaveGroupCall(cleanupCtx, c.groupCallChat, c.userID)
	}
	lastUser := c.hub.Unregister(cleanupCtx, c.userID, c.deviceID, c)
	if c.presence != nil && lastUser {
		_ = c.presence.Offline(cleanupCtx, c.userID)
	}
	close(c.send)
}

func (c *Conn) readPump(ctx context.Context) {
	defer c.ws.Close()
	c.ws.SetReadLimit(maxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
		var f Frame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		c.dispatch(ctx, f)
	}
}

func (c *Conn) dispatch(ctx context.Context, f Frame) {
	switch f.T {
	case "ping":
		c.Send([]byte(`{"t":"pong"}`))
	case "send_message":
		var d sendMessageData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		if d.Type == "service" { // server-only type (group action pills)
			return
		}
		var encBody []byte
		if d.EncBody != "" {
			if b, e := base64.StdEncoding.DecodeString(d.EncBody); e == nil {
				encBody = b
			}
		}
		msg, err := c.svc.Send(ctx, usecasechat.SendInput{
			ChatID: d.ChatID, SenderID: c.userID, Type: d.Type, Text: d.Text, Entities: d.Entities,
			ReplyToID: d.ReplyToID, ReplyQuoteText: d.ReplyQuoteText, ReplyQuoteOffset: d.ReplyQuoteOffset,
			ClientMsgID: d.ClientMsgID, MediaID: d.MediaID, GroupedID: d.GroupedID,
			GeoLat: d.GeoLat, GeoLng: d.GeoLng, ContactUserID: d.ContactUserID,
			GeoTitle: d.GeoTitle, GeoAddress: d.GeoAddress,
			GeoLivePeriod: d.GeoLivePeriod, GeoHeading: d.GeoHeading,
			ThreadRootID: d.ThreadRootID,
			EncBody:      encBody, TTLSeconds: d.TTLSeconds,
			Silent: d.Silent, Effect: d.Effect,
			PaidMediaPrice: d.PaidMediaPrice,
		})
		if err != nil {
			// NACK the sender so the client stops retrying and can clear the bubble.
			reason := "failed"
			if errors.Is(err, domain.ErrTooLong) {
				reason = "too_long"
			} else if errors.Is(err, domain.ErrSlowmode) {
				reason = "slowmode"
			} else if errors.Is(err, domain.ErrForbidden) {
				reason = "forbidden"
			} else if errors.Is(err, domain.ErrPrivacy) {
				reason = "privacy"
			} else if errors.Is(err, domain.ErrPaidRequired) {
				reason = "paid_required"
			}
			nack, _ := json.Marshal(map[string]any{
				"t": "message_error",
				"d": map[string]any{"client_msg_id": d.ClientMsgID, "reason": reason},
			})
			c.Send(nack)
			return
		}
		ack, _ := json.Marshal(map[string]any{
			"t": "message_ack",
			"d": map[string]any{"client_msg_id": d.ClientMsgID, "msg_id": msg.ID, "seq": msg.Seq, "created_at": msg.CreatedAt},
		})
		c.Send(ack)
	case "read":
		var d readData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.MarkRead(ctx, d.ChatID, c.userID, d.UpToSeq)
	case "read_media":
		var d readMediaData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.ReadMedia(ctx, d.ChatID, c.userID, d.MsgID)
	case "typing":
		var d typingData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.Typing(ctx, d.ChatID, c.userID, d.Action)
	case "subscribe_channel":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.SubscribeChannel(ctx, d.ChatID, c)
		}
	case "unsubscribe_channel":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.UnsubscribeChannel(ctx, d.ChatID, c)
		}
	// 1:1 call signaling (WebRTC): the server is a dumb relay — the frame is
	// re-addressed to every device of to_user_id with from_user_id stamped in.
	case "call_request", "call_accept", "call_decline", "call_end", "call_signal":
		var d map[string]any
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		to, _ := d["to_user_id"].(float64)
		delete(d, "to_user_id")
		_ = c.svc.RelayCall(ctx, f.T, c.userID, int64(to), d)
	// Групповой звонок: join/leave меняют список участников (+фан-аут
	// group_call_update членам чата), signal — адресное реле SDP/ICE.
	case "group_call_join":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) != nil || d.ChatID == 0 {
			return
		}
		if _, err := c.svc.JoinGroupCall(ctx, d.ChatID, c.userID); err == nil {
			c.groupCallChat = d.ChatID
		}
	case "group_call_leave":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) != nil || d.ChatID == 0 {
			return
		}
		_ = c.svc.LeaveGroupCall(ctx, d.ChatID, c.userID)
		if c.groupCallChat == d.ChatID {
			c.groupCallChat = 0
		}
	case "group_call_signal":
		var d map[string]any
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		to, _ := d["to_user_id"].(float64)
		chatID, _ := d["chat_id"].(float64)
		delete(d, "to_user_id")
		_ = c.svc.RelayGroupCallSignal(ctx, c.userID, int64(chatID), int64(to), d)
	}
}

func (c *Conn) writePump(ctx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.ws.Close()
	}()
	for {
		select {
		case frame, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, frame); err != nil {
				return
			}
		case <-ticker.C:
			if c.presence != nil {
				_ = c.presence.Heartbeat(ctx, c.userID)
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
