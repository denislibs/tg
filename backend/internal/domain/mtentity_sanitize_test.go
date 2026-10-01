package domain

import "testing"

func TestSanitizeEntities_DropsUnsafeLinks(t *testing.T) {
	in := MessageEntities{
		NewMessageEntityBold(0, 2),
		NewMessageEntityTextURL(0, 2, "javascript:alert(document.cookie)"),
		NewMessageEntityTextURL(2, 2, "data:text/html,<script>alert(1)</script>"),
		NewMessageEntityTextURL(4, 2, "vbscript:msgbox(1)"),
		NewMessageEntityTextURL(6, 2, "https://example.com/path?q=1"),
		NewMessageEntityTextURL(8, 2, "/relative/path"),
		NewMessageEntityTextURL(10, 2, "mailto:a@b.c"),
	}
	out := SanitizeEntities(in)
	for _, e := range out {
		if v, ok := e.(MessageEntityTextURL); ok && (v.URL == "" || !SafeLinkURL(v.URL)) {
			t.Fatalf("unsafe link survived: %q", v.URL)
		}
	}
	// bold + 3 safe links kept; 3 dangerous dropped
	if len(out) != 4 {
		t.Fatalf("want 4 entities kept, got %d: %+v", len(out), out)
	}
}

func TestSanitizeEntities_CustomEmoji(t *testing.T) {
	in := MessageEntities{
		NewMessageEntityCustomEmoji(0, 2, 42), // kept
		NewMessageEntityCustomEmoji(2, 2, 0),  // dropped: no document
		NewMessageEntityCustomEmoji(4, 2, -1), // dropped: bad document
	}
	out := SanitizeEntities(in)
	if len(out) != 1 {
		t.Fatalf("want 1 custom_emoji kept, got %d: %+v", len(out), out)
	}
	if v, ok := out[0].(MessageEntityCustomEmoji); !ok || v.DocumentID != 42 {
		t.Fatalf("kept entity lost its document_id: %+v", out[0])
	}
}

// Кривая геометрия отбрасывается у ЛЮБОГО конструктора объединения: offset и
// length есть у каждого (MessageEntity.Span), и защита не должна
// зависеть от того, какой именно вариант приехал.
func TestSanitizeEntities_DropsMalformedSpans(t *testing.T) {
	in := MessageEntities{
		NewMessageEntityBold(-1, 2),                     // отрицательный offset
		NewMessageEntityItalic(0, 0),                    // нулевая длина
		NewMessageEntityPre(1, -3, "go"),                // отрицательная длина
		NewMessageEntityBlockquote(2, 0, true),          // нулевая длина
		NewMessageEntityMentionName(-5, 1, 7),           // отрицательный offset
		NewMessageEntitySpoiler(3, 1),                   // валидная — обязана уцелеть
		NewMessageEntityTextURL(4, 1, "https://x.test"), // валидная
	}
	out := SanitizeEntities(in)
	if len(out) != 2 {
		t.Fatalf("want 2 kept, got %d: %+v", len(out), out)
	}
	if out[0].Tag() != EntitySpoiler || out[1].Tag() != EntityTextURL {
		t.Fatalf("выжили не те сущности: %+v", out)
	}
}

// Потолок количества — защита от render-time DoS (см. MaxEntities).
func TestSanitizeEntities_CapsCount(t *testing.T) {
	in := make(MessageEntities, 0, MaxEntities+50)
	for i := 0; i < MaxEntities+50; i++ {
		in = append(in, NewMessageEntityBold(i, 1))
	}
	if out := SanitizeEntities(in); len(out) != MaxEntities {
		t.Fatalf("want %d entities after cap, got %d", MaxEntities, len(out))
	}
}

func TestSafeLinkURL(t *testing.T) {
	bad := []string{"javascript:alert(1)", "JavaScript:alert(1)", "  javascript:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd", ""}
	for _, u := range bad {
		if SafeLinkURL(u) {
			t.Errorf("expected unsafe: %q", u)
		}
	}
	good := []string{"http://x.com", "https://x.com", "mailto:a@b.c", "tel:+100", "tg://resolve?domain=x", "/rel", "rel/path", "#anchor"}
	for _, u := range good {
		if !SafeLinkURL(u) {
			t.Errorf("expected safe: %q", u)
		}
	}
}
