package domain

import "strings"

// Санитизация разметки ПОЛЬЗОВАТЕЛЬСКОГО ввода. Жила в usecase/chat, но
// разметку принимает не только сообщение: заметка контакта
// (`contacts.addContact`/`contacts.updateContactNote`, TextWithEntities) несёт
// те же сущности и обязана проходить ту же проверку — второй копии правил
// заводить нельзя.

// safeLinkSchemes are the URL schemes a text_link entity may use. Anything else
// (javascript:, data:, vbscript:, file:, …) is a code-execution / phishing vector
// when rendered as an <a href>, so such links are dropped.
var safeLinkSchemes = map[string]bool{
	"http": true, "https": true, "mailto": true, "tel": true, "tg": true,
}

// SafeLinkURL reports whether a link URL is safe to store/relay. Scheme-less
// (relative) URLs are allowed; URLs with an explicit scheme must be allow-listed.
func SafeLinkURL(u string) bool {
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

// MaxEntities caps how many formatting spans one message may carry. Without a cap
// a hand-crafted message with thousands of entities would make the client's
// segment renderer (≈O(entities²)) freeze for everyone in the chat — an
// availability attack. A few hundred covers any legitimate formatting.
const MaxEntities = 500

// SanitizeEntities drops formatting entities that are unsafe or abusive to persist:
//   - messageEntityTextUrl with a disallowed URL scheme (javascript:, data:, …) — XSS;
//   - messageEntityCustomEmoji without a document_id — nothing to render, so meaningless;
//   - messageEntityMentionName with a non-positive user_id — no such user;
//   - entities with a non-positive length or negative offset — malformed;
//   - anything beyond MaxEntities — render-time DoS.
//
// The client also sanitizes at render time; this is defense-in-depth so a
// hand-crafted payload can't be stored and later served to a client that forgets to.
//
// Конструкторы, которых мы не знаем, отсеиваются раньше — на разборе
// (MessageEntities.UnmarshalJSON): в модель попадает только объявленное
// объединение, поэтому здесь достаточно проверок по существу.
func SanitizeEntities(es MessageEntities) MessageEntities {
	if len(es) == 0 {
		return es
	}
	out := make(MessageEntities, 0, len(es))
	for _, e := range es {
		offset, length := e.Span()
		if offset < 0 || length <= 0 {
			continue
		}
		switch v := e.(type) {
		case MessageEntityTextURL:
			if !SafeLinkURL(v.URL) {
				continue
			}
		case MessageEntityCustomEmoji:
			// custom_emoji carries the sticker document (media id) that replaces the
			// spanned fallback glyph; without it the entity renders nothing. The media
			// content endpoint enforces its own access, so a bogus id just falls back
			// to the glyph on the client — a positive id is all we validate here.
			if v.DocumentID <= 0 {
				continue
			}
		case MessageEntityMentionName:
			// Упоминание без username несёт user_id прямо в сущности; не
			// положительный id — не пользователь (у клиента NaN становился
			// inputUserSelf — упоминанием самого себя, tweb ed51d0c09).
			// Текст остаётся простым текстом.
			if v.UserID <= 0 {
				continue
			}
		}
		out = append(out, e)
		if len(out) >= MaxEntities {
			break
		}
	}
	return out
}
