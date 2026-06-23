package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/realtime"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/transport/ws"
	"github.com/redis/go-redis/v9"
)

func TestWS_LiveDelivery(t *testing.T) {
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	chatSvc.SetPublisher(realtime.NewRedisPublisher(rdb))
	hub := ws.NewHub(ctx, rdb)
	defer hub.Close()
	handler := ws.NewHandler(hub, authSvc, chatSvc)

	srv := httptest.NewServer(http.HandlerFunc(handler.ServeHTTP))
	defer srv.Close()

	// Seed two users + a chat directly via the services.
	_ = authSvc.RequestCode(ctx, "+700")
	ra, _ := authSvc.SignIn(ctx, "+700", "12345", "web", "browser")
	_ = authSvc.RequestCode(ctx, "+701")
	rb, _ := authSvc.SignIn(ctx, "+701", "12345", "web", "browser")
	chatID, _ := chatSvc.CreatePrivateChat(ctx, ra.User.ID, rb.User.ID)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	connA := dial(t, wsURL, ra.Token)
	defer connA.Close()
	connB := dial(t, wsURL, rb.Token)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond) // let both register + subscribe

	// A sends a message.
	sendFrame(t, connA, "send_message", map[string]any{"chat_id": chatID, "text": "hi", "client_msg_id": "c1"})

	// A receives an ack; B receives a new_message.
	if got := readFrameType(t, connA); got != "message_ack" && got != "new_message" {
		t.Fatalf("A first frame = %q", got)
	}
	if got := readUntil(t, connB, "new_message"); got == nil {
		t.Fatal("B did not receive new_message")
	}
}

func dial(t *testing.T, wsURL, token string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(wsURL+"/?token="+token, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func sendFrame(t *testing.T, c *websocket.Conn, typ string, d any) {
	t.Helper()
	raw, _ := json.Marshal(d)
	f, _ := json.Marshal(map[string]any{"t": typ, "d": json.RawMessage(raw)})
	if err := c.WriteMessage(websocket.TextMessage, f); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func readFrameType(t *testing.T, c *websocket.Conn) string {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var f struct {
		T string `json:"t"`
	}
	_ = json.Unmarshal(data, &f)
	return f.T
}

// readUntil reads frames until one with type typ arrives or it times out.
func readUntil(t *testing.T, c *websocket.Conn, typ string) []byte {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := c.ReadMessage()
		if err != nil {
			return nil
		}
		var f struct {
			T string `json:"t"`
		}
		_ = json.Unmarshal(data, &f)
		if f.T == typ {
			return data
		}
	}
	return nil
}
