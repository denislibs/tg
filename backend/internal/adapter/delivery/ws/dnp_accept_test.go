package ws

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
)

type fakeAuth struct{ token string }

func (f fakeAuth) Authenticate(_ context.Context, token string) (domain.User, int64, error) {
	if token != f.token {
		return domain.User{}, 0, domain.ErrForbidden
	}
	return domain.User{ID: 42}, 7, nil
}

// fixedReader и dnpSuite определены в dnp_support_test.go (пакет ws) — не дублировать.
func TestDNPAcceptHandshakeAuthAndTransport(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	up := websocket.Upgrader{Subprotocols: []string{"dnp/2"}, CheckOrigin: func(*http.Request) bool { return true }}
	var gotUser, gotDevice int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		codec, user, did, err := dnpAccept(r.Context(), wsConn, serverPriv, fakeAuth{token: "good"})
		if err != nil {
			_ = wsConn.Close()
			return
		}
		gotUser, gotDevice = user.ID, did
		// Отправить один зашифрованный кадр обратно (проверка send-стороны).
		_, out := codec.encode(frameKindJSON, []byte(`{"t":"pong"}`))
		_ = wsConn.WriteMessage(websocket.BinaryMessage, out)
	}))
	defer srv.Close()

	// Клиент: flynn/noise NK initiator по dnp/2.
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	d := websocket.Dialer{Subprotocols: []string{"dnp/2"}}
	conn, _, err := d.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	initHS, _ := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: rand.Reader, Pattern: noise.HandshakeNK,
		Initiator: true, Prologue: []byte("dnp/2"), PeerStatic: serverStatic.Public,
	})
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	_ = conn.WriteMessage(websocket.BinaryMessage, dnp.FrameLen(msg1))

	_, raw, _ := conn.ReadMessage()
	m2, _ := dnp.UnframeLen(raw)
	_, iSend, iRecv, err := initHS.ReadMessage(nil, m2)
	if err != nil {
		t.Fatalf("read msg2: %v", err)
	}
	// auth-кадр (sealed, kind-байт 0x00=JSON поверх seal-слоя).
	authWire, _ := dnp.EncryptFrame(iSend, kindJSON([]byte(`{"t":"auth","d":{"token":"good"}}`)))
	_ = conn.WriteMessage(websocket.BinaryMessage, authWire)

	// Ответный pong.
	_, praw, _ := conn.ReadMessage()
	pongFramed, err := dnp.DecryptFrame(iRecv, praw)
	if err != nil {
		t.Fatalf("decrypt pong: %v", err)
	}
	pong := stripKind(t, pongFramed)
	var f struct{ T string }
	_ = json.Unmarshal(pong, &f)
	if f.T != "pong" {
		t.Fatalf("want pong, got %q", pong)
	}
	if gotUser != 42 || gotDevice != 7 {
		t.Fatalf("auth not wired: user=%d device=%d", gotUser, gotDevice)
	}
}
