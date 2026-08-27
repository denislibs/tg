package domain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"testing"
	"time"
)

// Механическая сверка модели СООБЩЕНИЯ со схемой TL — тот же сверщик
// (schemaChecker), что у медиа, сущностей, разметки, пиров и диалогов, те же
// два утверждения:
//
//  1. Лишнего нет: каждый ключ сериализованного объекта — параметр конструктора
//     из схемы либо клиентский параметр из schema_additional_params.json.
//
//  2. Пропущенное названо: обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета» ниже.
//
// Модель у сообщения самая глубокая из всех, поэтому обход вложенный:
// message → media / entities / reply_markup / reply_to (→ reply_from,
// reply_media, quote_entities) / replies / reactions (→ reaction,
// recent_reactions) / factcheck (→ text → entities), messageService → action
// (→ photo, banned_rights, reason).
//
// Про `flags2` у message. У этого конструктора ДВА слова флагов, и сверщик с
// ними справляется без единой оговорки: он различает параметры по СУФФИКСУ
// типа (`?true` — булев флаг, `#` — сама маска), а не по имени слова, поэтому
// `flags2:#` отбрасывается тем же isFlagsHolder, что и `flags:#`, а
// `offline:flags2.1?true` попадает в набор булевых флагов наравне с
// `out:flags.1?true`. На фазе 0 второе слово не значит ничего (pFlags плоский);
// значить оно начнёт на фазе 2, где от него зависит раскладка потока.
//
// Тест не проверяет типы значений и порядок полей — это работа кодека (фаза 2).

// messageOmittedWithoutSubject — обязательные параметры схемы, которых мы
// сознательно не производим. Каждая строка — утверждение, а не забывчивость.
//
// Необязательные пропуски (message.saved_peer_id, via_bot_id, post_author,
// pFlags.out/silent/noforwards/invert_media, messageReplies.max_id/read_max_id,
// messageActionTopicCreate.icon_emoji_id, factCheck.need_check и прочие) сюда
// попасть не могут по устройству сверщика — он спрашивает только про
// ОБЯЗАТЕЛЬНЫЕ параметры. Они названы в шапке mtmessage.go, и это не
// формальность: на фазе 2 «нет предмета» остаётся бесплатным ровно для них.
// messagePendingSubject — ключи, у которых предмет в схеме ЕСТЬ, но
// объединение до него у нас ещё не доведено.
//
// СПИСОК ПУСТ, и это утверждение, а не забытая переменная: гео, место, контакт,
// опрос, чек-лист, розыгрыш, превью ссылки и платное медиа стали конструкторами
// объединения MessageMedia, подарок — служебным действием messageActionStarGift
// (конструктора messageMediaStarGift в схеме нет вовсе, mtgift.go). Механизм
// оставлен: он ловит следующий такой долг ровно там, где его попытаются
// объявить «нашим параметром вне схемы».
//
// Список отдельный от additional СПЕЦИАЛЬНО: additional означает «предмета в
// схеме нет вовсе» (effect_name, enc_body), и объявить долг им значило бы
// закрыть его на бумаге.
var messagePendingSubject = map[string][]string{}

var messageOmittedWithoutSubject = map[string][]string{
	// Отдельного журнала апдейтов у треда нет: pts у нас на чат.
	"messageReplies": {"replies_pts"},
	// Идентификатор звонка — uuid сигнального слоя (callEngine), на сообщение
	// он не сохраняется.
	"messageActionPhoneCall": {"call_id"},
	// Хэш для кэширования запроса; хэш-кэширования запросов у нас нет вовсе.
	"factCheck": {"hash"},
}

// messageOmittedOK — список подсистемы ПЛЮС уже названные пропуски вложенных
// конструкторов медиа. Медиа приезжает внутрь сообщения целиком (media,
// reply_media, photo действий), и его «нет предмета» уже названо один раз в
// OmittedWithoutSubject; переписать те же строки сюда значило бы завести
// второй источник истины ровно того сорта, ради устранения которого программа
// и существует.
func messageOmittedOK() map[string][]string {
	out := map[string][]string{}
	for k, v := range OmittedWithoutSubject {
		out[k] = v
	}
	for k, v := range messageOmittedWithoutSubject {
		out[k] = append(append([]string{}, out[k]...), v...)
	}
	return out
}

// allMessageConstructors — по одному экземпляру КАЖДОГО объявленного
// конструктора подсистемы, включая объявленный, но не производимый
// (messageEmpty): его собирают литералом, конструирующей функции у него нет.
//
// Новый конструктор без строки здесь просто не был бы сверен со схемой, поэтому
// список продублирован проверкой полноты ниже.
func allMessageConstructors() []any {
	now := time.Unix(1_700_000_000, 0)

	photo := NewPhoto(77, []PhotoSize{
		NewPhotoStrippedSize([]byte{1, 2, 3}),
		NewPhotoSize(SizeTypeFull, 800, 600, 12345),
	})
	media := NewMessageMediaPhoto(photo, false)

	// Ответ на сообщение из ДРУГОГО чата, с цитатой и недоступным оригиналом:
	// тот самый случай, ради которого схема держит reply_from и reply_media, а
	// у нас лежали ReplySnapshotName и ReplySnapshotText — имя и лейбл строками.
	reply := NewMessageReplyHeader(118)
	reply.ReplyToPeerID = NewPeerChannel(8)
	reply.ReplyToTopID = 100
	reply.ReplyFrom = &MessageFwdHeader{
		Underscore: MessageFwdHeaderTag,
		FromID:     NewPeerUser(42),
		Date:       unixSeconds(now.Add(-time.Hour)),
	}
	reply.ReplyMedia = media
	reply.Quote("вот этот кусок", MessageEntities{NewMessageEntityBold(0, 3)}, 12)
	reply.ForumTopic(true)

	// Полное сообщение: все флаги, все необязательные параметры.
	full := NewMessage(120, NewPeerChannel(8), now, "текст",
		MessageFlags{Mentioned: true, MediaUnread: true, Post: true, Pinned: true})
	full.FromID = NewPeerUser(42)
	full.FwdFrom = &MessageFwdHeader{Underscore: MessageFwdHeaderTag, Date: unixSeconds(now)}
	full.ReplyTo = &reply
	full.Media = media
	full.ReplyMarkup = NewReplyInlineMarkup([]KeyboardButtonRow{
		NewKeyboardButtonRow(NewKeyboardButtonURL("сайт", "https://example.org")),
	})
	full.Entities = MessageEntities{NewMessageEntityItalic(0, 5)}
	full.PostCounters(900, 7)
	full.Replies = ptr(NewMessageReplies(12, 9, []Peer{NewPeerUser(42), NewPeerUser(43)}))
	full.EditDate = unixSeconds(now.Add(time.Minute))
	full.GroupedID = 555
	full.Reactions = ptr(NewMessageReactions(
		[]MTReactionCount{
			NewReactionCount(NewReactionEmoji("🔥"), 3, true),
			NewReactionCount(NewReactionPaid(), 10, false),
		},
		[]MessagePeerReaction{NewMessagePeerReaction(NewPeerUser(43), now, NewReactionEmoji("🔥"))},
	))
	full.Reactions.TopReactors = []MessageReactor{NewMyMessageReactor(25)}
	full.TTLPeriod = 86400
	full.RandomID = "cm-1"
	full.SendAt = now.Add(time.Hour).Unix()
	full.WhenOnline = true
	full.EncBody = "AQID"
	full.DestructAt = ptr(now.Add(time.Minute).Format(time.RFC3339))
	full.Effect = "fireworks"
	full.FactCheck = ptr(NewFactCheck("RU", NewTextWithEntities("это не так",
		MessageEntities{NewMessageEntityBold(0, 3)})))

	// Пустое сообщение: ни одного флага, ни одного необязательного параметра.
	// pFlags обязан исчезнуть, а обязательные id/peer_id/date/message —
	// остаться даже нулевыми: подпись у картинки бывает пустой, и это ПУСТАЯ
	// СТРОКА, а не отсутствие ключа.
	empty := NewMessage(1, NewPeerUser(42), time.Time{}, "", MessageFlags{})

	return []any{
		// ── Message ──────────────────────────────────────────────────────────
		full,
		empty,
		// Дыра в истории: объявлена, не производится — поэтому литерал.
		MessageEmpty{Underscore: MessageEmptyTag, ID: 119, PeerID: NewPeerChannel(8)},
		// Служебное сообщение: цель закрепления адресуется reply_to, потому что
		// параметров у messageActionPinMessage нет вовсе.
		func() MessageService {
			s := NewMessageService(121, NewPeerChannel(8), now, NewMessageActionPinMessage(), true)
			s.FromID = NewPeerUser(42)
			s.ReplyTo = ptr(NewMessageReplyHeader(120))
			s.TTLPeriod = 3600
			return s
		}(),

		// ── MessageReplyHeader / MessageReplies ──────────────────────────────
		reply,
		// Ответ внутри своего чата: ни цитаты, ни чужого пира, ни флагов.
		NewMessageReplyHeader(7),
		NewMessageReplies(12, 9, []Peer{NewPeerUser(42)}),
		// Тред без группы обсуждения: pFlags.comments и channel_id делят бит и
		// исчезают вместе, а обязательный replies едет нулём.
		NewMessageReplies(0, 0, nil),

		// ── MessageAction ────────────────────────────────────────────────────
		NewMessageActionChatCreate("группа", []int64{42, 43}),
		NewMessageActionChatEditTitle("новое название"),
		NewMessageActionChatEditPhoto(photo),
		NewMessageActionChatAddUser([]int64{43}),
		NewMessageActionChatDeleteUser(43),
		NewMessageActionChatJoinedByLink(42),
		NewMessageActionPinMessage(),
		NewMessageActionSetMessagesTTL(86400),
		NewMessageActionSetMessagesTTL(0),
		NewMessageActionTopicCreate("тема", 3),
		NewMessageActionSuggestProfilePhoto(photo, true),
		NewMessageActionSuggestProfilePhoto(photo, false),
		NewMessageActionSuggestedPostApproval(true, 8),
		// Одобрено: pFlags.rejected нет вовсе, а не false.
		NewMessageActionSuggestedPostApproval(false, 8),
		NewMessageActionPhoneCall(true, NewPhoneCallDiscardReasonHangup(), 42),
		// Отменённый звонок: duration отсутствует — это и отличает его от
		// состоявшегося.
		NewMessageActionPhoneCall(false, NewPhoneCallDiscardReasonHangup(), 0),
		// НАШ конструктор: сверщик обязан признавать его по записи с полем
		// `type` в schema_additional_params.json, а не считать «предиката нет».
		NewMessageActionRestrict(43, NewChatBannedRights(PermSendMessages, now.Add(time.Hour))),
		// Подарок — ДЕЙСТВИЕ, а не вложение: конструктора messageMediaStarGift в
		// схеме нет вовсе (mtgift.go). Ограниченный подарок с пожеланием и
		// названным дарителем.
		GiftInfo{
			ID: 3, OwnerID: 43, Gift: StarGift{
				ID: 11, Emoji: "\U0001F381", Title: "Мишка", PriceStars: 100, ConvertStars: 70,
				Total: ptr(int64(1000)), Remains: ptr(int64(7)),
			},
			FromID: ptr(int64(42)), Message: "с днём рождения", ConvertStars: 70,
			Date: now,
		}.ToAction(),
		// Анонимный, скрытый из профиля и уже обменянный: три флага, у которых
		// смысл ОТРИЦАЕТСЯ схемой (saved) либо совпадает (name_hidden, converted).
		GiftInfo{
			ID: 4, OwnerID: 43, Gift: StarGift{ID: 12, Emoji: "\U0001F338", PriceStars: 50, ConvertStars: 40, SoldOut: true},
			Anonymous: true, Hidden: true, Converted: true, ConvertStars: 40, Date: now,
		}.ToAction(),
		// Витрина профиля: тот же подарок другим конструктором.
		GiftInfo{
			ID: 3, OwnerID: 43, Gift: StarGift{ID: 11, Emoji: "\U0001F381", PriceStars: 100, ConvertStars: 70},
			FromID: ptr(int64(42)), Message: "с днём рождения", ConvertStars: 70, Date: now,
		}.ToSaved(),
		GiftInfo{ID: 4, OwnerID: 43, Gift: StarGift{ID: 12, PriceStars: 50}, Hidden: true, Date: now}.ToSaved(),

		// ── payments.GiveawayInfo: личное состояние зрителя ──────────────────
		GiveawayInfo{Status: "active", StartDate: now.UnixMilli(), Participants: 12, Participating: true}.ToState(),
		GiveawayInfo{
			Status: "finished", PrizeKind: "stars", Stars: 500, StartDate: now.UnixMilli(),
			UntilDate: now.Add(time.Hour).UnixMilli(), WinnersCount: 2, Participants: 12, IWon: true,
		}.ToState(),

		// ── PhoneCallDiscardReason ───────────────────────────────────────────
		NewPhoneCallDiscardReasonMissed(),
		NewPhoneCallDiscardReasonBusy(),
		NewPhoneCallDiscardReasonHangup(),

		// ── MessageReactions ─────────────────────────────────────────────────
		NewMessageReactions([]MTReactionCount{NewReactionCount(NewReactionEmoji("👍"), 1, false)}, nil),
		// Реакций нет: обязательный вектор едет [], а не null.
		NewMessageReactions(nil, nil),
		NewReactionCount(NewReactionEmoji("🔥"), 3, true),
		NewReactionPaid(),
		NewMessagePeerReaction(NewPeerUser(42), now, NewReactionPaid()),
		// Доска платных ⭐-реакций: вклад зрителя и вклад названного отправителя.
		NewMyMessageReactor(25),
		NewMessageReactor(NewPeerUser(43), 5, false),
		// Анонимный отправитель: ссылки на пир нет ВОВСЕ — это и есть
		// pFlags.anonymous, а не пустая карточка рядом с ним.
		NewMessageReactor(nil, 3, false),

		// ── FactCheck ────────────────────────────────────────────────────────
		NewFactCheck("RU", NewTextWithEntities("это не так", nil)),
		NewTextWithEntities("текст", MessageEntities{NewMessageEntityBold(0, 5)}),

		// ── messages.Messages: контейнер списка ──────────────────────────────
		// Обе формы: «отдано всё» и «отдан кусок». Разница между ними —
		// ВЫБОР КОНСТРУКТОРА, а не булево поле, поэтому сверены обе.
		NewMessagesMessages([]MTMessage{MessageEmpty{Underscore: MessageEmptyTag, ID: 7}}, nil, nil),
		NewMessagesMessagesSlice(120, []MTMessage{MessageEmpty{Underscore: MessageEmptyTag, ID: 7}},
			[]Chat{}, []UserReal{{Underscore: UserTag, ID: 42, FirstName: "Аня"}}),
	}
}

// ptr — адрес значения для необязательных полей-указателей. Литералом их не
// возьмёшь, а заводить переменную под каждый — шум.
func ptr[T any](v T) *T { return &v }

func checkMessagesAgainstSchema(t *testing.T, objects []any) (unexpected, omitted []string) {
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
		constructors:   loadSchemaConstructors(t),
		additional:     loadAdditionalParams(t),
		own:            loadOwnConstructors(t),
		omittedOK:      messageOmittedOK(),
		pendingSubject: messagePendingSubject,
	}
	c.walk(decoded, "messages")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

func TestMessages_MatchesSchema(t *testing.T) {
	unexpected, omitted := checkMessagesAgainstSchema(t, allMessageConstructors())
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// messageConstructorTags — все объявленные подсистемой дискриминаторы.
func messageConstructorTags() []string {
	return []string{
		MessageEmptyTag, MessageTag, MessageServiceTag,
		MessageReplyHeaderTag, MessageRepliesTag,
		MessageActionChatCreateTag, MessageActionChatEditTitleTag,
		MessageActionChatEditPhotoTag, MessageActionChatAddUserTag,
		MessageActionChatDeleteUserTag, MessageActionChatJoinedByLinkTag,
		MessageActionPinMessageTag, MessageActionSetMessagesTTLTag,
		MessageActionTopicCreateTag, MessageActionSuggestProfilePhotoTag,
		MessageActionSuggestedPostApprovalTag, MessageActionPhoneCallTag,
		MessageActionRestrictTag,
		PhoneCallDiscardReasonMissedTag, PhoneCallDiscardReasonBusyTag,
		PhoneCallDiscardReasonHangupTag,
		MessageReactionsTag, ReactionCountTag, ReactionPaidTag, MessagePeerReactionTag,
		MessageReactorTag,
		FactCheckTag, TextWithEntitiesTag,
		MessageActionStarGiftTag, StarGiftTag, SavedStarGiftTag,
		GiveawayInfoTag, GiveawayInfoResultsTag,
		MessagesMessagesTag, MessagesMessagesSliceTag,
	}
}

// Полнота: каждый объявленный дискриминатор реально есть в схеме (или в
// надстройках — для нашего собственного) И реально участвует в сверке. Иначе
// конструктор можно было бы завести и забыть.
func TestMessages_EveryConstructorIsChecked(t *testing.T) {
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
	raw, err := json.Marshal(allMessageConstructors())
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	mark(decoded)

	ctors := loadSchemaConstructors(t)
	own := loadOwnConstructors(t)
	for _, tag := range messageConstructorTags() {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		_, inSchema := ctors[tag]
		_, isOwn := own[tag]
		if !inSchema && !isOwn {
			t.Errorf("конструктора %q нет ни в схеме, ни в надстройках", tag)
		}
	}
}

// pFlags несёт только true: «выключено» — это отсутствие ключа. Проверяется на
// всех уровнях вложенности: pFlags есть у сообщения, у служебного сообщения, у
// заголовка ответа, у треда, у действий и у прав в нашем действии.
func TestMessages_PFlagsNeverFalse(t *testing.T) {
	raw, err := json.Marshal(allMessageConstructors())
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

// Числовой id конструктора в докблоке — не украшение: на фазе 2 именно он
// уходит в поток четырьмя байтами, и по нему читающая сторона узнаёт, что
// разбирает. Проверяется механически, потому что глазами не проверяется.
//
// Здесь у сверки два источника: schema.json для конструкторов оригинала и
// schema_additional_params.json для нашего собственного (messageActionRestrict).
// Второй источник нужен именно потому, что своим конструкторам id назначается
// ЯВНО — правило «id = CRC32 канонической строки» воспроизводится не полностью
// (tl-program.md), и вывести его из определения нельзя.
func TestMessages_ConstructorIDsMatchSchema(t *testing.T) {
	// Подсистема сообщения занимает ДВА файла: подарок вынесен в mtgift.go
	// вместе со своим вложенным starGift. Перечисление файлов, а не одного
	// имени, — иначе новый конструктор в новом файле остался бы без сверки id.
	var src []byte
	for _, file := range []string{"mtmessage.go", "mtgift.go", "mtgiveaway.go"} {
		part, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("исходник подсистемы не читается (%s): %v", file, err)
		}
		src = append(src, part...)
	}

	want := map[string]string{}
	for predicate, ctor := range loadSchemaConstructorIDs(t) {
		want[predicate] = hexCtorID(t, predicate, ctor)
	}
	for predicate, ctor := range loadOwnConstructorIDs(t) {
		if _, clash := want[predicate]; clash {
			t.Errorf("наш конструктор %q подменяет собой конструктор схемы", predicate)
		}
		want[predicate] = hexCtorID(t, predicate, ctor)
	}

	found := map[string]bool{}
	re := regexp.MustCompile(`(?m)^//\s*([A-Za-z][A-Za-z0-9_.]*)#([0-9a-f]{8})\b`)
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		predicate, id := m[1], m[2]
		schemaID, ok := want[predicate]
		if !ok {
			t.Errorf("докблок ссылается на конструктор %q, которого нет ни в схеме, ни в надстройках", predicate)
			continue
		}
		found[predicate] = true
		if schemaID != id {
			t.Errorf("%s: id в докблоке #%s, а в схеме #%s", predicate, id, schemaID)
		}
	}
	// Иначе тест «проходил» бы и на файле без единого докблока.
	for _, tag := range messageConstructorTags() {
		if !found[tag] {
			t.Errorf("у конструктора %q нет докблока с числовым id", tag)
		}
	}
}

// Число, назначенное СВОЕМУ конструктору, обязано быть свободным — иначе на
// фазе 2 читающая сторона разберёт наш кадр как чужой объект и не заметит
// этого. Проверяется по обеим схемам целиком (API и MTProto, конструкторы и
// методы), а не по одному разделу: занятость id не знает про разделы.
func TestMessages_OwnConstructorIDsAreFree(t *testing.T) {
	taken := loadEverySchemaID(t)
	own := loadOwnConstructorIDs(t)
	if len(own) == 0 {
		t.Fatal("своих конструкторов с назначенным id не найдено — проверять нечего")
	}
	for predicate, ctor := range own {
		n, err := strconv.ParseInt(ctor, 10, 64)
		if err != nil {
			t.Fatalf("id конструктора %q не число: %v", predicate, err)
		}
		if other, busy := taken[uint32(n)]; busy {
			t.Errorf("%s: id #%08x уже занят конструктором %q", predicate, uint32(n), other)
		}
	}
}

func hexCtorID(t *testing.T, predicate, ctor string) string {
	t.Helper()
	n, err := strconv.ParseInt(ctor, 10, 64)
	if err != nil {
		t.Fatalf("id конструктора %q не число: %v", predicate, err)
	}
	return fmt.Sprintf("%08x", uint32(n))
}

// loadOwnConstructorIDs — predicate → числовой id для конструкторов, объявленных
// целиком в надстройках. Клиентские синтетические конструкторы оригинала id не
// несут (на провод они не идут) и сюда не попадают.
func loadOwnConstructorIDs(t *testing.T) map[string]string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "schema", "schema_additional_params.json"))
	if err != nil {
		t.Fatalf("надстройки схемы не читаются: %v", err)
	}
	var entries []struct {
		ID        string `json:"id"`
		Predicate string `json:"predicate"`
		Type      string `json:"type"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("надстройки схемы не разбираются: %v", err)
	}
	out := map[string]string{}
	for _, e := range entries {
		if e.Type != "" && e.ID != "" {
			out[e.Predicate] = e.ID
		}
	}
	return out
}

// loadEverySchemaID — все занятые числа схемы: оба раздела (API и MTProto),
// конструкторы и методы.
func loadEverySchemaID(t *testing.T) map[uint32]string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "schema", "schema.json"))
	if err != nil {
		t.Fatalf("схема не читается: %v", err)
	}
	type entry struct {
		ID        string `json:"id"`
		Predicate string `json:"predicate"`
		Method    string `json:"method"`
	}
	type section struct {
		Constructors []entry `json:"constructors"`
		Methods      []entry `json:"methods"`
	}
	var doc struct {
		API     section `json:"API"`
		MTProto section `json:"MTProto"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("схема не разбирается: %v", err)
	}

	out := map[uint32]string{}
	add := func(items []entry) {
		for _, e := range items {
			n, err := strconv.ParseInt(e.ID, 10, 64)
			if err != nil {
				continue
			}
			name := e.Predicate
			if name == "" {
				name = e.Method
			}
			out[uint32(n)] = name
		}
	}
	for _, s := range []section{doc.API, doc.MTProto} {
		add(s.Constructors)
		add(s.Methods)
	}
	return out
}
