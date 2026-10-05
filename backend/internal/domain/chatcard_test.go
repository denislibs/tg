package domain

import "testing"

// A1-01: чат, который зрителю не читается, уходит честным `min` — имя и
// аватарка без членства, default_banned_rights и даты. Чужие настройки чата
// клиент оригинала берёт правами зрителя (hasRights), и `min` с «запрещено
// всё» поверх лежащей карточки блокировал ввод.
func TestChatRecordToChannel_HiddenIsHonestMin(t *testing.T) {
	c := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Чужая", Username: "x", ViewerID: 8, Hidden: true,
		MemberCount: 10, LinkedChatID: 4, Settings: ChatSettings{DefaultPerms: 0}}
	ch := c.ToChannel()
	if !ch.PFlags["min"] || !ch.PFlags["megagroup"] {
		t.Fatalf("pFlags = %v, want min+megagroup", ch.PFlags)
	}
	if ch.DefaultBanned != nil || ch.AdminRights != nil || ch.ParticipantsCount != 0 || ch.PFlags["left"] {
		t.Fatalf("min несёт пер-зрительское/настройки: %+v", ch)
	}
	if ch.Title != "Чужая" || ch.Username != "x" || !ch.PFlags["has_link"] {
		t.Fatalf("min без имени: %+v", ch)
	}
	// Тот же чат читаемым — полная форма с pFlags.left.
	c.Hidden = false
	if full := c.ToChannel(); full.PFlags["min"] || !full.PFlags["left"] || full.DefaultBanned == nil {
		t.Fatalf("читаемый чужой чат: %+v, want полную форму с left", full)
	}
}
