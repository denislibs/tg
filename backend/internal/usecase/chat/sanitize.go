package chat

import (
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// safeLinkSchemes are the URL schemes a text_link entity may use. Anything else
// (javascript:, data:, vbscript:, file:, …) is a code-execution / phishing vector
// when rendered as an <a href>, so such links are dropped.
var safeLinkSchemes = map[string]bool{
	"http": true, "https": true, "mailto": true, "tel": true, "tg": true,
}

// messageEffects — whitelist видов эффектов сообщения (наш аналог Telegram
// message effects). Значение вне списка отбрасывается (эффект не сохраняется).
var messageEffects = map[string]bool{
	"fireworks": true, "confetti": true, "hearts": true,
	"thumbs": true, "poop": true, "cake": true,
}

// sanitizeEffect возвращает эффект, только если он из whitelist и тип сообщения
// поддерживает эффект (text или медиа); иначе "" (без эффекта).
func sanitizeEffect(effect, msgType string) string {
	if effect == "" || !messageEffects[effect] {
		return ""
	}
	switch msgType {
	case "service", "encrypted", "gift", "poll", "call":
		return ""
	}
	return effect
}

// safeLinkURL reports whether a link URL is safe to store/relay. Scheme-less
// (relative) URLs are allowed; URLs with an explicit scheme must be allow-listed.
func safeLinkURL(u string) bool {
	u = strings.TrimSpace(u)
	if u == "" {
		return false
	}
	if i := strings.IndexByte(u, ':'); i > 0 {
		// only treat ':' as a scheme separator when no path/query/fragment precedes it
		if !strings.ContainsAny(u[:i], "/?#") {
			return safeLinkSchemes[strings.ToLower(u[:i])]
		}
	}
	return true
}

// maxEntities caps how many formatting spans one message may carry. Without a cap
// a hand-crafted message with thousands of entities would make the client's
// segment renderer (≈O(entities²)) freeze for everyone in the chat — an
// availability attack. A few hundred covers any legitimate formatting.
const maxEntities = 500

// sanitizeEntities drops formatting entities that are unsafe or abusive to persist:
//   - text_link with a disallowed URL scheme (javascript:, data:, …) — XSS;
//   - entities with a non-positive length or negative offset — malformed;
//   - anything beyond maxEntities — render-time DoS.
//
// The client also sanitizes at render time; this is defense-in-depth so a
// hand-crafted payload can't be stored and later served to a client that forgets to.
func sanitizeEntities(es []domain.MessageEntity) []domain.MessageEntity {
	if len(es) == 0 {
		return es
	}
	out := make([]domain.MessageEntity, 0, len(es))
	for _, e := range es {
		if e.Offset < 0 || e.Length <= 0 {
			continue
		}
		if e.Type == "text_link" && !safeLinkURL(e.URL) {
			continue
		}
		out = append(out, e)
		if len(out) >= maxEntities {
			break
		}
	}
	return out
}
