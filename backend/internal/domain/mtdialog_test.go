package domain

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"
)

// Ключи, которые объект РЕАЛЬНО кладёт на провод. Сверка со схемой отвечает на
// вопрос «нет ли лишнего и не пропущено ли обязательное», но необязательный
// параметр она пропустить не может по устройству — а именно необязательными у
// диалога выражены архив (folder_id), автоудаление (ttl_period) и весь мьют.
// Поэтому набор ключей пинуется здесь: убранное поле краснит тест.
func wireKeys(t *testing.T, v any) []string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func assertKeys(t *testing.T, what string, got, want []string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s: ключи провода\n  есть:  %s\n  ждали: %s", what, strings.Join(got, ","), strings.Join(want, ","))
	}
}

// Полный диалог кладёт на провод ровно то, что мы решили производить: ни
// pts/draft/unread_poll_votes_count (предмета нет), ни выжимки последнего
// сообщения (её место — вектор messages контейнера).
func TestDialog_WireShape(t *testing.T) {
	previews := true
	d := NewDialog(NewPeerChannel(8), 120,
		NewPeerNotifySettings(time.Unix(1_700_003_600, 0), &previews, NewNotificationSoundNone()), true)
	d.ReadInboxMaxID = 118
	d.ReadOutboxMaxID = 117
	d.UnreadCount = 2
	d.UnreadMentionsCount = 1
	d.UnreadReactionsCount = 3
	d.FolderID = 1
	d.TTLPeriod = 86400

	assertKeys(t, "dialog", wireKeys(t, d), []string{
		"_", "folder_id", "notify_settings", "pFlags", "peer",
		"read_inbox_max_id", "read_outbox_max_id", "top_message", "ttl_period",
		"unread_count", "unread_mentions_count", "unread_reactions_count",
	})

	// Пустой диалог: необязательные ключи исчезают целиком, обязательные
	// остаются даже нулевыми — «нет значения» это отсутствие ключа, а не 0.
	empty := NewDialog(NewPeerUser(42), 0, NewPeerNotifySettings(time.Time{}, nil, nil), false)
	assertKeys(t, "пустой dialog", wireKeys(t, empty), []string{
		"_", "notify_settings", "peer",
		"read_inbox_max_id", "read_outbox_max_id", "top_message",
		"unread_count", "unread_mentions_count", "unread_reactions_count",
	})
	if d.Tag() != DialogTag || d.PeerID() != -8 || !d.Pinned() {
		t.Errorf("dialog: tag=%q peer=%d pinned=%v", d.Tag(), d.PeerID(), d.Pinned())
	}
	if empty.Pinned() {
		t.Error("незакреплённый диалог не должен нести флаг pinned")
	}
}

// Настройки уведомлений: каждый ключ появляется только когда переопределение
// ЗАДАНО. «Не задано» и «выключено» — разные ответы, и один bool их склеивал бы.
func TestPeerNotifySettings_WireShape(t *testing.T) {
	previews := false
	s := NewPeerNotifySettings(time.Unix(1_700_003_600, 0), &previews, NewNotificationSoundNone())
	assertKeys(t, "peerNotifySettings", wireKeys(t, s),
		[]string{"_", "mute_until", "other_sound", "show_previews"})

	if s.MuteUntil == nil || *s.MuteUntil != 1_700_003_600 {
		t.Errorf("mute_until = %v, ждали unix-секунды срока", s.MuteUntil)
	}
	assertKeys(t, "пустой peerNotifySettings",
		wireKeys(t, NewPeerNotifySettings(time.Time{}, nil, nil)), []string{"_"})
}

// Числа мьюта — порт оригинала, а не наша выдумка: клиент по MuteUntilForever
// ОТЛИЧАЕТ «навсегда» от «до такого-то часа» (tweb constants.ts:15 MUTE_UNTIL).
// Разойдись число хоть на единицу — «навсегда» показалось бы сроком.
func TestMuteUntil_Constants(t *testing.T) {
	if MuteUntilForever != 0x7FFFFFFF {
		t.Errorf("MuteUntilForever = %d, а tweb MUTE_UNTIL = %d", MuteUntilForever, 0x7FFFFFFF)
	}
	if MuteUntilNever != 0 {
		t.Errorf("MuteUntilNever = %d, а «снять мьют» у оригинала это 0", MuteUntilNever)
	}
}

// Предикат «замьючен ли сейчас» — порт appNotificationsManager.ts:255. Здесь
// чинится дефект разбора: у булева «замьючен» срока годности не было, и
// «заглушить на 1 час» работало как «заглушить навсегда».
func TestPeerNotifySettings_Muted(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	hour := NewPeerNotifySettings(now.Add(time.Hour), nil, nil)

	if !hour.Muted(now) {
		t.Error("замьючен на час — должен быть замьючен сейчас")
	}
	if hour.Muted(now.Add(2 * time.Hour)) {
		t.Error("мьют на час обязан кончиться САМ, без единого кадра с сервера")
	}
	// Ровно в назначенную секунду мьют уже снят: у оригинала условие строгое
	// (mute_until * 1000 > tsNow()).
	if hour.Muted(now.Add(time.Hour)) {
		t.Error("в секунду истечения мьют уже снят")
	}

	forever := NewPeerNotifySettings(time.Unix(MuteUntilForever, 0), nil, nil)
	if !forever.Muted(now) {
		t.Error("замьючен навсегда — должен быть замьючен")
	}

	never := NewPeerNotifySettings(time.Time{}, nil, nil)
	zero := MuteUntilNever
	never.MuteUntil = &zero
	if never.Muted(now) {
		t.Error("mute_until = 0 означает «не замьючен»")
	}

	// Переопределения нет вовсе: пир не замьючен сам по себе, дальше решает
	// настройка типа чата.
	if (NewPeerNotifySettings(time.Time{}, nil, nil)).Muted(now) {
		t.Error("без переопределения пир не замьючен")
	}

	// silent — второй способ молчать, и предикат обязан его знать: иначе
	// чужой кадр с silent прочитался бы как «уведомлять».
	silent := true
	s := NewPeerNotifySettings(time.Time{}, nil, nil)
	s.Silent = &silent
	if !s.Muted(now) {
		t.Error("silent = true — замьючен")
	}
}

// Разбор диалога: дискриминатор ведёт в объединение Peer, pFlags чистится —
// флаг без предмета (unread_mark) и false в модель не попадают.
func TestDialog_Unmarshal(t *testing.T) {
	in := []byte(`{"_":"dialog","pFlags":{"pinned":true,"unread_mark":true,"view_forum_as_messages":false},
		"peer":{"_":"peerChannel","channel_id":8},"top_message":120,
		"read_inbox_max_id":118,"read_outbox_max_id":117,
		"unread_count":2,"unread_mentions_count":1,"unread_reactions_count":3,
		"notify_settings":{"_":"peerNotifySettings","mute_until":2147483647,
			"other_sound":{"_":"notificationSoundNone"}},
		"folder_id":1,"ttl_period":86400}`)

	var d DialogReal
	if err := json.Unmarshal(in, &d); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	if !d.Pinned() {
		t.Error("pinned потерян")
	}
	if d.PFlags["unread_mark"] || d.PFlags["view_forum_as_messages"] {
		t.Errorf("в модель попал флаг без предмета: %v", d.PFlags)
	}
	if d.Peer == nil || d.Peer.Tag() != PeerChannelTag || d.PeerID() != -8 {
		t.Errorf("peer разобран как %#v", d.Peer)
	}
	if d.TopMessage != 120 || d.FolderID != 1 || d.TTLPeriod != 86400 {
		t.Errorf("top_message=%d folder_id=%d ttl_period=%d", d.TopMessage, d.FolderID, d.TTLPeriod)
	}
	if d.NotifySettings.OtherSound == nil || d.NotifySettings.OtherSound.Tag() != NotificationSoundNoneTag {
		t.Errorf("other_sound разобран как %#v", d.NotifySettings.OtherSound)
	}
	if !d.NotifySettings.Muted(time.Unix(1_700_000_000, 0)) {
		t.Error("разобранный «навсегда» обязан читаться как замьючен")
	}
}

// Объединение Dialog: конструктор выбирается дискриминатором, чужой —
// не роняет разбор контейнера.
func TestUnmarshalDialog_Union(t *testing.T) {
	d, err := UnmarshalDialog([]byte(`{"_":"dialog","peer":{"_":"peerUser","user_id":42}}`))
	if err != nil || d == nil || d.Tag() != DialogTag || d.PeerID() != 42 {
		t.Fatalf("dialog: %#v, err=%v", d, err)
	}
	// Строку-папку мы не производим, но чужой кадр с ней обязан пережить круг
	// разбор → сборка: иначе объявлять её было незачем.
	f, err := UnmarshalDialog([]byte(`{"_":"dialogFolder","pFlags":{"pinned":true,"выдуманный":true},
		"peer":{"_":"peerUser","user_id":0},"top_message":120,
		"folder":{"_":"folder","pFlags":{"autofill_public_groups":true},"id":1,"title":"Архив",
			"photo":{"_":"chatPhotoEmpty"}},
		"unread_muted_peers_count":1,"unread_unmuted_peers_count":2,
		"unread_muted_messages_count":3,"unread_unmuted_messages_count":4}`))
	if err != nil || f == nil || f.Tag() != DialogFolderTag || f.PeerID() != NullPeerID {
		t.Fatalf("dialogFolder: %#v, err=%v", f, err)
	}
	folder, ok := f.(DialogFolder)
	if !ok {
		t.Fatalf("dialogFolder разобран как %T", f)
	}
	if !folder.Pinned() || folder.PFlags["выдуманный"] {
		t.Errorf("pFlags строки-папки: %v", folder.PFlags)
	}
	if folder.Folder.Title != "Архив" || !folder.Folder.PFlags["autofill_public_groups"] {
		t.Errorf("папка разобрана как %#v", folder.Folder)
	}
	if folder.Folder.Photo == nil || folder.Folder.Photo.Tag() != ChatPhotoEmptyTag {
		t.Errorf("photo папки разобран как %#v", folder.Folder.Photo)
	}
	if folder.UnreadMutedPeersCount != 1 || folder.UnreadUnmutedMessagesCount != 4 {
		t.Errorf("счётчики папки: %#v", folder)
	}
	unknown, err := UnmarshalDialog([]byte(`{"_":"dialogFromFutureLayer"}`))
	if err != nil || unknown != nil {
		t.Fatalf("чужой конструктор: %#v, err=%v", unknown, err)
	}
}

// Объединение NotificationSound: производим два, чужой звук (рингтон, локальный)
// разбор не роняет — параметр необязательный, поэтому пропуск бесплатен.
func TestUnmarshalNotificationSound_Union(t *testing.T) {
	for tag, want := range map[string]string{
		`{"_":"notificationSoundDefault"}`: NotificationSoundDefaultTag,
		`{"_":"notificationSoundNone"}`:    NotificationSoundNoneTag,
	} {
		s, err := UnmarshalNotificationSound([]byte(tag))
		if err != nil || s == nil || s.Tag() != want {
			t.Errorf("%s → %#v, err=%v", tag, s, err)
		}
	}
	s, err := UnmarshalNotificationSound([]byte(`{"_":"notificationSoundRingtone","id":7}`))
	if err != nil || s != nil {
		t.Errorf("рингтон: %#v, err=%v", s, err)
	}
}

// Контейнер: «это всё» выражает ОТСУТСТВИЕ count (messages.dialogs), а не
// булево is_end — так читает оригинал (appMessagesManager.ts:3614,3629).
// Обязательные векторы едут пустыми, а не null.
func TestMessagesDialogs_WireShape(t *testing.T) {
	assertKeys(t, "messages.dialogs", wireKeys(t, NewMessagesDialogs(nil, nil, nil, nil)),
		[]string{"_", "chats", "dialogs", "messages", "users"})
	assertKeys(t, "messages.dialogsSlice", wireKeys(t, NewMessagesDialogsSlice(42, nil, nil, nil, nil)),
		[]string{"_", "chats", "count", "dialogs", "messages", "users"})

	raw, err := json.Marshal(NewMessagesDialogs(nil, nil, nil, nil))
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	if strings.Contains(string(raw), "null") {
		t.Errorf("обязательный вектор уехал как null: %s", raw)
	}
}
