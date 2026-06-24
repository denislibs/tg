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
	rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasepresence "github.com/messenger-denis/backend/internal/usecase/presence"
	"github.com/redis/go-redis/v9"
)

type wsEnv struct {
	url     string
	tokenA  string
	tokenB  string
	userA   int64
	deviceA int64
	chatID  int64
	ctx     context.Context
	authUC  *usecaseauth.Interactor
	chatSvc *usecasechat.Interactor
	srv     *httptest.Server
	hub     *ws.Hub
	mr      *miniredis.Miniredis
	rdb     *redis.Client
}

func (e *wsEnv) close() {
	e.srv.Close()
	e.hub.Close()
	e.rdb.Close()
	e.mr.Close()
}

func newWSEnv(t *testing.T) *wsEnv {
	t.Helper()
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	repo := pgadapter.NewAuthRepo(pool)
	authUC := usecaseauth.New(repo, repo, repo, "12345", func(string, ...any) {})
	chatSvc := usecasechat.New(
		pgadapter.NewTxManager(pool),
		pgadapter.NewChatsRepo(pool),
		pgadapter.NewMessagesRepo(pool),
		pgadapter.NewUpdatesRepo(pool),
		pgadapter.NewReactionsRepo(pool),
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewGroupRepo(pool),
		pgadapter.NewInviteRepo(pool),
	)
	publisher := rtredis.NewRedisPublisher(rdb)
	chatSvc.SetPublisher(publisher)
	authUC.SetRevocationNotifier(publisher)
	presenceMgr := usecasepresence.NewManager(rtredis.NewPresenceStore(rdb), publisher, chatSvc.ChatPartners, 35*time.Second)
	hub := ws.NewHub(ctx, rdb)
	handler := ws.NewHandler(hub, authUC, chatSvc, presenceMgr)
	srv := httptest.NewServer(http.HandlerFunc(handler.ServeHTTP))

	_ = authUC.RequestCode(ctx, "+700")
	ra, _ := authUC.SignIn(ctx, "+700", "12345", "web", "browser")
	_ = authUC.RequestCode(ctx, "+701")
	rb, _ := authUC.SignIn(ctx, "+701", "12345", "web", "browser")
	chatID, _ := chatSvc.CreatePrivateChat(ctx, ra.User.ID, rb.User.ID)
	_, deviceA, _ := authUC.Authenticate(ctx, ra.Token)

	return &wsEnv{
		url:     "ws" + strings.TrimPrefix(srv.URL, "http"),
		tokenA:  ra.Token, tokenB: rb.Token,
		userA:   ra.User.ID, deviceA: deviceA, chatID: chatID,
		ctx:     ctx, authUC: authUC, chatSvc: chatSvc,
		srv:     srv, hub: hub, mr: mr, rdb: rdb,
	}
}

func TestWS_LiveDelivery(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	connB := dial(t, env.url, env.tokenB)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond) // let both register + subscribe

	// A sends a message.
	sendFrame(t, connA, "send_message", map[string]any{"chat_id": env.chatID, "text": "hi", "client_msg_id": "c1"})

	// A receives an ack; B receives a new_message.
	if got := readUntil(t, connA, "message_ack"); got == nil {
		t.Fatal("A did not receive message_ack")
	}
	if got := readUntil(t, connB, "new_message"); got == nil {
		t.Fatal("B did not receive new_message")
	}
}

func TestWS_Presence(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	time.Sleep(150 * time.Millisecond)
	// B comes online → A should get a presence(online) frame for B.
	connB := dial(t, env.url, env.tokenB)
	defer connB.Close()

	if data := readUntil(t, connA, "presence"); data == nil {
		t.Fatal("A did not receive B's presence")
	}
}

func TestWS_RevokeClosesSocket(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	time.Sleep(150 * time.Millisecond)

	// Revoke A's session → A's socket must close (next read errors).
	if _, err := env.authUC.RevokeSession(env.ctx, env.userA, env.deviceA); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	_ = connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := connA.ReadMessage(); err == nil {
		t.Fatal("expected socket to be closed after revoke")
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
