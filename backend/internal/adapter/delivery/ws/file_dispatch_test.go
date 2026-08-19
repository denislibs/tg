package ws

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeFileDisp struct {
	data  []byte
	total int64
	err   error
}

func (f fakeFileDisp) ReadPart(_ context.Context, _, _, _, _ int64) ([]byte, int64, error) {
	return f.data, f.total, f.err
}

// drainSend ждёт один outFrame из очереди (тест-хелпер: dispatch запускает
// горутину, поэтому читаем с таймаутом через сам канал).
func drainSend(t *testing.T, c *Conn) outFrame {
	t.Helper()
	select {
	case f := <-c.send:
		return f
	case <-time.After(2 * time.Second):
		t.Fatal("no frame sent")
		return outFrame{}
	}
}

func TestDispatchFileReqChunk(t *testing.T) {
	c := &Conn{
		user:    domain.UserRecord{ID: 42},
		userID:  42,
		send:    make(chan outFrame, 4),
		file:    fakeFileDisp{data: []byte("hello"), total: 5},
		fileSem: make(chan struct{}, fileMaxConcurrent),
	}
	c.dispatch(context.Background(), Frame{T: "file_req", D: json.RawMessage(`{"req_id":7,"media_id":3,"offset":0,"limit":512}`)})
	f := drainSend(t, c)
	if f.kind != frameKindFile {
		t.Fatalf("kind = %d, want file", f.kind)
	}
	if binary.BigEndian.Uint32(f.data[0:4]) != 7 || binary.BigEndian.Uint64(f.data[12:20]) != 5 {
		t.Fatalf("bad chunk header: %x", f.data[:24])
	}
	if string(f.data[24:]) != "hello" {
		t.Fatalf("data = %q", f.data[24:])
	}
}

func TestDispatchFileReqForbidden(t *testing.T) {
	c := &Conn{
		userID:  42,
		send:    make(chan outFrame, 4),
		file:    fakeFileDisp{err: domain.ErrForbidden},
		fileSem: make(chan struct{}, fileMaxConcurrent),
	}
	c.dispatch(context.Background(), Frame{T: "file_req", D: json.RawMessage(`{"req_id":9,"media_id":3,"offset":0,"limit":512}`)})
	f := drainSend(t, c)
	if f.kind != frameKindJSON {
		t.Fatalf("err must be JSON kind, got %d", f.kind)
	}
	var e struct {
		D struct {
			ReqID uint32 `json:"req_id"`
			Error string `json:"error"`
		} `json:"d"`
	}
	if err := json.Unmarshal(f.data, &e); err != nil || e.D.ReqID != 9 || e.D.Error != "forbidden" {
		t.Fatalf("bad file_err: %q (%v)", f.data, err)
	}
}
