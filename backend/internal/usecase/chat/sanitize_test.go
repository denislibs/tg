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
	in := domain.MessageEntities{
		domain.NewMessageEntityBold(0, 2),
		domain.NewMessageEntityTextURL(0, 2, "javascript:alert(document.cookie)"),
		domain.NewMessageEntityTextURL(2, 2, "data:text/html,<script>alert(1)</script>"),
		domain.NewMessageEntityTextURL(4, 2, "vbscript:msgbox(1)"),
		domain.NewMessageEntityTextURL(6, 2, "https://example.com/path?q=1"),
		domain.NewMessageEntityTextURL(8, 2, "/relative/path"),
		domain.NewMessageEntityTextURL(10, 2, "mailto:a@b.c"),
	}
	out := sanitizeEntities(in)
	for _, e := range out {
		if v, ok := e.(domain.MessageEntityTextURL); ok && (v.URL == "" || !safeLinkURL(v.URL)) {
			t.Fatalf("unsafe link survived: %q", v.URL)
		}
	}
	// bold + 3 safe links kept; 3 dangerous dropped
	if len(out) != 4 {
		t.Fatalf("want 4 entities kept, got %d: %+v", len(out), out)
	}
}

func TestSanitizeEntities_CustomEmoji(t *testing.T) {
	in := domain.MessageEntities{
		domain.NewMessageEntityCustomEmoji(0, 2, 42), // kept
		domain.NewMessageEntityCustomEmoji(2, 2, 0),  // dropped: no document
		domain.NewMessageEntityCustomEmoji(4, 2, -1), // dropped: bad document
	}
	out := sanitizeEntities(in)
	if len(out) != 1 {
		t.Fatalf("want 1 custom_emoji kept, got %d: %+v", len(out), out)
	}
	if v, ok := out[0].(domain.MessageEntityCustomEmoji); !ok || v.DocumentID != 42 {
		t.Fatalf("kept entity lost its document_id: %+v", out[0])
	}
}

// Кривая геометрия отбрасывается у ЛЮБОГО конструктора объединения: offset и
// length есть у каждого (domain.MessageEntity.Span), и защита не должна
// зависеть от того, какой именно вариант приехал.
func TestSanitizeEntities_DropsMalformedSpans(t *testing.T) {
	in := domain.MessageEntities{
		domain.NewMessageEntityBold(-1, 2),                     // отрицательный offset
		domain.NewMessageEntityItalic(0, 0),                    // нулевая длина
		domain.NewMessageEntityPre(1, -3, "go"),                // отрицательная длина
		domain.NewMessageEntityBlockquote(2, 0, true),          // нулевая длина
		domain.NewMessageEntityMentionName(-5, 1, 7),           // отрицательный offset
		domain.NewMessageEntitySpoiler(3, 1),                   // валидная — обязана уцелеть
		domain.NewMessageEntityTextURL(4, 1, "https://x.test"), // валидная
	}
	out := sanitizeEntities(in)
	if len(out) != 2 {
		t.Fatalf("want 2 kept, got %d: %+v", len(out), out)
	}
	if out[0].Tag() != domain.EntitySpoiler || out[1].Tag() != domain.EntityTextURL {
		t.Fatalf("выжили не те сущности: %+v", out)
	}
}

// Потолок количества — защита от render-time DoS (см. maxEntities).
func TestSanitizeEntities_CapsCount(t *testing.T) {
	in := make(domain.MessageEntities, 0, maxEntities+50)
	for i := 0; i < maxEntities+50; i++ {
		in = append(in, domain.NewMessageEntityBold(i, 1))
	}
	if out := sanitizeEntities(in); len(out) != maxEntities {
		t.Fatalf("want %d entities after cap, got %d", maxEntities, len(out))
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
