package ws

import (
	"context"
	"encoding/json"
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
