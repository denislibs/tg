package chat

import (
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestSanitizeEffect_Whitelist(t *testing.T) {
	// Валидные виды у text-сообщения сохраняются.
	for _, kind := range []string{"fireworks", "confetti", "hearts", "thumbs", "poop", "cake"} {
		if got := sanitizeEffect(kind, "text"); got != kind {
			t.Fatalf("sanitizeEffect(%q, text) = %q; want %q", kind, got, kind)
		}
	}
	// Вне whitelist — отбрасывается.
	for _, bad := range []string{"", "boom", "fireworks; DROP TABLE", "HEARTS"} {
		if got := sanitizeEffect(bad, "text"); got != "" {
			t.Fatalf("sanitizeEffect(%q) = %q; want empty", bad, got)
		}
	}
	// Медиа несёт эффект, служебные/секретные/подарочные — нет.
	if sanitizeEffect("cake", "photo") != "cake" {
		t.Fatal("media message should keep a valid effect")
	}
	for _, typ := range []string{"service", "encrypted", "gift", "poll", "call"} {
		if got := sanitizeEffect("fireworks", typ); got != "" {
			t.Fatalf("type %q must not carry an effect, got %q", typ, got)
		}
	}
}

func TestSanitizeEntities_DropsUnsafeLinks(t *testing.T) {
	in := []domain.MessageEntity{
		{Type: "bold", Offset: 0, Length: 2},
		{Type: "text_link", Offset: 0, Length: 2, URL: "javascript:alert(document.cookie)"},
		{Type: "text_link", Offset: 2, Length: 2, URL: "data:text/html,<script>alert(1)</script>"},
		{Type: "text_link", Offset: 4, Length: 2, URL: "vbscript:msgbox(1)"},
		{Type: "text_link", Offset: 6, Length: 2, URL: "https://example.com/path?q=1"},
		{Type: "text_link", Offset: 8, Length: 2, URL: "/relative/path"},
		{Type: "text_link", Offset: 10, Length: 2, URL: "mailto:a@b.c"},
	}
	out := sanitizeEntities(in)
	for _, e := range out {
		if e.Type == "text_link" && (e.URL == "" || !safeLinkURL(e.URL)) {
			t.Fatalf("unsafe link survived: %q", e.URL)
		}
	}
	// bold + 3 safe links kept; 3 dangerous dropped
	if len(out) != 4 {
		t.Fatalf("want 4 entities kept, got %d: %+v", len(out), out)
	}
}

func TestSafeLinkURL(t *testing.T) {
	bad := []string{"javascript:alert(1)", "JavaScript:alert(1)", "  javascript:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd", ""}
	for _, u := range bad {
		if safeLinkURL(u) {
			t.Errorf("expected unsafe: %q", u)
		}
	}
	good := []string{"http://x.com", "https://x.com", "mailto:a@b.c", "tel:+100", "tg://resolve?domain=x", "/rel", "rel/path", "#anchor"}
	for _, u := range good {
		if !safeLinkURL(u) {
			t.Errorf("expected safe: %q", u)
		}
	}
}
