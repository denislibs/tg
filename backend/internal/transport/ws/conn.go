package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/messaging"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 25 * time.Second
	maxMessageSize = 1 << 20 // 1 MiB
	sendBuffer     = 32
)

// Conn is one client WebSocket connection. It implements Sink.
type Conn struct {
	ws       *websocket.Conn
	hub      *Hub
	svc      *messaging.Service
	userID   int64
	deviceID int64
	send     chan []byte
}

func newConn(ws *websocket.Conn, hub *Hub, svc *messaging.Service, userID, deviceID int64) *Conn {
	return &Conn{ws: ws, hub: hub, svc: svc, userID: userID, deviceID: deviceID, send: make(chan []byte, sendBuffer)}
}

// Send queues a frame for the writer. Drops the frame if the buffer is full
// (a stuck client must not block fan-out).
func (c *Conn) Send(frame []byte) {
	select {
	case c.send <- frame:
	default:
	}
}

func (c *Conn) run(ctx context.Context) {
	c.hub.Register(ctx, c.userID, c)
	go c.writePump()
	c.readPump(ctx) // blocks until the connection closes
	c.hub.Unregister(ctx, c.userID, c)
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
		msg, err := c.svc.Send(ctx, messaging.SendInput{
			ChatID: d.ChatID, SenderID: c.userID, Type: d.Type, Text: d.Text,
			ReplyToID: d.ReplyToID, ClientMsgID: d.ClientMsgID,
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
		_ = c.svc.Typing(ctx, d.ChatID, c.userID)
	}
}

func (c *Conn) writePump() {
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
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
