package http

import (
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Б-72: тела отправки и правки несут поля TL messages.sendMessage/editMessage
// (no_webpage, invert_media, media:inputMediaWebPage) плоско, рядом с текстом —
// так их шлёт tweb (appMessagesManager.ts:2207-2220, :2733-2753).
func TestWebPageInputDecodes(t *testing.T) {
	raw := `{"text":"https://a.example","no_webpage":true,"invert_media":true,
		"media":{"_":"inputMediaWebPage","url":"https://a.example","pFlags":{"force_small_media":true}}}`
	var edit editBody
	if err := json.Unmarshal([]byte(raw), &edit); err != nil {
		t.Fatalf("editBody: %v", err)
	}
	var send sendBody
	if err := json.Unmarshal([]byte(raw), &send); err != nil {
		t.Fatalf("sendBody: %v", err)
	}
	for name, in := range map[string]struct {
		no, inv bool
		media   *domain.InputMediaWebPage
	}{
		"edit": {edit.NoWebpage, edit.InvertMedia, edit.Media},
		"send": {send.NoWebpage, send.InvertMedia, send.Media.WebPage},
	} {
		if !in.no || !in.inv || in.media == nil || in.media.Underscore != domain.InputMediaWebPageTag ||
			in.media.URL != "https://a.example" || !in.media.PFlags["force_small_media"] {
			t.Errorf("%s: %+v / %+v", name, in, in.media)
		}
	}
	if edit.Text != "https://a.example" {
		t.Errorf("text = %q", edit.Text)
	}
}

// f6-contact (В-10): HTTP-тело отправки несёт визитку тем же ключом `media`,
// что и кадр WS; клиентский user_id не принимается.
func TestSendBody_ContactMedia(t *testing.T) {
	raw := `{"type":"contact","media":{"_":"inputMediaContact","first_name":"Боб","last_name":"Иванов","phone_number":"+7","vcard":"v","user_id":777}}`
	var send sendBody
	if err := json.Unmarshal([]byte(raw), &send); err != nil {
		t.Fatal(err)
	}
	c := send.Media.Contact
	if c == nil || c.FirstName != "Боб" || c.LastName != "Иванов" || c.PhoneNumber != "+7" || c.Vcard != "v" {
		t.Fatalf("визитка = %+v", c)
	}
	if wp := send.Media.WebPageInput(send.NoWebpage, send.InvertMedia); !wp.IsZero() {
		t.Fatalf("визитка стала решением о превью: %+v", wp)
	}
}
