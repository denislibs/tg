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

	// Персональное ограничение: запрещена отправка медиа (и только она); при
	// всех правах по умолчанию действующие запреты — ровно личные.
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	r := MemberRestriction{ChatID: 8, UserID: 42, DeniedRights: PermSendMedia, UntilDate: &until}
	br := ViewerBannedRights(&r, AllMemberPerms, time.Now())
	if br == nil || !br.Denies("send_media") {
		t.Fatal("персональный запрет send_media потерян")
	}
	if br.Denies("send_messages") || br.Denies("change_info") {
		t.Error("персональные ограничения перевёрнуты: запрещено то, что не запрещали")
	}
	if br.UntilDate != int(until.Unix()) {
		t.Errorf("until_date = %d; want %d", br.UntilDate, until.Unix())
	}
	// Бессрочное ограничение: until_date обязателен по схеме и едет нулём.
	if b := ViewerBannedRights(&MemberRestriction{DeniedRights: PermSendMessages}, AllMemberPerms, time.Now()); b.UntilDate != 0 {
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
	// Отсутствие членства обязано быть ВИДНО клиенту: без pFlags.min он
	// принимает снимок за полный `channel` зрителя и снимает с создателя права.
	if !c.PFlags["min"] {
		t.Errorf("снимок без зрителя не помечен min: %+v", c.PFlags)
	}
	if (ChatRecord{ID: 8, Type: ChatTypeGroup, ViewerID: 7, MyRole: RoleMember}).ToChannel().PFlags["min"] {
		t.Error("карточка зрителя помечена min — клиент не поверит её членству")
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
	rec := UserRecord{ID: 43, IsVerified: true, IsPremium: true, IsBot: true, IsService: true, Deleted: true}
	got := rec.ToUser(UserFlags{Self: true}, nil, true)
	for _, f := range []struct {
		name string
		on   bool
	}{
		{"self", got.Self()}, {"verified", got.Verified()}, {"premium", got.Premium()},
		{"bot", got.Bot()}, {"support", got.Support()}, {"deleted", got.Deleted()},
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

// channel.date — дата ВСТУПЛЕНИЯ зрителя, а не дата создания чата. Ошибка
// здесь не видна глазами: поле заполнено, число правдоподобное, форма верная.
//
// Цена — вся подсистема «Похожие каналы». По этой дате клиент оригинала
// вставляет служебное «вы вступили в канал» МЕЖДУ сообщениями
// (tweb appMessagesManager.ts:6888-6930, getDetailsForChannelJoinedService), а
// «Похожие каналы» цепляются ровно к этому баблу и больше ни к чему
// (tweb bubbles.ts:7028-7118, класс bubble-similar-channels). Дата создания,
// отданная участнику, увела бы бабл в самое начало истории.
func TestChatRecord_ChannelDateIsJoinDate(t *testing.T) {
	created := time.Unix(1_600_000_000, 0)
	joined := time.Unix(1_700_000_000, 0)

	member := ChatRecord{
		ID: 8, Type: ChatTypeChannel, ViewerID: 7, MyRole: RoleMember,
		CreatedAt: created, MyJoinedAt: joined,
	}
	if got := member.ToChannel().Date; got != int(joined.Unix()) {
		t.Errorf("участник: date = %d; want %d (вступление, а не создание %d)",
			got, joined.Unix(), created.Unix())
	}

	// Не участник: схема предписывает ему дату создания чата.
	stranger := ChatRecord{ID: 8, Type: ChatTypeChannel, ViewerID: 7, CreatedAt: created}
	if got := stranger.ToChannel().Date; got != int(created.Unix()) {
		t.Errorf("не участник: date = %d; want %d (создание)", got, created.Unix())
	}

	// Снимок БЕЗ зрителя (кадр chat_update один на всех участников): «не
	// спрашивали» — 0, как и соседние горизонты чтения того же снимка. Чужая
	// дата вступления, разосланная всем, была бы прямой ложью, а дата создания
	// — правдоподобной. Ноль клиент отличает штатной веткой
	// `if(!date || …) return` (tweb appMessagesManager.ts:6896).
	shared := ChatRecord{ID: 8, Type: ChatTypeChannel, CreatedAt: created, MyJoinedAt: joined}
	if got := shared.ToChannel().Date; got != 0 {
		t.Errorf("снимок без зрителя: date = %d; want 0", got)
	}
}

// can_view_stats — глазами зрителя: статистику видят создатель и админы канала
// или группы. Снимок без зрителя (chat_update — один на всех) флага не несёт,
// иначе права админа разошлись бы всем участникам.
func TestChatRecord_CanViewStatsForAdminViewer(t *testing.T) {
	cases := []struct {
		name string
		rec  ChatRecord
		want bool
	}{
		{"создатель канала", ChatRecord{ID: 8, Type: ChatTypeChannel, ViewerID: 1, MyRole: RoleCreator}, true},
		{"админ группы", ChatRecord{ID: 8, Type: ChatTypeGroup, ViewerID: 1, MyRole: RoleAdmin}, true},
		{"подписчик", ChatRecord{ID: 8, Type: ChatTypeChannel, ViewerID: 1, MyRole: RoleSubscriber}, false},
		{"снимок без зрителя", ChatRecord{ID: 8, Type: ChatTypeChannel, MyRole: RoleCreator}, false},
	}
	for _, tc := range cases {
		if got := tc.rec.ToChannelFull().PFlags["can_view_stats"]; got != tc.want {
			t.Errorf("%s: can_view_stats = %v; want %v", tc.name, got, tc.want)
		}
	}
}
