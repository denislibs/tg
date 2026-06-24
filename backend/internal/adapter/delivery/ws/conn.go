package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
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
		msg, err := c.svc.Send(ctx, usecasechat.SendInput{
			ChatID: d.ChatID, SenderID: c.userID, Type: d.Type, Text: d.Text,
			ReplyToID: d.ReplyToID, ClientMsgID: d.ClientMsgID, MediaID: d.MediaID,
		})
		if err != nil {
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
