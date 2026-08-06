package ws

import "testing"

func TestFileUpFrameRoundTrip(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	frame := fileUpFrame(7, 42, 1024, 8192, data)
	reqID, mediaID, offset, total, got, ok := parseFileUp(frame)
	if !ok || reqID != 7 || mediaID != 42 || offset != 1024 || total != 8192 || string(got) != string(data) {
		t.Fatalf("round-trip mismatch: %d %d %d %d %v ok=%v", reqID, mediaID, offset, total, got, ok)
	}
}

func TestParseFileUpShort(t *testing.T) {
	if _, _, _, _, _, ok := parseFileUp(make([]byte, 27)); ok { // < 28Б заголовка
		t.Fatal("short payload must be rejected")
	}
}
