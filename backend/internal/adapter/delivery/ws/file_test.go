package ws

import (
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestFileChunkFrameLayout(t *testing.T) {
	data := []byte{0x01, 0x02, 0x03, 0x04, 0x05}
	frame := fileChunkFrame(7, 100, 500, data)
	if len(frame) != 24+len(data) {
		t.Fatalf("len = %d, want %d", len(frame), 24+len(data))
	}
	if got := binary.BigEndian.Uint32(frame[0:4]); got != 7 {
		t.Fatalf("req_id = %d", got)
	}
	if got := binary.BigEndian.Uint64(frame[4:12]); got != 100 {
		t.Fatalf("offset = %d", got)
	}
	if got := binary.BigEndian.Uint64(frame[12:20]); got != 500 {
		t.Fatalf("total = %d", got)
	}
	if got := binary.BigEndian.Uint32(frame[20:24]); got != uint32(len(data)) {
		t.Fatalf("len = %d", got)
	}
	if string(frame[24:]) != string(data) {
		t.Fatalf("data mismatch")
	}
}

func TestFileErrFrame(t *testing.T) {
	b := fileErrFrame(9, "forbidden")
	var f struct {
		T string `json:"t"`
		D struct {
			ReqID uint32 `json:"req_id"`
			Error string `json:"error"`
		} `json:"d"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if f.T != "file_err" || f.D.ReqID != 9 || f.D.Error != "forbidden" {
		t.Fatalf("bad frame: %+v", f)
	}
}
