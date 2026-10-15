package domain

import "testing"

// A1-01: чат, который зрителю не читается, уходит честным `min` — имя и
// аватарка без членства, default_banned_rights и даты. Чужие настройки чата
// клиент оригинала берёт правами зрителя (hasRights), и `min` с «запрещено
// всё» поверх лежащей карточки блокировал ввод.
func TestChatRecordToChannel_HiddenIsHonestMin(t *testing.T) {
	c := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Чужая", Username: "x", ViewerID: 8, Hidden: true,
		MemberCount: 10, DiscussionChatID: 4, Settings: ChatSettings{DefaultPerms: 0}}
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

// MC-13: pFlags.creator живёт независимо от left (tweb hasRights.ts:6-7,
// :25-27). Вышедший создатель получает карточку с creator и left сразу; чужой
// вышедший — только left.
func TestChatRecordToChannel_LeftCreator(t *testing.T) {
	c := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Г", ViewerID: 7, CreatorID: 7, MyRole: ""}
	ch := c.ToChannel()
	if !ch.PFlags["creator"] || !ch.PFlags["left"] {
		t.Fatalf("вышедший создатель: pFlags = %v, ждали creator и left", ch.PFlags)
	}
	if ch.AdminRights == nil {
		t.Fatal("вышедший создатель без admin_rights: клиент не покажет «Изменить»")
	}

	other := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Г", ViewerID: 8, CreatorID: 7, MyRole: ""}
	if o := other.ToChannel(); o.PFlags["creator"] || !o.PFlags["left"] || o.AdminRights != nil {
		t.Fatalf("вышедший не-создатель: pFlags = %v admin=%v", o.PFlags, o.AdminRights)
	}

	// Состав без зрителя (min-снимок chat_update): создателя в нём нет.
	snap := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Г", CreatorID: 7}
	if s := snap.ToChannel(); s.PFlags["creator"] {
		t.Fatalf("min-снимок без зрителя несёт creator: %v", s.PFlags)
	}
}
