package domain

import (
	"encoding/json"
	"testing"
	"time"
)

// Строка витрины → конструкторы схемы. Здесь проверяется таблица соответствия
// разбора (docs/readiness/tl-dialogs-analysis.md) — ровно те места, где ошибка
// не видна глазами: булево, ставшее сроком; флаг, ставший номером папки; вид
// чата, ушедший с провода вовсе.

func TestDialogRecord_ToDialog(t *testing.T) {
	until := time.Unix(1_700_000_000, 0)
	rec := DialogRecord{
		ChatID:               8,
		Type:                 ChatTypeGroup,
		Title:                "Наша группа",
		Username:             "our_group",
		LastReadSeq:          118,
		PeerReadSeq:          117,
		UnreadCount:          2,
		UnreadMentionsCount:  1,
		UnreadReactionsCount: 3,
		NotifySettings:       NewPeerNotifySettings(until, nil, NewNotificationSoundNone()),
		Pinned:               true,
		Folder:               FolderArchive,
		IsForum:              true,
		TopMessageID:         901,
		TTLPeriod:            86400,
	}

	d := rec.ToDialog(NewPeerChannel(8), 120)

	if d.Underscore != DialogTag {
		t.Fatalf("конструктор = %q; want %q", d.Underscore, DialogTag)
	}
	if d.TopMessage != 120 {
		t.Errorf("top_message = %d; want seq последнего сообщения (120)", d.TopMessage)
	}
	if d.ReadInboxMaxID != 118 || d.ReadOutboxMaxID != 117 {
		t.Errorf("горизонты чтения = %d/%d; want 118/117", d.ReadInboxMaxID, d.ReadOutboxMaxID)
	}
	if d.UnreadCount != 2 || d.UnreadMentionsCount != 1 || d.UnreadReactionsCount != 3 {
		t.Errorf("счётчики = %+v", d)
	}
	if !d.Pinned() {
		t.Error("закрепление потеряно")
	}
	// Архив — НОМЕР ПАПКИ, а не булево `archived`.
	if d.FolderID != 1 {
		t.Errorf("folder_id = %d; want 1 (архив)", d.FolderID)
	}
	if d.TTLPeriod != 86400 {
		t.Errorf("ttl_period = %d; want 86400", d.TTLPeriod)
	}
	// Мьют — срок целиком, вместе со звуком-объединением.
	if d.NotifySettings.MuteUntil == nil || int64(*d.NotifySettings.MuteUntil) != until.Unix() {
		t.Errorf("mute_until = %v; want %d", d.NotifySettings.MuteUntil, until.Unix())
	}
	if d.NotifySettings.OtherSound == nil || d.NotifySettings.OtherSound.Tag() != NotificationSoundNoneTag {
		t.Errorf("other_sound = %v; want notificationSoundNone", d.NotifySettings.OtherSound)
	}

	// На проводе не остаётся ни вида чата строкой (решение Р8), ни имени с
	// аватаркой (они едут вектором chats), ни выжимки последнего сообщения.
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	for _, gone := range []string{"type", "title", "username", "is_forum", "archived", "muted",
		"notify_preview", "notify_sound", "last_message", "theme_id", "auto_delete_period"} {
		if _, ok := keys[gone]; ok {
			t.Errorf("снятое поле %q осталось на проводе: %s", gone, raw)
		}
	}
	// Секретным этот чат не является, и признака в кадре быть не должно:
	// «выключено» — это отсутствие ключа.
	if _, ok := keys["secret"]; ok {
		t.Errorf("обычный чат помечен секретным: %s", raw)
	}
}

// Незаархивированный диалог едет БЕЗ folder_id: у оригинала это flags.4?int, и
// ноль ключа не даёт. Нолём его отдавать нельзя — «папка не указана» и «папка
// номер ноль» в схеме разные ответы.
func TestDialogRecord_ToDialog_NoFolderKeyForMainList(t *testing.T) {
	d := DialogRecord{ChatID: 8, Type: ChatTypeGroup, Folder: FolderAll}.ToDialog(NewPeerChannel(8), 0)
	raw, _ := json.Marshal(d)
	var keys map[string]json.RawMessage
	_ = json.Unmarshal(raw, &keys)
	if _, ok := keys["folder_id"]; ok {
		t.Errorf("общий список отдал folder_id: %s", raw)
	}
}

// Секретный чат — НАШ признак вне схемы (решение Р9): подсистема секретных
// чатов вне периметра порта, но живых гейтов по этому признаку больше десятка,
// и молча уронить их нельзя.
func TestDialogRecord_ToDialog_SecretFlag(t *testing.T) {
	d := DialogRecord{ChatID: 8, Type: ChatTypeSecret}.ToDialog(NewPeerChannel(8), 5)
	if !d.Secret {
		t.Fatal("признак секретного чата потерян")
	}
	raw, _ := json.Marshal(d)
	var keys map[string]bool
	_ = json.Unmarshal(raw, &keys)
	if !keys["secret"] {
		t.Errorf("secret не доехал на провод: %s", raw)
	}
}

// Тело чата для вектора chats: вид выражают ФЛАГИ, а не строка. Перепутать
// broadcast и megagroup — значит показать группу каналом и наоборот.
func TestDialogRecord_ToChannel(t *testing.T) {
	photoID := int64(901)
	group := DialogRecord{
		ChatID: 8, Type: ChatTypeGroup, Title: "Группа", Username: "grp", IsForum: true,
		PhotoID: &photoID, PhotoPreview: []byte{1, 2},
	}.ToChannel()
	if group.Underscore != ChannelTag || group.Title != "Группа" || group.Username != "grp" {
		t.Fatalf("группа = %+v", group)
	}
	if !group.PFlags["megagroup"] || group.PFlags["broadcast"] {
		t.Errorf("вид группы = %v; want megagroup", group.PFlags)
	}
	if !group.PFlags["forum"] {
		t.Error("темы группы (is_forum) потеряны")
	}
	if group.Photo == nil || group.Photo.Tag() != ChatPhotoTag {
		t.Errorf("фото = %v; want конструктор chatPhoto", group.Photo)
	}

	channel := DialogRecord{ChatID: 9, Type: ChatTypeChannel, Title: "Канал"}.ToChannel()
	if !channel.PFlags["broadcast"] || channel.PFlags["megagroup"] {
		t.Errorf("вид канала = %v; want broadcast", channel.PFlags)
	}
	// Фото нет — это СОСТОЯНИЕ (chatPhotoEmpty), а не отсутствие ключа.
	if channel.Photo == nil || channel.Photo.Tag() != ChatPhotoEmptyTag {
		t.Errorf("фото канала = %v; want chatPhotoEmpty", channel.Photo)
	}
}

// date строки списка чатов — дата ВСТУПЛЕНИЯ зрителя. Другой здесь и быть не
// может: список строится ОТ его членства (ListDialogs идёт по chat_members
// зрителя), поэтому подстановки даты создания, как у ChatRecord.ChannelDate,
// тут нет. Раньше на её месте ехал нуль — то есть даты вступления, по которой
// клиент ставит «вы вступили в канал», на проводе не было вовсе.
func TestDialogRecord_ToChannelCarriesJoinDate(t *testing.T) {
	joined := time.Unix(1_700_000_100, 0)
	ch := DialogRecord{ChatID: 9, Type: ChatTypeChannel, Title: "Канал", JoinedAt: joined}.ToChannel()
	if ch.Date != int(joined.Unix()) {
		t.Errorf("date = %d; want %d (дата вступления)", ch.Date, joined.Unix())
	}
}

// Строка списка чатов — ПОЛНЫЙ `channel` зрителя, а не выжимка «имя + фото».
// Клиент оригинала заменяет им лежащую карточку целиком (tweb
// appChatsManager.saveApiChat → safeReplaceObject), поэтому каждое поле,
// которого здесь нет, после перечитывания списка для клиента ОБНУЛЯЕТСЯ:
// «1 участник» в шапке вместо числа, «запрещено отправлять сообщения» вместо
// композера (hasRights без default_banned_rights отвечает «нельзя»), создатель
// без своих прав. Поля должны совпадать с карточкой того же зрителя.
func TestDialogRecord_ToChannelMatchesCard(t *testing.T) {
	joined := time.Unix(1_700_000_100, 0)
	settings := ChatSettings{DefaultPerms: AllMemberPerms &^ PermSendMedia, SlowmodeSeconds: 30, ChargeStars: 5}
	d := DialogRecord{
		ChatID: 6, Type: ChatTypeGroup, Title: "Команда", JoinedAt: joined,
		MemberCount: 6, MyRole: RoleCreator, MyRights: AllRights,
		Signatures: true, LinkedChatID: 9, Settings: settings,
	}
	card := ChatRecord{
		ID: 6, Type: ChatTypeGroup, Title: "Команда", ViewerID: 777001, MyJoinedAt: joined,
		MemberCount: 6, MyRole: RoleCreator, MyRights: AllRights,
		Signatures: true, LinkedChatID: 9, Settings: settings,
	}
	got, want := mustJSON(t, d.ToChannel()), mustJSON(t, card.ToChannel())
	if got != want {
		t.Fatalf("строка списка разошлась с карточкой:\n got  %s\n want %s", got, want)
	}

	member := DialogRecord{ChatID: 6, Type: ChatTypeGroup, MemberCount: 6, MyRole: RoleMember, Settings: ChatSettings{DefaultPerms: AllMemberPerms}}.ToChannel()
	if member.Creator() || member.AdminRights != nil {
		t.Errorf("обычный участник получил права: creator=%v admin_rights=%v", member.Creator(), member.AdminRights)
	}
	if member.DefaultBanned == nil || member.DefaultBanned.Denies("send_messages") {
		t.Errorf("default_banned_rights = %+v; want собраны и отправку не запрещают", member.DefaultBanned)
	}
	if member.ParticipantsCount != 6 {
		t.Errorf("participants_count = %d; want 6", member.ParticipantsCount)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// Права ЗРИТЕЛЯ едут на краткой форме чата из списка диалогов — ровно теми же
// полями, что у карточки (ChatRecord.ToChannel): `creator`, `admin_rights`,
// `default_banned_rights`. Без них клиент не может ответить, можно ли писать
// в чат (tweb `hasRights(chat, 'send_plain')`), и селектор пересылки
// показывал каналы, где зритель — простой подписчик. Хуже того, вектор chats
// списка ЗАМЕНЯЕТ карточку в зеркале пиров целиком, и права, приехавшие с
// карточкой, стирались следующей страницей списка.
func TestDialogRecord_ToChannelCarriesViewerRights(t *testing.T) {
	sub := DialogRecord{ChatID: 9, Type: ChatTypeChannel, MyRole: RoleSubscriber, Settings: ChatSettings{DefaultPerms: AllMemberPerms}}.ToChannel()
	if sub.PFlags["creator"] || sub.AdminRights != nil {
		t.Errorf("подписчик получил права владельца/админа: %+v", sub)
	}
	// У broadcast-канала дефолтных прав участника нет (VVA5a-01): пустой набор
	// запретов клиент прочёл бы как «подписчику можно закреплять».
	if sub.DefaultBanned != nil {
		t.Fatalf("default_banned_rights у канала: %+v", sub.DefaultBanned)
	}

	owner := DialogRecord{ChatID: 9, Type: ChatTypeChannel, MyRole: RoleCreator, MyRights: Rights(255), Settings: ChatSettings{DefaultPerms: AllMemberPerms}}.ToChannel()
	if !owner.PFlags["creator"] {
		t.Error("creator потерян")
	}
	if owner.AdminRights == nil || !owner.AdminRights.PFlags["post_messages"] {
		t.Errorf("admin_rights владельца = %+v; want с post_messages", owner.AdminRights)
	}

	// Запрет писать в группе — ВЫСТАВЛЕННЫЙ флаг send_messages (инверсия
	// MemberPerms → chatBannedRights).
	muted := DialogRecord{ChatID: 8, Type: ChatTypeGroup, MyRole: RoleMember, Settings: ChatSettings{DefaultPerms: AllMemberPerms &^ PermSendMessages}}.ToChannel()
	if muted.DefaultBanned == nil || !muted.DefaultBanned.PFlags["send_messages"] {
		t.Errorf("запрет писать потерян: %+v", muted.DefaultBanned)
	}
}
