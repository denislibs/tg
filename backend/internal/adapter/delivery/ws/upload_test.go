package ws

import "testing"

func TestFileUpFrameRoundTrip(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	frame := fileUpFrame(7, 42, 2, 10, data)
	reqID, mediaID, index, total, got, ok := parseFileUp(frame)
	if !ok || reqID != 7 || mediaID != 42 || index != 2 || total != 10 || string(got) != string(data) {
		t.Fatalf("round-trip mismatch: %d %d %d %d %v ok=%v", reqID, mediaID, index, total, got, ok)
	}
}

func TestParseFileUpShort(t *testing.T) {
	if _, _, _, _, _, ok := parseFileUp([]byte{0, 1, 2}); ok { // < 24Б заголовка
		t.Fatal("short payload must be rejected")
	}
}

func TestParseFileUpLenMismatch(t *testing.T) {
	frame := fileUpFrame(1, 1, 1, 1, []byte{9, 9, 9})
	frame = frame[:len(frame)-1] // len в заголовке говорит 3, данных 2 → mismatch
	if _, _, _, _, _, ok := parseFileUp(frame); ok {
		t.Fatal("len/data mismatch must be rejected")
	}
}
