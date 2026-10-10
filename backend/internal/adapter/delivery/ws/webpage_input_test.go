package ws

import (
	"encoding/json"
	"testing"
)

// Б-72: кадр send_message несёт поля превью ссылки TL messages.sendMessage.
func TestSendMessageData_WebPageInput(t *testing.T) {
	var d sendMessageData
	raw := `{"peer_id":5,"text":"x","no_webpage":true,"invert_media":true,
		"media":{"_":"inputMediaWebPage","url":"https://a.example","pFlags":{"force_large_media":true}}}`
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !d.NoWebpage || !d.InvertMedia || d.Media == nil || d.Media.URL != "https://a.example" ||
		!d.Media.PFlags["force_large_media"] || d.Text != "x" {
		t.Fatalf("кадр = %+v / %+v", d, d.Media)
	}
}
