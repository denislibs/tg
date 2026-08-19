package domain

import (
	"encoding/json"
	"testing"
	"time"
)

// Пространство идентификаторов (решение №1): порт tweb isUser.ts / isAnyChat.ts
// / peerIdPolyfill.ts. Знак и есть вид пира — отдельного поля больше нет.
func TestPeerID_Space(t *testing.T) {
	if !PeerID(0).IsUser() || PeerID(0).IsAnyChat() {
		t.Error("0 — пользователь: у оригинала граница именно >= 0")
	}
	if !ToPeerID(42, false).IsUser() || ToPeerID(42, true).IsUser() {
		t.Error("toPeerId(id, isChat) должен уводить чат в отрицательные")
	}
	if got := ToPeerID(7, true); got != -7 {
		t.Errorf("ToPeerID(7, true) = %d, ждали -7", got)
	}
	// Идемпотентность: уже знаковый id чата не должен «выпрямляться».
	if got := ToPeerID(-7, true); got != -7 {
		t.Errorf("ToPeerID(-7, true) = %d, ждали -7", got)
	}
	if got := ToPeerID(-7, true).ToChatID(); got != 7 {
		t.Errorf("ToChatID() = %d, ждали 7 (модуль)", got)
	}
	if got := ToPeerID(42, false).ToUserID(); got != 42 {
		t.Errorf("ToUserID() = %d, ждали 42", got)
	}
	if NullPeerID != 0 {
		t.Errorf("NULL_PEER_ID = %d, ждали 0", NullPeerID)
	}
	if int64(ServicePeerID) != ServiceUserID {
		t.Errorf("SERVICE_PEER_ID = %d, а ServiceUserID = %d — число обязано быть одно", ServicePeerID, ServiceUserID)
	}
}

// Ссылка на пир: собрали из ключа — получили тот же ключ обратно. Базовый
// peerChat в производстве не появляется никогда (решение №2).
func TestPeer_RoundTrip(t *testing.T) {
	for _, id := range []PeerID{0, 42, ServicePeerID, -7} {
		p := NewPeer(id)
		if got := GetPeerID(p); got != id {
			t.Errorf("NewPeer(%d) → %s → %d", id, p.Tag(), got)
		}
	}
	if tag := NewPeer(-7).Tag(); tag != PeerChannelTag {
		t.Errorf("чат собрался как %q, а базовых chat мы не производим", tag)
	}
	if got := GetPeerID(nil); got != NullPeerID {
		t.Errorf("GetPeerID(nil) = %d, ждали NullPeerID", got)
	}
}

// Разбор пользователя: дискриминатор ведёт во вложенные объединения, pFlags
// чистится, чужие ключи и false в модель не попадают.
func TestUser_Unmarshal(t *testing.T) {
	in := []byte(`{"_":"user","pFlags":{"contact":true,"premium":false,"выдуманный":true,"scam":true},
		"id":42,"first_name":"Денис","username":"denis",
		"photo":{"_":"userProfilePhoto","pFlags":{"personal":true,"has_video":false},"photo_id":900,"stripped_thumb":"AQID"},
		"status":{"_":"userStatusOnline","expires":1700000060},
		"emoji_status_emoticon":"🔥"}`)

	u, err := UnmarshalMTUser(in)
	if err != nil {
		t.Fatalf("разбор: %v", err)
	}
	user, ok := u.(UserReal)
	if !ok {
		t.Fatalf("разобрано %#v", u)
	}
	if user.PeerID() != 42 || user.FirstName != "Денис" || user.Username != "denis" {
		t.Errorf("тело разобрано как %#v", user)
	}
	// premium:false — это ОТСУТСТВИЕ флага; выдуманный и не поддержанный нами
	// scam в модель попасть не должны вовсе.
	if len(user.PFlags) != 1 || !user.Contact() {
		t.Errorf("pFlags = %#v, ждали ровно {contact:true}", user.PFlags)
	}
	photo, ok := user.Photo.(UserProfilePhotoReal)
	if !ok || photo.PhotoID != 900 || !photo.Personal() || photo.HasVideo() {
		t.Errorf("photo = %#v", user.Photo)
	}
	if string(photo.StrippedThumb) != "\x01\x02\x03" {
		t.Errorf("stripped_thumb = %v, ждали байты из base64", photo.StrippedThumb)
	}
	status, ok := user.Status.(UserStatusOnline)
	if !ok || status.Expires != 1700000060 {
		t.Errorf("status = %#v", user.Status)
	}
	if user.EmojiStatus != "🔥" {
		t.Errorf("emoji_status_emoticon = %q", user.EmojiStatus)
	}

	t.Run("чужой и отсутствующий конструктор", func(t *testing.T) {
		for _, raw := range []string{`{"_":"userStatusHidden"}`, `null`, `{"online":true}`} {
			s, err := UnmarshalUserStatus([]byte(raw))
			if err != nil || s != nil {
				t.Errorf("%s → %#v, %v; ждали nil, nil", raw, s, err)
			}
		}
		m, err := UnmarshalMTUser([]byte(`{"_":"userSomethingNew","id":1}`))
		if err != nil || m != nil {
			t.Errorf("чужой конструктор User → %#v, %v", m, err)
		}
	})

	t.Run("userEmpty", func(t *testing.T) {
		m, err := UnmarshalMTUser([]byte(`{"_":"userEmpty","id":13}`))
		if err != nil {
			t.Fatalf("разбор: %v", err)
		}
		if e, ok := m.(UserEmpty); !ok || e.PeerID() != 13 {
			t.Errorf("разобрано %#v", m)
		}
	})
}

// Разбор чата: вид чата это конструктор плюс флаги, а не строка.
func TestMTChat_Unmarshal(t *testing.T) {
	in := []byte(`{"_":"channel","pFlags":{"megagroup":true,"forum":true,"broadcast":false,"gigagroup":true},
		"id":8,"title":"наша группа","username":"our_group",
		"photo":{"_":"chatPhoto","photo_id":901},
		"date":1700000000,"participants_count":128,
		"admin_rights":{"_":"chatAdminRights","pFlags":{"ban_users":true,"manage_ranks":true}},
		"default_banned_rights":{"_":"chatBannedRights","pFlags":{"send_media":true},"until_date":0}}`)

	c, err := UnmarshalMTChat(in)
	if err != nil {
		t.Fatalf("разбор: %v", err)
	}
	ch, ok := c.(Channel)
	if !ok {
		t.Fatalf("разобрано %#v", c)
	}
	if ch.PeerID() != -8 {
		t.Errorf("PeerID = %d, ждали -8 (чат — отрицательный)", ch.PeerID())
	}
	if !ch.Megagroup() || !ch.Forum() || ch.Broadcast() {
		t.Errorf("pFlags = %#v", ch.PFlags)
	}
	// gigagroup нами не поддержан — в модель попасть не должен.
	if len(ch.PFlags) != 2 {
		t.Errorf("pFlags = %#v, ждали ровно {megagroup, forum}", ch.PFlags)
	}
	if photo, ok := ch.Photo.(ChatPhotoReal); !ok || photo.PhotoID != 901 {
		t.Errorf("photo = %#v", ch.Photo)
	}
	if !ch.Admin() || ch.AdminRights.Rights() != RightBanUsers {
		t.Errorf("admin_rights = %#v", ch.AdminRights)
	}
	// manage_ranks нами не поддержан и в pFlags остаться не должен.
	if len(ch.AdminRights.PFlags) != 1 {
		t.Errorf("admin_rights.pFlags = %#v", ch.AdminRights.PFlags)
	}
	if got := ch.DefaultBanned.Allowed(); got != AllMemberPerms&^PermSendMedia {
		t.Errorf("default_banned_rights.Allowed() = %d, ждали всё кроме медиа", got)
	}

	t.Run("чужой конструктор", func(t *testing.T) {
		m, err := UnmarshalMTChat([]byte(`{"_":"channelSomethingNew","id":1}`))
		if err != nil || m != nil {
			t.Errorf("→ %#v, %v; ждали nil, nil", m, err)
		}
	})
}

// Права: наш битмаск ↔ конструкторы схемы. chatBannedRights — ИНВЕРСИЯ
// MemberPerms, и это единственное место, которое про неё знает.
func TestRights_ToSchemaAndBack(t *testing.T) {
	for _, r := range []Rights{0, AllRights, RightBanUsers | RightPinMessages} {
		if got := NewChatAdminRights(r).Rights(); got != r {
			t.Errorf("Rights %d → chatAdminRights → %d", r, got)
		}
	}
	if NewChatAdminRights(0).PFlags != nil {
		t.Error("права без единого бита обязаны дать пустой pFlags (ключа нет вовсе)")
	}

	// Всё разрешено ⇒ ни одного запрета.
	if br := NewChatBannedRights(AllMemberPerms, time.Time{}); br.PFlags != nil {
		t.Errorf("все разрешения дали запреты %#v", br.PFlags)
	}
	// Ничего не разрешено ⇒ запрещено всё, что мы умеем.
	full := NewChatBannedRights(0, time.Time{})
	if len(full.PFlags) != len(bannedRightFlags) {
		t.Errorf("pFlags = %#v, ждали %d запретов", full.PFlags, len(bannedRightFlags))
	}
	if !full.Denies("send_messages") || full.Allowed() != 0 {
		t.Errorf("инверсия сломана: %#v", full)
	}
	for _, p := range []MemberPerms{0, AllMemberPerms, PermSendMessages | PermChangeInfo} {
		if got := NewChatBannedRights(p, time.Time{}).Allowed(); got != p {
			t.Errorf("MemberPerms %d → chatBannedRights → %d", p, got)
		}
	}
	// until_date обязателен: 0 («бессрочно») обязан быть в выводе.
	raw, _ := json.Marshal(NewChatBannedRights(AllMemberPerms, time.Time{}))
	if string(raw) != `{"_":"chatBannedRights","until_date":0}` {
		t.Errorf("собрано %s", raw)
	}
}

// Политика реакций чата: 'none'|'all'|'some' это выбор конструктора.
func TestChatReactions_Unmarshal(t *testing.T) {
	in := []byte(`{"_":"chatReactionsSome","reactions":[
		{"_":"reactionEmoji","emoticon":"👍"},
		{"_":"reactionCustomEmoji","document_id":"1"},
		{"emoticon":"старая плоская"}]}`)
	r, err := UnmarshalChatReactions(in)
	if err != nil {
		t.Fatalf("разбор: %v", err)
	}
	some, ok := r.(ChatReactionsSome)
	if !ok || len(some.Reactions) != 1 {
		t.Fatalf("разобрано %#v (чужой конструктор и плоская запись отбрасываются)", r)
	}
	if e, ok := some.Reactions[0].(ReactionEmoji); !ok || e.Emoticon != "👍" {
		t.Errorf("reactions[0] = %#v", some.Reactions[0])
	}

	// Обязательный вектор после круга разбор → сборка остаётся [], а не null.
	r, err = UnmarshalChatReactions([]byte(`{"_":"chatReactionsSome"}`))
	if err != nil {
		t.Fatalf("разбор: %v", err)
	}
	raw, _ := json.Marshal(r)
	if string(raw) != `{"_":"chatReactionsSome","reactions":[]}` {
		t.Errorf("собрано %s", raw)
	}

	if r, _ := UnmarshalChatReactions([]byte(`{"_":"chatReactionsNone"}`)); r == nil || r.Tag() != ChatReactionsNoneTag {
		t.Errorf("chatReactionsNone разобран как %#v", r)
	}
}

// День рождения: год необязателен, и «без года» — это отсутствие ключа, а не
// сентинел на проводе.
func TestBirthday_NoYear(t *testing.T) {
	raw, _ := json.Marshal(NewBirthday(time.Date(1990, time.March, 8, 0, 0, 0, 0, time.UTC)))
	if string(raw) != `{"_":"birthday","day":8,"month":3,"year":1990}` {
		t.Errorf("собрано %s", raw)
	}
	raw, _ = json.Marshal(NewBirthday(time.Date(BirthdayNoYear, time.February, 29, 0, 0, 0, 0, time.UTC)))
	if string(raw) != `{"_":"birthday","day":29,"month":2}` {
		t.Errorf("собрано %s, а сентинел BirthdayNoYear обязан снимать ключ year", raw)
	}
}

// Присутствие с СРОКОМ ГОДНОСТИ — то, чего не было у прежнего `online: true`
// (дефект 1 разбора).
func TestUserStatus_OnlineCarriesExpiry(t *testing.T) {
	raw, _ := json.Marshal(NewUserStatusOnline(time.Unix(1700000060, 0)))
	if string(raw) != `{"_":"userStatusOnline","expires":1700000060}` {
		t.Errorf("собрано %s", raw)
	}
	// Нулевое время — «даты нет»: обязательный параметр всё равно едет.
	raw, _ = json.Marshal(NewUserStatusOffline(time.Time{}))
	if string(raw) != `{"_":"userStatusOffline","was_online":0}` {
		t.Errorf("собрано %s", raw)
	}
}
