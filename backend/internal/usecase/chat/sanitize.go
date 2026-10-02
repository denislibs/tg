package chat

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
