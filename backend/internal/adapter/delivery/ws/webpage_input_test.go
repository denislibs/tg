package ws

import (
	"encoding/json"
	"strings"
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
	wp := d.webPage()
	if !wp.NoWebpage || !wp.InvertMedia || wp.Media == nil || wp.Media.URL != "https://a.example" ||
		!wp.Media.PFlags["force_large_media"] || d.Text != "x" || d.Media.Contact != nil {
		t.Fatalf("кадр = %+v / %+v", d, wp)
	}
}

// f6-contact (В-10): визитка едет ключом `media` как inputMediaContact; user_id,
// присланный клиентом, схеме не принадлежит и не принимается (его выводит сервер
// по номеру). Решения о превью визитка не несёт.
func TestSendMessageData_ContactMedia(t *testing.T) {
	var d sendMessageData
	raw := `{"peer_id":5,"type":"contact","client_msg_id":"c1",
		"media":{"_":"inputMediaContact","first_name":"Боб","last_name":"Иванов","phone_number":"+79990000002","vcard":"v","user_id":777}}`
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("decode: %v", err)
	}
	c := d.Media.Contact
	if c == nil || c.FirstName != "Боб" || c.LastName != "Иванов" || c.PhoneNumber != "+79990000002" || c.Vcard != "v" {
		t.Fatalf("визитка = %+v", c)
	}
	if out, _ := json.Marshal(c); strings.Contains(string(out), "user_id") {
		t.Fatalf("вход визитки несёт user_id: %s", out)
	}
	if wp := d.webPage(); wp.Media != nil || !wp.IsZero() {
		t.Fatalf("визитка стала решением о превью: %+v", wp)
	}
}
