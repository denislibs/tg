package domain

import (
	"testing"
	"time"
)

// Строка таблицы → конструкторы схемы: места, где ошибка не видна глазами.

// Полярность прав. Тип MemberPerms носят ДВА поля с противоположным смыслом, и
// перепутать их — значит перевернуть ограничения задом наперёд: снять с
// человека ровно те запреты, которые на него наложили.
//
//	ChatSettings.DefaultPerms      — что МОЖНО  → инвертировать
//	MemberRestriction.DeniedRights — что НЕЛЬЗЯ → НЕ инвертировать ещё раз
func TestRights_BannedPolarity(t *testing.T) {
	// Дефолт чата: разрешено всё, кроме отправки медиа.
	c := ChatRecord{
		ID: 8, Type: ChatTypeGroup,
		Settings: ChatSettings{DefaultPerms: AllMemberPerms &^ PermSendMedia},
	}
	db := c.ToChannel().DefaultBanned
	if db == nil {
		t.Fatal("default_banned_rights не собраны")
	}
	if !db.Denies("send_media") {
		t.Error("снятое разрешение send_media не стало запретом")
	}
	if db.Denies("send_messages") {
		t.Error("разрешённая отправка сообщений оказалась запрещена — полярность перевёрнута")
	}

	// Персональное ограничение: запрещена отправка медиа (и только она).
	until := time.Unix(1_700_000_000, 0)
	r := MemberRestriction{ChatID: 8, UserID: 42, DeniedRights: PermSendMedia, UntilDate: &until}
	br := r.ToChatBannedRights()
	if !br.Denies("send_media") {
		t.Error("персональный запрет send_media потерян")
	}
	if br.Denies("send_messages") || br.Denies("change_info") {
		t.Error("персональные ограничения перевёрнуты: запрещено то, что не запрещали")
	}
	if br.UntilDate != int(until.Unix()) {
		t.Errorf("until_date = %d; want %d", br.UntilDate, until.Unix())
	}
	// Бессрочное ограничение: until_date обязателен по схеме и едет нулём.
	if b := (MemberRestriction{DeniedRights: PermSendMessages}).ToChatBannedRights(); b.UntilDate != 0 {
		t.Errorf("бессрочное ограничение: until_date = %d; want 0", b.UntilDate)
	}
}

// history_for_new и hidden_prehistory — ОДНО свойство с противоположным
// знаком. Забыть инверсию значит показать историю тем, от кого её прячут.
func TestChatRecord_HiddenPrehistoryIsInverted(t *testing.T) {
	visible := ChatRecord{ID: 8, Settings: ChatSettings{HistoryForNew: true}}
	if visible.ToChannelFull().HiddenPrehistory() {
		t.Error("история видна новым, а hidden_prehistory выставлен")
	}
	hidden := ChatRecord{ID: 8, Settings: ChatSettings{HistoryForNew: false}}
	if !hidden.ToChannelFull().HiddenPrehistory() {
		t.Error("история скрыта от новых, а hidden_prehistory НЕ выставлен")
	}
}

// Снимок без зрителя (кадр chat_update один на всех) не должен нести флагов
// членства: пустой MyRole там означает «зрителя не спрашивали», а не «зритель
// вышел из чата». Иначе кадр разошлёт всем участникам сообщение, что они из
// чата вышли.
func TestChatRecord_ViewerlessSnapshotHasNoMembershipFlags(t *testing.T) {
	shared := ChatRecord{ID: 8, Type: ChatTypeGroup} // ViewerID = 0
	c := shared.ToChannel()
	if c.Left() || c.Creator() || c.AdminRights != nil {
		t.Errorf("снимок без зрителя несёт членство: %+v", c.PFlags)
	}
	if !c.Megagroup() {
		t.Error("вид чата потерян: группа обязана быть megagroup")
	}

	viewer := ChatRecord{ID: 8, Type: ChatTypeGroup, ViewerID: 7} // не состоит
	if !viewer.ToChannel().Left() {
		t.Error("зритель вне чата — pFlags.left не выставлен")
	}
}

// Аватарка: «фото нет» это СОСТОЯНИЕ (отдельный конструктор), а не пустое
// значение, и погасить его правилом приватности можно только так же.
func TestUserRecord_PhotoIsAState(t *testing.T) {
	id := int64(900)
	u := UserRecord{ID: 42, FirstName: "Денис", PhotoID: &id, PhotoPreview: []byte{1, 2}}

	shown := u.ToUser(UserFlags{}, nil, true)
	p, ok := shown.Photo.(UserProfilePhotoReal)
	if !ok || p.PhotoID != id {
		t.Fatalf("photo = %#v; want userProfilePhoto с photo_id=%d", shown.Photo, id)
	}
	hidden := u.ToUser(UserFlags{}, nil, false)
	if hidden.Photo.Tag() != UserProfilePhotoEmptyTag {
		t.Errorf("скрытое правилом фото = %#v; want userProfilePhotoEmpty", hidden.Photo)
	}

	// Флаги строки складываются с флагами зрителя, а не затирают их: verified
	// терялся в батче именно потому, что витрина собирала карточку сама.
	rec := UserRecord{ID: 43, IsVerified: true, IsPremium: true, IsBot: true, Deleted: true}
	got := rec.ToUser(UserFlags{Self: true}, nil, true)
	for _, f := range []struct {
		name string
		on   bool
	}{
		{"self", got.Self()}, {"verified", got.Verified()}, {"premium", got.Premium()},
		{"bot", got.Bot()}, {"deleted", got.Deleted()},
	} {
		if !f.on {
			t.Errorf("флаг %q потерян в краткой карточке", f.name)
		}
	}
}

// Присутствие несёт СРОК ГОДНОСТИ: онлайн без дедлайна оставлял бы человека
// онлайн навсегда при потерянном кадре.
func TestPresenceStatus(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	online := PresenceStatus(true, now.Add(time.Minute), now)
	s, ok := online.(UserStatusOnline)
	if !ok || s.Expires != int(now.Add(time.Minute).Unix()) {
		t.Fatalf("онлайн = %#v; want userStatusOnline с expires", online)
	}
	// Онлайн БЕЗ известного дедлайна — не «онлайн навсегда», а последний заход.
	if got := PresenceStatus(true, time.Time{}, now); got.Tag() != UserStatusOfflineTag {
		t.Errorf("онлайн без дедлайна = %q; want userStatusOffline", got.Tag())
	}
	if got := PresenceStatus(false, time.Time{}, time.Time{}); got.Tag() != UserStatusEmptyTag {
		t.Errorf("ничего не известно = %q; want userStatusEmpty", got.Tag())
	}
}
