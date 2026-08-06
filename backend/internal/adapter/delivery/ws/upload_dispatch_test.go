package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeUploader struct {
	gotUserID, gotMediaID int64
	gotIndex, gotTotal    int
	gotData               []byte
	err                   error
}

func (f *fakeUploader) SavePart(_ context.Context, userID, mediaID int64, index, total int, data []byte) error {
	f.gotUserID, f.gotMediaID, f.gotIndex, f.gotTotal, f.gotData = userID, mediaID, index, total, append([]byte(nil), data...)
	return f.err
}

// newTestConnWithUpload собирает Conn с userID и заданным UploadDispatcher (по
// образцу fakeFileDisp-тестов в file_dispatch_test.go): только поля, нужные
// dispatchFileUp — send-канал и uploadSem.
func newTestConnWithUpload(t *testing.T, up UploadDispatcher, userID int64) *Conn {
	t.Helper()
	c := &Conn{
		user:      domain.User{ID: userID},
		userID:    userID,
		send:      make(chan outFrame, 4),
		uploadSem: make(chan struct{}, uploadMaxConcurrent),
	}
	c.SetUploadDispatcher(up)
	return c
}

// waitSend ждёт один outFrame из очереди (dispatchFileUp шлёт ack из горутины).
func waitSend(t *testing.T, c *Conn) outFrame {
	t.Helper()
	select {
	case f := <-c.send:
		return f
	case <-time.After(2 * time.Second):
		t.Fatal("no frame sent")
		return outFrame{}
	}
}

// lastSent — синоним waitSend для читаемости в тестах, ожидающих payload ack/err.
func lastSent(t *testing.T, c *Conn) []byte {
	t.Helper()
	return waitSend(t, c).data
}

// containsErr парсит JSON file_up_err и сверяет t/req_id/error.
func containsErr(b []byte, reqID uint32, msg string) bool {
	var f struct {
		T string `json:"t"`
		D struct {
			ReqID uint32 `json:"req_id"`
			Error string `json:"error"`
		} `json:"d"`
	}
	if json.Unmarshal(b, &f) != nil {
		return false
	}
	return f.T == "file_up_err" && f.D.ReqID == reqID && f.D.Error == msg
}

func TestDispatchFileUpOK(t *testing.T) {
	up := &fakeUploader{}
	c := newTestConnWithUpload(t, up, 555) // helper: Conn с userID=555, codec собирающий Send-кадры
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 3, 10, []byte{1, 2, 3}))
	got := lastSent(t, c) // дождаться ack из горутины (единственное чтение c.send)
	if up.gotUserID != 555 || up.gotMediaID != 42 || up.gotIndex != 3 || up.gotTotal != 10 || string(up.gotData) != string([]byte{1, 2, 3}) {
		t.Fatalf("SavePart args mismatch: %+v", up)
	}
	var f struct {
		T string
		D struct {
			ReqID uint32 `json:"req_id"`
		}
	}
	_ = json.Unmarshal(got, &f)
	if f.T != "file_up_ok" || f.D.ReqID != 9 {
		t.Fatalf("expected file_up_ok req_id=9, got %s", got)
	}
}

func TestDispatchFileUpForbidden(t *testing.T) {
	up := &fakeUploader{err: domain.ErrForbidden}
	c := newTestConnWithUpload(t, up, 555)
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 1, 1, []byte{1}))
	if got := lastSent(t, c); !containsErr(got, 9, "forbidden") {
		t.Fatalf("expected file_up_err forbidden, got %s", got)
	}
}

func TestDispatchFileUpTooLarge(t *testing.T) {
	up := &fakeUploader{}
	c := newTestConnWithUpload(t, up, 555)
	big := make([]byte, maxFileUpChunk+1)
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 1, 1, big))
	if up.gotMediaID != 0 { // SavePart не должен вызваться
		t.Fatal("oversized chunk must be rejected before SavePart")
	}
	if got := lastSent(t, c); !containsErr(got, 9, "error") {
		t.Fatalf("expected file_up_err error, got %s", got)
	}
}
