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

// wireMessage — строка витрины, у которой заполнено ВСЁ, что она умеет нести.
// Пустых полей здесь быть не должно: ключ, который не выставлен, сверкой не
// покрыт, а «лишнее поле» ловится только у того, что реально сериализовалось.
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
	lat, lng := 55.75, 37.61
	title, address := "Кремль", "Москва"
	livePeriod, heading := 3600, 90
	contactUser := int64(43)
	contactName, contactPhone := "Боб", "+70000000000"
	sendAs := int64(8)
	price := int64(50)
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
		Poll:              &PollInfo{ID: 5, Question: "?"},
		Checklist:         &ChecklistInfo{ID: 6, Title: "дела"},
		Giveaway:          &GiveawayInfo{ID: 7},
		Gift:              &GiftInfo{ID: 8},
		CreatedAt:         now,
		EditedAt:          &edited,
		FwdFrom:           &MessageFwdHeader{Underscore: MessageFwdHeaderTag, FromID: NewPeerUser(44), Date: unixSeconds(now)},
		ReplyQuoteText:    &quote,
		ReplyQuoteOffset:  &quoteOffset,
		ReplyToPeerID:     &replyPeer,
		ReplySnapshotName: "Автор оригинала",
		Media: &MessageMedia{
			Underscore: MessageMediaPhotoTag,
			Photo:      NewPhoto(mediaID, []PhotoSize{NewPhotoSize(SizeTypeFull, 800, 600, 1234)}),
		},
		Views: 900, Forwards: 7, MediaUnread: true,
		GeoLat: &lat, GeoLng: &lng, GeoTitle: &title, GeoAddress: &address,
		GeoLivePeriod: &livePeriod, GeoHeading: &heading, GeoLiveStopped: true,
		ContactUserID: &contactUser, ContactName: &contactName, ContactPhone: &contactPhone,
		Reactions: []ReactionCount{{Emoji: "🔥", Count: 3, Mine: true, Recent: []Peer{NewPeerUser(43)}}},
		ReplyMarkup: NewReplyInlineMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(NewKeyboardButtonURL("сайт", "https://example.org")),
		}),
		EncBody: []byte{1, 2, 3}, TTLSeconds: &ttl, DestructAt: &destruct,
		WebPage:           &WebPagePreview{URL: "https://example.org"},
		FactCheck:         &FactCheck{Text: "это не так", Country: "RU"},
		Transcription:     &transcription,
		Effect:            "fireworks",
		PaidMediaPrice:    &price,
		PaidMediaLocked:   true,
		StarReactionTotal: 30, StarReactionMine: 25,
		SendAsChatID: &sendAs,
	}
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

	unexpected, omitted := checkWireAgainstSchema(t,
		wireMessage().ToWire(ctx),
		service.ToWire(ctx),
		call.ToWire(ctx),
		// Пустая строка витрины: обязательные параметры обязаны остаться даже
		// нулевыми, а всё необязательное — исчезнуть.
		Message{Seq: 2, CreatedAt: now}.ToWire(MessageContext{Peer: NewPeerUser(42)}),
		scheduled.ToWire(NewPeerUser(42)),
		// Дыра: производитель у неё появился вместе с этим шагом.
		MessageEmpty{Underscore: MessageEmptyTag, ID: 119, PeerID: NewPeerChannel(9)},
	)
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
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
	j := wireObject(t, wireMessage().ToWire(MessageContext{Peer: NewPeerUser(42)}))
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
	} {
		if _, ok := j[key]; ok {
			t.Errorf("ключ %q всё ещё уезжает на провод", key)
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
// у него не бывает. Внутри geo его больше нет.
func TestMessageWire_GeoHasNoOwnEditedAt(t *testing.T) {
	j := wireObject(t, wireMessage().ToWire(MessageContext{Peer: NewPeerUser(42)}))
	geo, _ := j["geo"].(map[string]any)
	if _, ok := geo["edited_at"]; ok {
		t.Error("geo.edited_at уехал — у edited_at было два смысла на одну колонку")
	}
	if j["edit_date"] == nil {
		t.Error("edit_date не уехал")
	}
}
