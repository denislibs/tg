package ws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

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
