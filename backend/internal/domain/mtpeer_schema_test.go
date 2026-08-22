package domain

import (
	"encoding/json"
	"sort"
	"testing"
	"time"
)

// Механическая сверка модели ПИРОВ И ЧАТОВ со схемой TL — тот же сверщик
// (schemaChecker), что у медиа, сущностей и разметки, те же два утверждения:
//
//  1. Лишнего нет: каждый ключ сериализованного объекта — параметр конструктора
//     из схемы либо клиентский параметр из schema_additional_params.json.
//
//  2. Пропущенное названо: обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета» ниже.
//
// Модель вложенная (channel → chatPhoto → …, channelFull → photo → photoSize,
// chatReactionsSome → reactionEmoji), поэтому сверщик обходит её целиком.
//
// Тест не проверяет типы значений и порядок полей — это работа кодека (фаза 2).

// peerOmittedWithoutSubject — обязательные параметры схемы, которых мы
// сознательно не производим. Каждая строка — утверждение, а не забывчивость:
// молчаливый пропуск и есть тот способ, которым из модели уходили поля.
var peerOmittedWithoutSubject = map[string][]string{
	// Номер датацентра MTProto-хранилища: у нас файл адресуется одним числовым
	// id через собственный медиа-эндпоинт.
	"userProfilePhoto": {"dc_id"},
	"chatPhoto":        {"dc_id"},

	// settings:PeerSettings — набор «что зрителю предложить сделать с этим
	// пиром» (заблокировать/пожаловаться/добавить в контакты); у нас такого
	// объекта нет вовсе, кнопки решает клиент.
	// notify_settings:PeerNotifySettings — конструктор появился (подсистема
	// диалогов, mtdialog.go), и в channelFull он теперь производится. У userFull
	// производителя ДВА: профиль чужого (зритель известен) и /me (зритель — сам
	// владелец, и приватного чата с собой не существует — есть «Избранное»,
	// другая строка). Положить настройки только в один из них значило бы
	// раздать одну форму двумя разными ответами; предмет при этом никуда не
	// делся и едет строкой диалога — dialog.notify_settings.
	// common_chats_count — общих чатов мы не считаем нигде: ни ручки, ни запроса.
	"userFull": {"settings", "notify_settings", "common_chats_count"},

	// version — счётчик состояния базового chat в MTProto: реквизит
	// синхронизации, а не свойство группы. Сам chat при этом не производится
	// (решение №2), так что вопрос теоретический.
	"chat": {"version"},

	// access_hash — токен доступа к пиру; у нас пир адресуется числовым id.
	// В channelForbidden он ОБЯЗАТЕЛЕН по схеме, поэтому назван здесь явно.
	"channelForbidden": {"access_hash"},

	// participants:ChatParticipants — список участников отдельным объединением
	// (chatParticipant/chatParticipantCreator/chatParticipantAdmin); у нас
	// участники это своя ручка со страницами, а не поле карточки.
	// notify_settings — сам chatFull не производится (решение №2: любая наша
	// группа отдаёт channelFull), поэтому пропуск здесь не про предмет.
	"chatFull": {"participants", "notify_settings"},

	// bot_info:Vector<BotInfo> — карточки ботов чата отдельным конструктором
	// (подсистема ботов).
	// pts — счётчик кадров канала: реквизит синхронизации MTProto. У нас он
	// живёт в channel_updates и едет своей ручкой difference, а не в карточке.
	//
	// notify_settings — предмет ЕСТЬ, и карточка чата его ПРОИЗВОДИТ: подсистема
	// диалогов дала конструктор (mtdialog.go), и прежнее плоское `muted` рядом с
	// ответом ушло. В списке параметр остался ради ОДНОГО случая: снимок
	// chat_update — один на всех участников и зрителя не знает, а настройки
	// уведомлений зритель-зависимы. Пустым конструктором такое не выражается —
	// он означал бы «переопределения нет», то есть чужой ответ, разосланный
	// всем; см. ChatRecord.NotifySettings.
	"channelFull": {"notify_settings", "bot_info", "pts"},

	// Вложенное Photo аватарки чата — тот же список реквизитов транспорта, что
	// у медиа: ссылаемся на него, чтобы источник остался единственным.
	"photo": OmittedWithoutSubject["photo"],
}

// allPeerConstructors — по одному экземпляру КАЖДОГО объявленного конструктора
// подсистемы, включая те, что объявлены, но не производятся (chat, chatForbidden,
// chatFull, peerChat): их собирают литералом, конструирующих функций у них нет.
//
// Новый конструктор без строки здесь просто не был бы сверен со схемой, поэтому
// список продублирован проверкой полноты ниже.
func allPeerConstructors() []any {
	date := time.Unix(1_700_000_000, 0)

	return []any{
		// ── Peer ─────────────────────────────────────────────────────────────
		NewPeerUser(42),
		PeerChat{Underscore: PeerChatTag, ChatID: 7},
		NewPeerChannel(7),

		// ── User ─────────────────────────────────────────────────────────────
		NewUserEmpty(13),
		func() UserReal {
			u := NewUser(42, UserFlags{Self: true, Contact: true, MutualContact: true, Bot: true, Verified: true, Premium: true})
			u.FirstName = "Денис"
			u.LastName = "Уревич"
			u.Username = "denis"
			u.Phone = "+70000000000"
			u.Photo = NewUserProfilePhoto(900, []byte{1, 2, 3}, true, true)
			u.Status = NewUserStatusOnline(date.Add(time.Minute))
			u.EmojiStatus = "🔥"
			return u
		}(),
		// Тот же пользователь без единого флага и без единого необязательного
		// параметра: pFlags обязан исчезнуть, id — остаться.
		NewUser(43, UserFlags{}),
		// Удалённый аккаунт: фото нет как СОСТОЯНИЕ, а не как пустая строка.
		func() UserReal {
			u := NewUser(44, UserFlags{Deleted: true})
			u.Photo = NewUserProfilePhotoEmpty()
			u.Status = NewUserStatusEmpty()
			return u
		}(),

		// ── UserStatus ───────────────────────────────────────────────────────
		NewUserStatusOffline(date),
		NewUserStatusRecently(true),
		NewUserStatusRecently(false),
		NewUserStatusLastWeek(true),
		NewUserStatusLastMonth(true),

		// ── UserFull ─────────────────────────────────────────────────────────
		func() UserFull {
			f := NewUserFull(42, UserFullFlags{Blocked: true, PhoneCallsAvailable: true, VideoCallsAvailable: true})
			f.About = "био"
			f.TTLPeriod = 86400
			b := NewBirthday(time.Date(1990, time.March, 8, 0, 0, 0, 0, time.UTC))
			f.Birthday = &b
			f.ThemeEmoticon = "night"
			return f
		}(),
		NewUserFull(43, UserFullFlags{}),

		// ── Списочные ответы ─────────────────────────────────────────────────
		NewUsersUserFull(NewUserFull(42, UserFullFlags{}), NewUser(42, UserFlags{})),
		NewPeerBlocked(NewPeerUser(42), date),
		NewContactsBlockedSlice(1, []PeerBlocked{NewPeerBlocked(NewPeerUser(42), date)},
			[]UserReal{NewUser(42, UserFlags{})}),
		// Пустая страница: обязательные векторы едут [] , а не null.
		NewContactsBlockedSlice(0, nil, nil),
		NewContactsFound([]Chat{NewChannel(8, "группа", NewChatPhotoEmpty(), date, ChannelFlags{Megagroup: true})},
			[]UserReal{NewUser(42, UserFlags{})}),
		NewContactsFound(nil, nil),

		// ── messageFwdHeader (долг шага B) ───────────────────────────────────
		// Пост канала: автор — сам канал, есть и channel_post, и saved_from_*.
		MessageFwdHeader{
			Underscore:  MessageFwdHeaderTag,
			FromID:      NewPeerChannel(9),
			Date:        unixSeconds(date),
			ChannelPost: 120, SavedFromPeer: NewPeerChannel(9), SavedFromMsgID: 120,
		},
		// Скрытая атрибуция: только имя, ссылки на аккаунт нет вовсе.
		MessageFwdHeader{Underscore: MessageFwdHeaderTag, FromName: "Аноним", Date: unixSeconds(date)},
		// Приватный источник: автор есть, saved_from_* нет — публичного ключа
		// у той строки chats не существует.
		MessageFwdHeader{Underscore: MessageFwdHeaderTag, FromID: NewPeerUser(42), Date: unixSeconds(date)},

		// ── Birthday ─────────────────────────────────────────────────────────
		NewBirthday(time.Date(1990, time.March, 8, 0, 0, 0, 0, time.UTC)),
		// Дата без года: сентинел BirthdayNoYear снимает ключ year.
		NewBirthday(time.Date(BirthdayNoYear, time.February, 29, 0, 0, 0, 0, time.UTC)),

		// ── Chat ─────────────────────────────────────────────────────────────
		NewChatEmpty(7),
		// Базовый chat: объявлен, не производится — поэтому литерал.
		ChatReal{
			Underscore:        ChatTag,
			PFlags:            map[string]bool{"creator": true},
			ID:                7,
			Title:             "базовая группа",
			Photo:             NewChatPhotoEmpty(),
			ParticipantsCount: 3,
			Date:              unixSeconds(date),
		},
		ChatForbidden{Underscore: ChatForbiddenTag, ID: 7, Title: "закрытая группа"},

		// Супергруппа: наш 'group' (решение №2).
		func() Channel {
			c := NewChannel(8, "наша группа", NewChatPhoto(901, []byte{4, 5}, false), date, ChannelFlags{
				Creator: true, Megagroup: true, SlowmodeEnabled: true, Forum: true, HasLink: true,
			})
			c.Username = "our_group"
			c.ParticipantsCount = 128
			ar := NewChatAdminRights(AllRights)
			c.AdminRights = &ar
			br := NewChatBannedRights(PermSendMessages, date.Add(time.Hour))
			c.BannedRights = &br
			db := NewChatBannedRights(AllMemberPerms, time.Time{})
			c.DefaultBanned = &db
			c.SendPaidMessagesStars = 5
			return c
		}(),
		// Канал: наш 'channel'. Обязательные title/photo/date едут и пустыми.
		NewChannel(9, "", NewChatPhotoEmpty(), time.Time{}, ChannelFlags{
			Broadcast: true, Signatures: true, SignatureProfiles: true, Left: true,
		}),
		NewChannelForbidden(9, "недоступный канал", true, false, date),
		NewChannelForbidden(8, "недоступная группа", false, true, time.Time{}),

		// ── Права ────────────────────────────────────────────────────────────
		NewChatAdminRights(AllRights),
		// Ни одного права: pFlags обязан исчезнуть целиком.
		NewChatAdminRights(0),
		NewChatBannedRights(0, date),
		// Всё разрешено и бессрочно: until_date обязателен и едет нулём.
		NewChatBannedRights(AllMemberPerms, time.Time{}),

		// ── ChatReactions ────────────────────────────────────────────────────
		NewChatReactionsNone(),
		NewChatReactionsAll(false),
		NewChatReactionsAll(true),
		NewChatReactionsSome([]string{"👍", "❤️"}),
		// Обязательный вектор едет и пустым.
		NewChatReactionsSome(nil),
		NewReactionEmoji("🔥"),

		// ── Full ─────────────────────────────────────────────────────────────
		// Базовый chatFull: объявлен, не производится — поэтому литерал.
		ChatFull{Underscore: ChatFullTag, ID: 7, About: "о группе", PinnedMsgID: 12, ThemeEmoticon: "night"},
		func() ChannelFull {
			f := NewChannelFull(8, "о канале", NewPhoto(901, []PhotoSize{
				NewPhotoStrippedSize([]byte{4, 5}),
				NewPhotoSize(SizeTypeFull, 640, 640, 40000),
			}), true)
			f.ReadInboxMaxID = 120
			f.ReadOutboxMaxID = 118
			f.UnreadCount = 2
			f.ParticipantsCount = 128
			f.PinnedMsgID = 12
			f.LinkedChatID = 9
			f.SlowmodeSeconds = 30
			f.TTLPeriod = 86400
			f.AvailableReactions = NewChatReactionsSome([]string{"👍"})
			f.SendPaidMessagesStars = 5
			f.ThemeEmoticon = "night"
			ns := NewPeerNotifySettings(time.Unix(MuteUntilForever, 0), nil, NewNotificationSoundNone())
			f.NotifySettings = &ns
			return f
		}(),
		// Пустая карточка: обязательные about/горизонты/unread едут нулями,
		// фото нет (см. шов про photoEmpty в докблоке ChannelFull).
		NewChannelFull(9, "", nil, false),
		NewMessagesChatFull(NewChannelFull(8, "о группе", nil, false),
			NewChannel(8, "группа", NewChatPhotoEmpty(), date, ChannelFlags{Megagroup: true})),
	}
}

func checkPeersAgainstSchema(t *testing.T, objects []any) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(objects)
	if err != nil {
		t.Fatalf("модель не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("модель не разбирается обратно: %v", err)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		omittedOK:    peerOmittedWithoutSubject,
	}
	c.walk(decoded, "peers")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

func TestPeers_MatchesSchema(t *testing.T) {
	unexpected, omitted := checkPeersAgainstSchema(t, allPeerConstructors())
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// peerConstructorTags — все объявленные подсистемой дискриминаторы.
func peerConstructorTags() []string {
	return []string{
		PeerUserTag, PeerChatTag, PeerChannelTag,
		UserEmptyTag, UserTag,
		UserProfilePhotoEmptyTag, UserProfilePhotoTag,
		UserStatusEmptyTag, UserStatusOnlineTag, UserStatusOfflineTag,
		UserStatusRecentlyTag, UserStatusLastWeekTag, UserStatusLastMonthTag,
		UserFullTag, BirthdayTag, UsersUserFullTag,
		PeerBlockedTag, ContactsBlockedSliceTag, ContactsFoundTag,
		MessageFwdHeaderTag,
		ChatEmptyTag, ChatTag, ChatForbiddenTag, ChannelTag, ChannelForbiddenTag,
		ChatPhotoEmptyTag, ChatPhotoTag,
		ChatAdminRightsTag, ChatBannedRightsTag,
		ChatFullTag, ChannelFullTag, MessagesChatFullTag,
		ChatReactionsNoneTag, ChatReactionsAllTag, ChatReactionsSomeTag,
		ReactionEmojiTag,
	}
}

// Полнота: каждый объявленный дискриминатор реально есть в схеме И реально
// участвует в сверке. Иначе конструктор можно было бы завести и забыть.
func TestPeers_EveryConstructorIsChecked(t *testing.T) {
	seen := map[string]bool{}
	var mark func(v any)
	mark = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				mark(item)
			}
		case map[string]any:
			if u, ok := x["_"].(string); ok {
				seen[u] = true
			}
			for _, item := range x {
				mark(item)
			}
		}
	}
	raw, err := json.Marshal(allPeerConstructors())
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	mark(decoded)

	ctors := loadSchemaConstructors(t)
	for _, tag := range peerConstructorTags() {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		if _, ok := ctors[tag]; !ok {
			t.Errorf("конструктора %q нет в схеме", tag)
		}
	}
}

// pFlags несёт только true: «выключено» — это отсутствие ключа. Проверяется на
// всех уровнях вложенности: pFlags есть и у пира, и у его фото, и у прав.
func TestPeers_PFlagsNeverFalse(t *testing.T) {
	raw, err := json.Marshal(allPeerConstructors())
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	var check func(v any)
	check = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				check(item)
			}
		case map[string]any:
			if pf, ok := x["pFlags"]; ok {
				flags, _ := pf.(map[string]any)
				if len(flags) == 0 {
					t.Errorf("%v: пустой pFlags сериализован — должен отсутствовать", x["_"])
				}
				for k, val := range flags {
					if val != true {
						t.Errorf("%v: pFlags[%q] = %v, а «выключено» — это отсутствие ключа", x["_"], k, val)
					}
				}
			}
			for k, item := range x {
				if k != "pFlags" {
					check(item)
				}
			}
		}
	}
	check(decoded)
}
