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
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRPC struct{ gotUser int64 }

func (f *fakeRPC) Dispatch(_ context.Context, user domain.User, _ int64, method, path string, body []byte) (int, []byte) {
	f.gotUser = user.ID
	return 200, []byte(`{"ok":true,"m":"` + method + `","p":"` + path + `"}`)
}

func TestConnDispatchesRPCReq(t *testing.T) {
	rpc := &fakeRPC{}
	c := newConn(nil, nil, nil, nil, domain.User{ID: 77}, 5, plainCodec{}, rpc)
	// Читаем c.send напрямую (без реального сокета).
	f := Frame{T: "rpc_req", D: json.RawMessage(`{"req_id":"r1","method":"GET","path":"/dialogs","body":null}`)}
	c.dispatch(context.Background(), f)

	select {
	case raw := <-c.send:
		var out struct {
			T string `json:"t"`
			D struct {
				ReqID  string          `json:"req_id"`
				Status int             `json:"status"`
				Body   json.RawMessage `json:"body"`
			} `json:"d"`
		}
		if json.Unmarshal(raw, &out) != nil || out.T != "rpc_resp" || out.D.ReqID != "r1" || out.D.Status != 200 {
			t.Fatalf("bad rpc_resp: %s", raw)
		}
		if rpc.gotUser != 77 {
			t.Fatalf("user not passed: %d", rpc.gotUser)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no rpc_resp (async dispatch stuck?)")
	}
}

// rpcRespFrame must never return nil (that would silently drop the frame,
// hanging the client's req_id forever) and must always embed a valid-JSON
// body — even when the underlying handler (e.g. chi's stock 404/500) wrote
// plain text.
func TestRpcRespFrame(t *testing.T) {
	parse := func(t *testing.T, raw []byte) (string, string, int, json.RawMessage) {
		t.Helper()
		if raw == nil {
			t.Fatal("rpcRespFrame returned nil")
		}
		var out struct {
			T string `json:"t"`
			D struct {
				ReqID  string          `json:"req_id"`
				Status int             `json:"status"`
				Body   json.RawMessage `json:"body"`
			} `json:"d"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("frame not valid JSON: %v (%s)", err, raw)
		}
		if !json.Valid(out.D.Body) {
			t.Fatalf("body not valid JSON: %s", out.D.Body)
		}
		return out.T, out.D.ReqID, out.D.Status, out.D.Body
	}

	t.Run("plain-text body (chi 404) is wrapped as valid JSON", func(t *testing.T) {
		raw := rpcRespFrame("r1", 404, []byte("404 page not found\n"))
		tt, reqID, status, body := parse(t, raw)
		if tt != "rpc_resp" || reqID != "r1" || status != 404 {
			t.Fatalf("bad envelope: t=%q req_id=%q status=%d", tt, reqID, status)
		}
		var b struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(body, &b); err != nil {
			t.Fatalf("body not decodable: %v (%s)", err, body)
		}
		if !strings.Contains(b.Error, "404 page not found") {
			t.Fatalf("error field missing original text: %q", b.Error)
		}
	})

	t.Run("already-valid JSON body passes through unchanged", func(t *testing.T) {
		raw := rpcRespFrame("r2", 200, []byte(`{"ok":true}`))
		tt, reqID, status, body := parse(t, raw)
		if tt != "rpc_resp" || reqID != "r2" || status != 200 {
			t.Fatalf("bad envelope: t=%q req_id=%q status=%d", tt, reqID, status)
		}
		if string(body) != `{"ok":true}` {
			t.Fatalf("body mutated: %s", body)
		}
	})

	t.Run("nil body becomes JSON null", func(t *testing.T) {
		raw := rpcRespFrame("r3", 200, nil)
		tt, reqID, status, body := parse(t, raw)
		if tt != "rpc_resp" || reqID != "r3" || status != 200 {
			t.Fatalf("bad envelope: t=%q req_id=%q status=%d", tt, reqID, status)
		}
		if string(body) != "null" {
			t.Fatalf("want null body, got %s", body)
		}
	})
}

// TestDNPChannelRPCEndToEnd проверяет сквозной путь: flynn/noise NK initiator
// поднимает DNP-канал (хендшейк + auth), затем шлёт rpc_req внутри канала —
// сервер (dnpAccept → newConn → conn.dispatch) асинхронно диспетчит его через
// fakeRPC и отвечает rpc_resp по тому же зашифрованному каналу. Реальный
// RouterRPC-реплей через chi-роутер покрыт отдельно в http/rpc_test.go — здесь
// важен именно канал (handshake/auth/nonce-последовательность/async-диспатч).
func TestDNPChannelRPCEndToEnd(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	up := websocket.Upgrader{Subprotocols: []string{"dnp/2"}, CheckOrigin: func(*http.Request) bool { return true }}
	rpc := &fakeRPC{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		codec, user, deviceID, err := dnpAccept(r.Context(), wsConn, serverPriv, fakeAuth{token: "good"})
		if err != nil {
			_ = wsConn.Close()
			return
		}
		c := newConn(wsConn, nil, nil, nil, user, deviceID, codec, rpc)
		go c.writePump(context.Background())
		c.readPump(context.Background())
	}))
	defer srv.Close()

	// Клиент: flynn/noise NK initiator по dnp/2 (та же обвязка, что в
	// dnp_accept_test.go — не дублируем, а прогоняем ещё один шаг: rpc_req/rpc_resp).
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

	// rpc_req внутри канала (sealed).
	reqWire, err := dnp.EncryptFrame(iSend, kindJSON([]byte(`{"t":"rpc_req","d":{"req_id":"e1","method":"GET","path":"/dialogs","body":null}}`)))
	if err != nil {
		t.Fatalf("encrypt rpc_req: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, reqWire); err != nil {
		t.Fatalf("write rpc_req: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, respRaw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read rpc_resp: %v", err)
	}
	respFramed, err := dnp.DecryptFrame(iRecv, respRaw)
	if err != nil {
		t.Fatalf("decrypt rpc_resp: %v", err)
	}
	plain := stripKind(t, respFramed)

	var out struct {
		T string `json:"t"`
		D struct {
			ReqID  string          `json:"req_id"`
			Status int             `json:"status"`
			Body   json.RawMessage `json:"body"`
		} `json:"d"`
	}
	if err := json.Unmarshal(plain, &out); err != nil {
		t.Fatalf("bad rpc_resp json: %v (%s)", err, plain)
	}
	if out.T != "rpc_resp" || out.D.ReqID != "e1" || out.D.Status != 200 {
		t.Fatalf("bad rpc_resp: %s", plain)
	}
	if rpc.gotUser != 42 {
		t.Fatalf("fakeRPC did not see the dnpAccept-authenticated user: got %d, want 42", rpc.gotUser)
	}
}
