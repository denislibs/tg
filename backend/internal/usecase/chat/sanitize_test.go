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

// Упоминание пользователя без username (messageEntityMentionName) несёт
// user_id прямо в сущности. Не положительный id — не пользователь: у клиента
// он превращался в NaN → inputUserSelf, то есть в упоминание самого себя
// (клиентский фикс tweb ed51d0c09 — только положительный числовой id даёт
// сущность). Сервер такие сущности не хранит и не рассылает; текст остаётся.
func TestSanitizeEntities_DropsMentionNameWithoutUser(t *testing.T) {
	in := domain.MessageEntities{
		domain.NewMessageEntityMentionName(0, 3, 0),
		domain.NewMessageEntityMentionName(4, 3, -42),
		domain.NewMessageEntityMentionName(8, 3, 777001),
	}
	out := domain.SanitizeEntities(in)
	if len(out) != 1 {
		t.Fatalf("осталось %d сущностей, want 1: %#v", len(out), out)
	}
	v, ok := out[0].(domain.MessageEntityMentionName)
	if !ok || v.UserID != 777001 {
		t.Fatalf("уцелела не та сущность: %#v", out[0])
	}
	if ids := mentionedUserIDs(in); len(ids) != 1 || !ids[777001] {
		t.Fatalf("mentionedUserIDs = %v, want только 777001", ids)
	}
}
