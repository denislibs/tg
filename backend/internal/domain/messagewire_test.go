package domain

import (
	"encoding/json"
	"sort"
	"testing"
	"time"
)

// Сверка со схемой с ДРУГОЙ стороны: не модель, а то, что РЕАЛЬНО уезжает на
// провод. mtmessage_schema_test.go проверяет конструкторы, собранные вручную;
// здесь проверяется результат Message.ToWire — единственного перевода строки
// витрины в проводную форму, которым пользуются и HTTP-витрина, и realtime-кадр
// (решение Р5).
//
// Разница между двумя сверками не косметическая. Модель можно объявить
// правильно и наполнять неправильно — ровно так вектор `messages` контейнера
// messages.dialogs жил без сверки: конструкторы были, а наполнял их проводной
// рендерер из delivery/http, и что именно он клал, не проверял никто.

// wireMessage — строка витрины, у которой заполнено ВСЁ, что она умеет нести
// ОДНОВРЕМЕННО. Вложение здесь одно (фотография): гео, контакт, опрос,
// чек-лист, розыгрыш, подарок, превью ссылки и платное медиа взаимно
// исключительны — в схеме media ровно одно, — поэтому каждое из них проверяется
// отдельной строкой (wireMessageWith ниже), а не всё вперемешку.
//
// Прежде они и правда ехали ВПЕРЕМЕШКУ: восемь собственных ключей рядом с
// `media`, и сообщение могло нести одновременно опрос, гео и подарок.
func wireMessage() Message {
	now := time.Unix(1_700_000_000, 0)
	edited := now.Add(time.Minute)
	destruct := now.Add(time.Hour)
	replyTo := int64(118)
	replyPeer := int64(9)
	threadRoot := int64(100)
	quote := "вот этот кусок"
	quoteOffset := 12
	grouped := int64(555)
	ttl := 86400
	mediaID := int64(77)
	sendAs := int64(8)
	clientMsgID := "cm-1"
	transcription := "расшифровка"

	return Message{
		ID: 1, ChatID: 9, Seq: 120, SenderID: 42,
		Type: "photo", Text: "текст",
		Entities:    MessageEntities{NewMessageEntityItalic(0, 5)},
		ReplyToID:   &replyTo,
		MediaID:     &mediaID,
		ClientMsgID: &clientMsgID,
		// Корень треда в ТОМ ЖЕ пире: reply_to_top_id, а не собственное поле.
		ThreadRootID:      &threadRoot,
		GroupedID:         &grouped,
		CreatedAt:         now,
		EditedAt:          &edited,
		FwdFrom:           &MessageFwdHeader{Underscore: MessageFwdHeaderTag, FromID: NewPeerUser(44), Date: unixSeconds(now)},
		ReplyQuoteText:    &quote,
		ReplyQuoteOffset:  &quoteOffset,
		ReplyToPeerID:     &replyPeer,
		ReplySnapshotName: "Автор оригинала",
		Media: NewMessageMediaPhoto(
			NewPhoto(mediaID, []PhotoSize{NewPhotoSize(SizeTypeFull, 800, 600, 1234)}), false),
		Views: 900, Forwards: 7, MediaUnread: true,
		Reactions: []ReactionCount{{Emoji: "🔥", Count: 3, Mine: true, Recent: []Peer{NewPeerUser(43)}}},
		ReplyMarkup: NewReplyInlineMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(NewKeyboardButtonURL("сайт", "https://example.org")),
		}),
		EncBody: []byte{1, 2, 3}, TTLSeconds: &ttl, DestructAt: &destruct,
		FactCheck:         &FactCheck{Text: "это не так", Country: "RU"},
		Transcription:     &transcription,
		Effect:            "fireworks",
		StarReactionTotal: 30, StarReactionMine: 25,
		SendAsChatID: &sendAs,
	}
}

// wireMessageWith — та же строка, но с ДРУГИМ вложением. Именно так вложения и
// существуют: ровно одно на сообщение.
func wireMessageWith(mutate func(*Message)) Message {
	m := wireMessage()
	m.Media = nil
	m.MediaID = nil
	mutate(&m)
	return m
}

// mergedOmittedOK — «нет предмета» подсистемы сообщений ПЛЮС диалогов: витрина
// отдаёт сообщения и сами по себе, и внутри контейнера диалогов, а каждый
// пропуск обязан быть назван РОВНО ОДИН раз, в своей подсистеме.
func mergedOmittedOK() map[string][]string {
	out := messageOmittedOK()
	for k, v := range dialogOmittedWithoutSubject {
		out[k] = append(append([]string{}, out[k]...), v...)
	}
	return out
}

func checkWireAgainstSchema(t *testing.T, objects ...any) (unexpected, omitted []string) {
	t.Helper()
	raw, err := json.Marshal(objects)
	if err != nil {
		t.Fatalf("витрина не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("витрина не разбирается обратно: %v", err)
	}
	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		// Пропуски диалога — оттуда же, где названы один раз: контейнер
		// messages.dialogs несёт вектор messages, и сверка проходит сквозь него.
		omittedOK:      mergedOmittedOK(),
		pendingSubject: messagePendingSubject,
	}
	c.walk(decoded, "wire")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// wireAttachments — по одному сообщению на КАЖДЫЙ вид вложения. Список
// продублирован проверкой полноты (TestMessageWire_EveryMediaConstructorIsProduced):
// вид вложения, у которого здесь нет строки, вообще не проверяется на выходе
// ToWire — а именно так гео и опрос прожили порт медиа собственными ключами.
func wireAttachments() map[string]Message {
	now := time.Unix(1_700_000_000, 0)
	lat, lng := 55.75, 37.61
	title, address := "Кремль", "Москва"
	livePeriod, heading := 3600, 90
	contactUser := int64(43)
	contactName, contactPhone := "Боб", "+70000000000"
	price := int64(50)

	geoBase := func(m *Message) {
		m.Type = "geo"
		m.GeoLat, m.GeoLng = &lat, &lng
	}
	return map[string]Message{
		"фото": wireMessage(),
		"точка": wireMessageWith(func(m *Message) {
			geoBase(m)
		}),
		"место": wireMessageWith(func(m *Message) {
			geoBase(m)
			m.GeoTitle, m.GeoAddress = &title, &address
		}),
		"живая трансляция": wireMessageWith(func(m *Message) {
			geoBase(m)
			m.GeoLivePeriod, m.GeoHeading = &livePeriod, &heading
		}),
		"остановленная трансляция": wireMessageWith(func(m *Message) {
			geoBase(m)
			m.GeoLivePeriod = &livePeriod
			m.GeoLiveStopped = true
		}),
		"визитка": wireMessageWith(func(m *Message) {
			m.Type = "contact"
			m.ContactUserID, m.ContactName, m.ContactPhone = &contactUser, &contactName, &contactPhone
		}),
		"опрос": wireMessageWith(func(m *Message) {
			m.Type = "poll"
			m.Poll = &PollInfo{
				ID: 5, Question: "Столица?", Options: []string{"Москва", "Питер"},
				Quiz: true, CorrectOption: ptr(0), Counts: []int{3, 1}, TotalVoters: 4, MyVotes: []int{0},
			}
		}),
		"чек-лист": wireMessageWith(func(m *Message) {
			m.Type = "checklist"
			m.Checklist = &ChecklistInfo{
				ID: 6, Title: "дела", OthersCanAdd: true,
				Items: []ChecklistItemInfo{{ID: 1, Text: "хлеб", Marks: []ChecklistMark{{UserID: 42, At: now}}}},
			}
		}),
		"идущий розыгрыш": wireMessageWith(func(m *Message) {
			m.Type = "giveaway"
			m.Giveaway = &GiveawayInfo{
				ID: 7, PeerID: ToPeerID(9, true), PrizeKind: "premium", Months: 3,
				WinnersCount: 10, UntilDate: now.UnixMilli(), StartDate: now.UnixMilli(), Status: "active",
			}
		}),
		"состоявшийся розыгрыш": wireMessageWith(func(m *Message) {
			m.Type = "giveaway"
			m.Giveaway = &GiveawayInfo{
				ID: 7, PeerID: ToPeerID(9, true), PrizeKind: "stars", Stars: 500,
				WinnersCount: 2, UntilDate: now.UnixMilli(), StartDate: now.UnixMilli(),
				Status: "finished", WinnerIDs: []int64{42, 43},
			}
		}),
		"превью ссылки": wireMessageWith(func(m *Message) {
			m.WebPage = &WebPagePreview{
				URL: "https://example.org/a", SiteName: "Example", Title: "Заголовок",
				Description: "Описание", PhotoID: 77, PhotoW: 800, PhotoH: 600,
				PhotoBlur: []byte{1, 2, 3}, PhotoHasThumb: true, HasIV: true,
			}
		}),
		"платное медиа: оплачено": wireMessageWith(func(m *Message) {
			m.Media = NewMessageMediaPhoto(NewPhoto(77, []PhotoSize{
				NewPhotoSize(SizeTypeFull, 800, 600, 1234),
			}), false)
			m.PaidMediaPrice = &price
		}),
		"платное медиа: заблокировано": wireMessageWith(func(m *Message) {
			m.Media = StripLockedMedia(NewMessageMediaPhoto(NewPhoto(77, []PhotoSize{
				NewPhotoStrippedSize([]byte{1, 2, 3}),
				NewPhotoSize(SizeTypeFull, 800, 600, 1234),
			}), false))
			m.PaidMediaPrice, m.PaidMediaLocked = &price, true
		}),
		"подарок": wireMessageWith(func(m *Message) {
			m.Type = "gift"
			m.Text = ""
			m.Gift = &GiftInfo{
				ID: 8, OwnerID: 43, Gift: StarGift{ID: 11, Emoji: "🎁", Title: "Мишка", PriceStars: 100, ConvertStars: 70},
				FromID: ptr(int64(42)), Message: "поздравляю", ConvertStars: 70, Date: now,
			}
		}),
	}
}

func TestMessageWire_MatchesSchema(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	ctx := MessageContext{Peer: NewPeerChannel(9), Post: true}

	service := wireMessage()
	service.Type = "service"
	service.Action = NewMessageActionChatEditPhoto(nil)

	call := wireMessage()
	call.Type = "call"
	call.Action = NewMessageActionPhoneCall(true, NewPhoneCallDiscardReasonHangup(), 42)

	scheduled := ScheduledMessage{
		ID: 3, ChatID: 9, SenderID: 42, Text: "потом",
		Entities: MessageEntities{NewMessageEntityBold(0, 5)},
		SendAt:   now.Add(time.Hour), CreatedAt: now, WhenOnline: true,
	}

	objects := []any{
		service.ToWire(ctx),
		call.ToWire(ctx),
		// Пустая строка витрины: обязательные параметры обязаны остаться даже
		// нулевыми, а всё необязательное — исчезнуть.
		Message{Seq: 2, CreatedAt: now}.ToWire(MessageContext{Peer: NewPeerUser(42)}),
		scheduled.ToWire(NewPeerUser(42)),
		// Дыра: производитель у неё появился вместе с этим шагом.
		MessageEmpty{Underscore: MessageEmptyTag, ID: 119, PeerID: NewPeerChannel(9)},
	}
	for _, m := range wireAttachments() {
		objects = append(objects, m.ToWire(ctx))
	}

	unexpected, omitted := checkWireAgainstSchema(t, objects...)
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// Каждый конструктор объединения, который модель УМЕЕТ собрать, обязан реально
// выходить из ToWire хотя бы на одной строке витрины. Иначе модель можно
// объявить и не наполнять — а именно этим и был закрываемый долг: конструкторы
// messageMediaGeo/Poll/ToDo/… существовали в схеме, но ToWire их не производил
// НИКОГДА.
func TestMessageWire_EveryMediaConstructorIsProduced(t *testing.T) {
	ctx := MessageContext{Peer: NewPeerChannel(9)}
	seen := map[string]bool{}
	for _, m := range wireAttachments() {
		wire := m.ToWire(ctx)
		real, ok := wire.(MessageReal)
		if !ok {
			// Подарок — служебное сообщение: его вид вложения выражен действием.
			seen[wire.(MessageService).Action.Tag()] = true
			continue
		}
		if real.Media == nil {
			t.Fatalf("вложение потерялось на проводе: %#v", m.Type)
		}
		seen[real.Media.Tag()] = true
	}
	for _, tag := range []string{
		MessageMediaPhotoTag, MessageMediaGeoTag, MessageMediaGeoLiveTag,
		MessageMediaVenueTag, MessageMediaContactTag, MessageMediaPollTag,
		MessageMediaToDoTag, MessageMediaGiveawayTag, MessageMediaGiveawayResultsTag,
		MessageMediaWebPageTag, MessageMediaPaidMediaTag, MessageActionStarGiftTag,
	} {
		if !seen[tag] {
			t.Errorf("конструктор %q не производится ни на одной строке витрины", tag)
		}
	}
}

// Вектор messages контейнера messages.dialogs сверкой НЕ был покрыт: его
// наполнял проводной рендерер из delivery/http. Теперь наполняет тот же
// ToWire — и сверка обязана доставать до него сквозь контейнер.
func TestMessagesDialogs_MessagesVectorMatchesSchema(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	wire := wireMessage().ToWire(MessageContext{Peer: NewPeerChannel(9), Post: true})
	container := NewMessagesDialogs(
		[]Dialog{NewDialog(NewPeerChannel(9), 120, NewPeerNotifySettings(time.Time{}, nil, nil), false)},
		[]any{wire},
		[]Chat{NewChannel(9, "канал", NewChatPhotoEmpty(), now, ChannelFlags{})},
		[]UserReal{NewUser(42, UserFlags{})},
	)
	unexpected, omitted := checkWireAgainstSchema(t, container)
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// wireObject — плоский набор ключей одного объекта (для утверждений «этого на
// проводе нет»).
func wireObject(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	return out
}

// Ключи, которых на проводе больше нет ВООБЩЕ. Каждый — снятая болезнь, а не
// переименование: удалить любой из них из ToWire и не покраснеть тест не должен.
func TestMessageWire_DroppedKeysAreGone(t *testing.T) {
	for name, m := range wireAttachments() {
		j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
		for _, key := range []string{
			"type",           // вид вложения даёт MessageMedia, «служебное ли» — конструктор
			"sender_id",      // автор это from_id:Peer
			"created_at",     // date:int
			"deleted",        // внутреннее состояние строки, на проводе всегда false
			"media_id",       // id живёт внутри media
			"reply_to_id",    // ссылка это messageReplyHeader
			"thread_root_id", // корень треда это reply_to.reply_to_top_id
			"reply_to_peer_id", "reply_quote_text", "reply_quote_offset",
			"reply_snapshot_name", "reply_snapshot_text",
			"send_as",                                           // отображаемый автор ЗАМЕЩАЕТ from_id
			"sender_name",                                       // имя собирает клиент
			"client_msg_id",                                     // клиентский параметр оригинала называется random_id
			"star_reaction",                                     // платная реакция это reactionPaid в общем векторе
			"edited_at",                                         // edit_date:int
			"ttl_seconds",                                       // ttl_period:int
			"effect",                                            // наш параметр называется effect_name
			"transcription",                                     // расшифровка это результат отдельного метода
			"poll_id", "checklist_id", "giveaway_id", "gift_id", // читателей не было
			// Восемь собственных ключей вложения: все стали конструкторами
			// объединения MessageMedia (подарок — действием).
			"geo", "contact", "poll", "checklist", "giveaway", "gift", "web_page", "paid_media",
		} {
			if _, ok := j[key]; ok {
				t.Errorf("%s: ключ %q всё ещё уезжает на провод", name, key)
			}
		}
	}
}

// Долг шага A: grouped_id — ЧИСЛО, а не строка. Проверяется на проводе, а не в
// модели: расходились именно они.
func TestMessageWire_GroupedIDIsNumber(t *testing.T) {
	j := wireObject(t, wireMessage().ToWire(MessageContext{Peer: NewPeerUser(42)}))
	if _, ok := j["grouped_id"].(float64); !ok {
		t.Fatalf("grouped_id = %#v, ждали число схемного long", j["grouped_id"])
	}
}

// Срок самоуничтожения выдавался ТОЛЬКО внутри ветки шифрованного сообщения —
// на обычном он терялся на проводе, хотя колонка одна и та же.
func TestMessageWire_TTLRidesOnPlainMessage(t *testing.T) {
	m := wireMessage()
	m.EncBody = nil
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	if j["ttl_period"] != float64(86400) {
		t.Fatalf("ttl_period = %#v у НЕшифрованного сообщения", j["ttl_period"])
	}
	if _, ok := j["enc_body"]; ok {
		t.Error("enc_body уехал у нешифрованного сообщения")
	}
}

// Отправка от имени канала ЗАМЕЩАЕТ автора: в схеме отображаемый автор и есть
// from_id, а не снимок рядом с настоящим отправителем.
func TestMessageWire_SendAsReplacesFrom(t *testing.T) {
	m := wireMessage()
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	from, _ := j["from_id"].(map[string]any)
	if from["_"] != PeerChannelTag || from["channel_id"] != float64(8) {
		t.Fatalf("from_id = %#v, ждали ссылку на канал send-as", j["from_id"])
	}
	m.SendAsChatID = nil
	j = wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	from, _ = j["from_id"].(map[string]any)
	if from["_"] != PeerUserTag || from["user_id"] != float64(42) {
		t.Fatalf("from_id = %#v, ждали ссылку на автора", j["from_id"])
	}
}

// Ссылка на отвечаемое: три случая схемы, которые плоские поля смешивали.
func TestMessageWire_ReplyHeader(t *testing.T) {
	m := wireMessage()

	// Оригинал НЕДОСТУПЕН (ReplyToPeer не разрешился): имя автора едет
	// reply_from.from_name, как у скрытой пересылки, а не строкой рядом.
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	reply, _ := j["reply_to"].(map[string]any)
	if reply["_"] != MessageReplyHeaderTag {
		t.Fatalf("reply_to = %#v, ждали messageReplyHeader", j["reply_to"])
	}
	if reply["reply_to_msg_id"] != float64(118) || reply["reply_to_top_id"] != float64(100) {
		t.Fatalf("адрес ответа/корня = %#v / %#v", reply["reply_to_msg_id"], reply["reply_to_top_id"])
	}
	from, _ := reply["reply_from"].(map[string]any)
	if from["from_name"] != "Автор оригинала" {
		t.Fatalf("reply_from = %#v, ждали атрибуцию недоступного оригинала", reply["reply_from"])
	}
	if reply["quote_text"] != "вот этот кусок" || reply["quote_offset"] != float64(12) {
		t.Fatalf("цитата = %#v / %#v", reply["quote_text"], reply["quote_offset"])
	}
	if pf, _ := reply["pFlags"].(map[string]any); pf["quote"] != true {
		t.Fatalf("pFlags.quote = %#v — флаг и текст цитаты обязаны ехать вместе", reply["pFlags"])
	}

	// Оригинал ДОСТУПЕН: едет ссылка на пир, а не атрибуция.
	m.ReplyToPeer = NewPeerChannel(11)
	j = wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	reply, _ = j["reply_to"].(map[string]any)
	if _, ok := reply["reply_from"]; ok {
		t.Error("reply_from уехал вместе с доступной ссылкой на пир")
	}
	peer, _ := reply["reply_to_peer_id"].(map[string]any)
	if peer["channel_id"] != float64(11) {
		t.Fatalf("reply_to_peer_id = %#v", reply["reply_to_peer_id"])
	}

	// Ответа нет вовсе — ключа нет вовсе.
	m.ReplyToID, m.ThreadRootID = nil, nil
	j = wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	if _, ok := j["reply_to"]; ok {
		t.Error("reply_to уехал у сообщения без ответа")
	}
}

// Служебное — ДРУГОЙ конструктор, а не значение поля, и текста у него нет.
func TestMessageWire_ServiceIsAConstructor(t *testing.T) {
	m := wireMessage()
	m.Text = ""
	m.Action = NewMessageActionPinMessage()
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	if j["_"] != MessageServiceTag {
		t.Fatalf("_ = %#v, ждали messageService", j["_"])
	}
	action, _ := j["action"].(map[string]any)
	if action["_"] != MessageActionPinMessageTag {
		t.Fatalf("action = %#v", j["action"])
	}
	// Закрепление не несёт НИЧЕГО: цель — reply_to.
	if len(action) != 1 {
		t.Fatalf("messageActionPinMessage несёт %v — у него нет ни одного параметра", action)
	}
	if _, ok := j["message"]; ok {
		t.Error("у служебного сообщения уехал текст")
	}
	if _, ok := j["media"]; ok {
		t.Error("у служебного сообщения уехало media — поля media у messageService нет вовсе")
	}
}

// Фото действия едет ВНУТРИ действия, а не полем media_id рядом с ним.
func TestMessageWire_ActionCarriesItsPhoto(t *testing.T) {
	m := wireMessage()
	m.Action = NewMessageActionChatEditPhoto(nil)
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	action, _ := j["action"].(map[string]any)
	photo, _ := action["photo"].(map[string]any)
	if photo["id"] != float64(77) {
		t.Fatalf("action.photo = %#v, ждали фото из media сообщения", action["photo"])
	}
}

// Платная ⭐-реакция — тот же вектор results с конструктором reactionPaid, а
// личный вклад зрителя — messageReactor с pFlags.my.
func TestMessageWire_PaidReactionJoinsResults(t *testing.T) {
	j := wireObject(t, wireMessage().ToWire(MessageContext{Peer: NewPeerUser(42)}))
	reactions, _ := j["reactions"].(map[string]any)
	results, _ := reactions["results"].([]any)
	var paid map[string]any
	for _, r := range results {
		rc, _ := r.(map[string]any)
		if reaction, _ := rc["reaction"].(map[string]any); reaction["_"] == ReactionPaidTag {
			paid = rc
		}
	}
	if paid == nil {
		t.Fatal("reactionPaid не попал в вектор results")
	}
	if paid["count"] != float64(30) {
		t.Fatalf("count платной реакции = %#v, ждали агрегат звёзд", paid["count"])
	}
	top, _ := reactions["top_reactors"].([]any)
	if len(top) != 1 {
		t.Fatalf("top_reactors = %#v, ждали вклад зрителя", reactions["top_reactors"])
	}
	me, _ := top[0].(map[string]any)
	if me["count"] != float64(25) {
		t.Fatalf("вклад зрителя = %#v", me["count"])
	}
}

// Время обновления живой трансляции — это message.edit_date, и второго смысла
// у него не бывает. Внутри вложения его нет.
func TestMessageWire_GeoHasNoOwnEditedAt(t *testing.T) {
	m := wireAttachments()["живая трансляция"]
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := j["media"].(map[string]any)
	if media["_"] != MessageMediaGeoLiveTag {
		t.Fatalf("media = %#v, ждали messageMediaGeoLive", j["media"])
	}
	for _, key := range []string{"edited_at", "edit_date", "date"} {
		if _, ok := media[key]; ok {
			t.Errorf("media.%s уехал — у edited_at было два смысла на одну колонку", key)
		}
	}
	if j["edit_date"] == nil {
		t.Error("edit_date не уехал")
	}
	if media["period"] != float64(3600) {
		t.Fatalf("period = %#v у идущей трансляции", media["period"])
	}
}

// «Трансляция остановлена» в схеме выражается ИСТЁКШИМ сроком, а не собственным
// флагом: клиент оригинала считает `date + period <= now`. Наш live_stopped
// поэтому укорачивает period до момента остановки (edit_date − date).
//
// Проверяется именно арифметика: подстановка любого другого числа (исходного
// периода или, наоборот, нуля у ЖИВОЙ трансляции) меняет ответ клиента на
// вопрос «идёт ли трансляция» на противоположный.
func TestMessageWire_StoppedLiveLocationExpires(t *testing.T) {
	m := wireAttachments()["остановленная трансляция"]
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := j["media"].(map[string]any)
	if media["_"] != MessageMediaGeoLiveTag {
		t.Fatalf("media = %#v, ждали messageMediaGeoLive", j["media"])
	}
	// Строка витрины: отправлено в now, остановлено минутой позже.
	if media["period"] != float64(60) {
		t.Fatalf("period = %#v, ждали 60 (момент остановки минус дата сообщения)", media["period"])
	}
	if float64(media["period"].(float64))+float64(j["date"].(float64)) != float64(j["edit_date"].(float64)) {
		t.Fatalf("date+period = %v, а edit_date = %v — трансляция не истекает в момент остановки",
			media["period"].(float64)+j["date"].(float64), j["edit_date"])
	}

	// Времени остановки нет вовсе — период нулевой: подделать «идёт» нечем.
	m.EditedAt = nil
	j = wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ = j["media"].(map[string]any)
	if media["period"] != float64(0) {
		t.Fatalf("period = %#v, ждали 0 у остановленной трансляции без времени остановки", media["period"])
	}
}

// Пер-зрительский выбор в опросе — флаг chosen у КОНКРЕТНОГО варианта, а не
// массив my_votes рядом с counts. Потерять его значит показать зрителю опрос
// как непроголосованный.
func TestMessageWire_PollKeepsViewerChoice(t *testing.T) {
	m := wireAttachments()["опрос"]
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := j["media"].(map[string]any)
	results, _ := media["results"].(map[string]any)
	answers, _ := results["results"].([]any)
	if len(answers) != 2 {
		t.Fatalf("итогов вариантов = %d, ждали 2", len(answers))
	}
	first, _ := answers[0].(map[string]any)
	pf, _ := first["pFlags"].(map[string]any)
	if pf["chosen"] != true || pf["correct"] != true {
		t.Fatalf("итог первого варианта = %#v, ждали выбор зрителя и правильный ответ", first)
	}
	second, _ := answers[1].(map[string]any)
	if _, ok := second["pFlags"]; ok {
		t.Fatalf("у невыбранного варианта появился pFlags: %#v", second)
	}
	if results["total_voters"] != float64(4) {
		t.Fatalf("total_voters = %#v", results["total_voters"])
	}
	// Анонимность — ОТРИЦАНИЕ public_voters: у неанонимного опроса флаг стоит.
	poll, _ := media["poll"].(map[string]any)
	if pf, _ := poll["pFlags"].(map[string]any); pf["public_voters"] != true {
		t.Fatalf("poll.pFlags = %#v, ждали public_voters у неанонимного опроса", poll["pFlags"])
	}
}

// Заблокированное платное медиа не отдаёт НИЧЕГО, по чему можно достать байты:
// в векторе extended_media стоит messageExtendedMediaPreview, а не настоящее
// вложение.
func TestMessageWire_LockedPaidMediaHasNoFile(t *testing.T) {
	locked := wireObject(t, wireAttachments()["платное медиа: заблокировано"].ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := locked["media"].(map[string]any)
	if media["_"] != MessageMediaPaidMediaTag || media["stars_amount"] != float64(50) {
		t.Fatalf("media = %#v, ждали messageMediaPaidMedia с ценой", locked["media"])
	}
	items, _ := media["extended_media"].([]any)
	if len(items) != 1 {
		t.Fatalf("extended_media = %#v", media["extended_media"])
	}
	item, _ := items[0].(map[string]any)
	if item["_"] != MessageExtendedMediaPreviewTag {
		t.Fatalf("позиция = %#v, ждали заглушку", item)
	}
	if _, ok := item["media"]; ok {
		t.Error("настоящее вложение уехало неоплатившему зрителю")
	}

	// Оплачено — настоящее вложение внутри той же обёртки.
	paid := wireObject(t, wireAttachments()["платное медиа: оплачено"].ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ = paid["media"].(map[string]any)
	items, _ = media["extended_media"].([]any)
	item, _ = items[0].(map[string]any)
	if item["_"] != MessageExtendedMediaTag {
		t.Fatalf("позиция оплаченного медиа = %#v", item)
	}
	inner, _ := item["media"].(map[string]any)
	if inner["_"] != MessageMediaPhotoTag {
		t.Fatalf("внутри оплаченного медиа = %#v", item["media"])
	}
}

// Подарок — служебное сообщение с действием, а не сообщение с вложением: media
// у messageService нет вовсе.
func TestMessageWire_GiftIsAServiceAction(t *testing.T) {
	j := wireObject(t, wireAttachments()["подарок"].ToWire(MessageContext{Peer: NewPeerUser(42)}))
	if j["_"] != MessageServiceTag {
		t.Fatalf("_ = %#v, ждали messageService", j["_"])
	}
	if _, ok := j["media"]; ok {
		t.Error("у подарка уехало media — поля media у messageService нет вовсе")
	}
	action, _ := j["action"].(map[string]any)
	if action["_"] != MessageActionStarGiftTag {
		t.Fatalf("action = %#v", j["action"])
	}
	gift, _ := action["gift"].(map[string]any)
	if gift["_"] != StarGiftTag || gift["id"] != float64(11) {
		t.Fatalf("action.gift = %#v", action["gift"])
	}
	from, _ := action["from_id"].(map[string]any)
	if from["user_id"] != float64(42) {
		t.Fatalf("даритель = %#v, ждали ссылку на пир", action["from_id"])
	}
	if _, ok := action["from_name"]; ok {
		t.Error("имя дарителя склеено сервером — его собирает клиент из from_id")
	}
}

// Превью ссылки — вложение (messageMediaWebPage), а картинка внутри него —
// обычная лестница ступеней, а не россыпь photo_w/photo_h/photo_blur.
func TestMessageWire_WebPageIsMedia(t *testing.T) {
	j := wireObject(t, wireAttachments()["превью ссылки"].ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := j["media"].(map[string]any)
	if media["_"] != MessageMediaWebPageTag {
		t.Fatalf("media = %#v, ждали messageMediaWebPage", j["media"])
	}
	page, _ := media["webpage"].(map[string]any)
	if page["url"] != "https://example.org/a" || page["display_url"] != "example.org/a" {
		t.Fatalf("адрес карточки = %#v / %#v", page["url"], page["display_url"])
	}
	photo, _ := page["photo"].(map[string]any)
	sizes, _ := photo["sizes"].([]any)
	if len(sizes) != 3 {
		t.Fatalf("лестница картинки превью = %#v, ждали stripped + 'y' + оригинал", page["photo"])
	}
	for _, key := range []string{"photo_w", "photo_h", "photo_blur", "photo_has_thumb", "photo_id"} {
		if _, ok := page[key]; ok {
			t.Errorf("плоское поле картинки %q пережило порт", key)
		}
	}
}

// Сообщение-картинка со ссылкой в подписи НЕ несёт превью: media в схеме ровно
// одно, и у оригинала карточка ссылки — это само вложение.
func TestMessageWire_WebPageYieldsToRealMedia(t *testing.T) {
	m := wireMessage()
	m.WebPage = &WebPagePreview{URL: "https://example.org"}
	j := wireObject(t, m.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	media, _ := j["media"].(map[string]any)
	if media["_"] != MessageMediaPhotoTag {
		t.Fatalf("media = %#v, ждали фотографию, а не карточку ссылки", j["media"])
	}
}

// Счётчики поста канала: пара views/forwards едет ТОЛЬКО у поста и тогда ВСЕГДА.
//
// Граница — ctx.Post, то есть тот же вопрос «пост ли это», которым ставится
// pFlags.post. Прежде границей служило ЗНАЧЕНИЕ (omitempty на числе), и свежий
// пост попадал не на ту сторону: параметра у него не было вовсе, хотя у
// оригинала бит flags.10 выставлен с первой публикации.
func TestMessageWire_PostCountersPairedAndPostOnly(t *testing.T) {
	fresh := Message{Seq: 5, CreatedAt: time.Unix(1_700_000_000, 0)}

	// Свежий пост: просмотров не было ни одного, но параметры едут — иначе
	// оригинальный гейт наблюдения (`isMessage && message.views`,
	// tweb bubbles.ts:7672) не пустил бы пост под интерсектор НИКОГДА, и
	// первый просмотр не зарегистрировался бы.
	j := wireObject(t, fresh.ToWire(MessageContext{Peer: NewPeerChannel(9), Post: true}))
	if j["views"] != float64(1) {
		t.Errorf("просмотры свежего поста = %#v, ждали 1: у оригинала поста с нулём просмотров не бывает (tweb appMessagesManager.ts:2930)", j["views"])
	}
	if j["forwards"] != float64(0) {
		t.Errorf("репосты свежего поста = %#v, ждали 0: бит у пары ОДИН (flags.10), репостов при этом и правда нуль", j["forwards"])
	}

	// Пост с накопленными счётчиками отдаёт их как есть: нижняя граница — это
	// граница, а не подмена значения.
	grown := fresh
	grown.Views, grown.Forwards = 42, 3
	j = wireObject(t, grown.ToWire(MessageContext{Peer: NewPeerChannel(9), Post: true}))
	if j["views"] != float64(42) || j["forwards"] != float64(3) {
		t.Errorf("счётчики выросшего поста = %#v/%#v, ждали 42/3", j["views"], j["forwards"])
	}

	// НЕ пост: ни личка, ни группа счётчиков не несут — их нет и у оригинала,
	// а пара нулей на каждом сообщении стоила бы провода.
	j = wireObject(t, grown.ToWire(MessageContext{Peer: NewPeerUser(42)}))
	for _, key := range []string{"views", "forwards"} {
		if v, ok := j[key]; ok {
			t.Errorf("у сообщения вне канала приехал %q = %#v", key, v)
		}
	}
}
