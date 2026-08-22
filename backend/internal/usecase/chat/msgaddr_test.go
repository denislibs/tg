package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Адресация сообщения снаружи — пара «пир + номер». Проверяется ровно то, что
// сформулировано критерием приёмки шага: НИ ОДИН проводной payload не несёт
// двух чисел для одного сообщения, и внутренний ключ строки в payload не
// встречается вовсе.
//
// Все проверки здесь ставятся на чате, у которого ключ строки и номер РАЗОШЛИСЬ.
// Это не педантизм: в базе с одним чатом id == seq для всех сообщений, и подмена
// не проявляется — а именно так выглядела форма фикстур, из-за которой эти два
// числа годами ездили рядом незамеченными.

// chatWithSplitIDs заводит чат a↔b, предварительно израсходовав ключи строк в
// ЧУЖОМ чате: у сообщений результата ключ строки заведомо больше номера, а
// журналы a и b при этом чистые (чужой чат не их).
func chatWithSplitIDs(t *testing.T, in *Interactor, a, b int64) int64 {
	t.Helper()
	ctx := context.Background()
	const x, y int64 = 900, 901
	filler, _ := in.CreatePrivateChat(ctx, x, y)
	for i := 0; i < 20; i++ {
		if _, err := in.Send(ctx, SendInput{ChatID: filler, SenderID: x, Text: "заполнение"}); err != nil {
			t.Fatalf("seed filler: %v", err)
		}
	}
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	return chatID
}

// nonAddressKeys — числовые поля кадра, которые сообщение не адресуют вовсе
// (курсоры и счётчики). Их значение может случайно совпасть с любым числом.
var nonAddressKeys = map[string]bool{
	"pts": true, "channel_pts": true, "unread": true, "date": true,
	"unread_reactions": true, "count": true, "total": true, "mine": true,
}

// scanForInternalID обходит разобранный payload и ищет число, равное
// внутреннему ключу строки.
func scanForInternalID(t *testing.T, where string, v any, internalID int64) {
	t.Helper()
	switch x := v.(type) {
	case map[string]any:
		for k, item := range x {
			if nonAddressKeys[k] {
				continue
			}
			if n, ok := item.(float64); ok && int64(n) == internalID {
				t.Errorf("%s: ключ %q несёт внутренний messages.id = %d — наружу выходит только номер в чате",
					where, k, internalID)
			}
			scanForInternalID(t, where+"."+k, item, internalID)
		}
	case []any:
		for _, item := range x {
			scanForInternalID(t, where+"[]", item, internalID)
		}
	}
}

// assertNoSecondNumber — ключей второго числа не бывает ни у одного кадра.
func assertNoSecondNumber(t *testing.T, where string, p map[string]any) {
	t.Helper()
	for _, banned := range []string{"msg_id", "seq", "message_id"} {
		if _, ok := p[banned]; ok {
			t.Errorf("%s: остался ключ %q — на одно сообщение должно быть одно число", where, banned)
		}
	}
}

// dropForeign выбрасывает кадры, адресованные не участникам проверяемого чата
// (чат-заполнитель фикстуры живёт на других пользователях).
func dropForeign(pub *fakePublisher, users ...int64) {
	mine := map[int64]bool{}
	for _, u := range users {
		mine[u] = true
	}
	keep := pub.frames[:0]
	for _, f := range pub.frames {
		if mine[f.userID] {
			keep = append(keep, f)
		}
	}
	pub.frames = keep
}

// assertSingleNumber — у payload ровно одно поле идентичности: `id`, и это
// номер в чате.
func assertSingleNumber(t *testing.T, where string, p map[string]any, wantSeq int64) {
	t.Helper()
	for _, banned := range []string{"msg_id", "seq", "message_id"} {
		if _, ok := p[banned]; ok {
			t.Errorf("%s: остался второй ключ %q — на одно сообщение должно быть одно число", where, banned)
		}
	}
	// Кадр с сообщением несёт его ВНУТРИ ключа `message` (конструктор схемы), а
	// pts лежит рядом — форма updateNewMessage. Адрес ищем там же, где он живёт.
	if msg, ok := p["message"].(map[string]any); ok {
		p = msg
	}
	id, ok := p["id"]
	if !ok {
		t.Fatalf("%s: нет ключа id (%v)", where, p)
	}
	if got := asInt64(t, id); got != wantSeq {
		t.Errorf("%s: id = %d, ждали номер в чате %d", where, got, wantSeq)
	}
}

func TestWirePayloads_AddressMessageBySeqOnly(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID := chatWithSplitIDs(t, in, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "привет", Type: "voice"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.ID == msg.Seq {
		t.Fatalf("фикстура вырождена: ключ строки %d совпал с номером %d — подмена на ней не видна", msg.ID, msg.Seq)
	}
	// Кадры чужого чата-заполнителя к делу не относятся.
	dropForeign(pub, a, b)

	// logSeen — сколько строк журнала уже проверено (журнал накапливается).
	logSeen := map[int64]int{}
	// check разбирает кадры текущего шага и НОВЫЕ строки журнала. Запрет на
	// второе число действует на ВСЕ кадры и записи без исключений; равенство
	// адреса номеру проверяется у кадров того типа, который шаг породил
	// (закрепление, например, порождает ещё и сервисный бабл-пилюлю — у него
	// свой, тоже единственный, адрес).
	check := func(label, typ string, wantSeq int64) {
		t.Helper()
		if len(pub.frames) == 0 {
			t.Fatalf("%s: кадров нет", label)
		}
		hit := false
		for _, f := range pub.frames {
			var env struct {
				T string         `json:"t"`
				D map[string]any `json:"d"`
			}
			if err := json.Unmarshal(f.frame, &env); err != nil {
				t.Fatalf("%s: разбор кадра: %v", label, err)
			}
			if env.D == nil {
				continue
			}
			assertNoSecondNumber(t, label+"/"+env.T, env.D)
			if env.T != typ {
				continue
			}
			hit = true
			assertSingleNumber(t, label+"/"+env.T, env.D, wantSeq)
			scanForInternalID(t, label+"/"+env.T, env.D, msg.ID)
		}
		if !hit {
			t.Fatalf("%s: кадра типа %q не было", label, typ)
		}
		for _, uid := range []int64{a, b} {
			s.mu.Lock()
			ups := append([]domain.UpdateRecord(nil), s.updates[uid]...)
			s.mu.Unlock()
			for _, u := range ups[logSeen[uid]:] {
				var p map[string]any
				if err := json.Unmarshal(u.Payload, &p); err != nil {
					t.Fatalf("%s: разбор записи журнала: %v", label, err)
				}
				assertNoSecondNumber(t, label+"/log:"+u.Type, p)
				if u.Type != typ {
					continue
				}
				assertSingleNumber(t, label+"/log:"+u.Type, p, wantSeq)
				scanForInternalID(t, label+"/log:"+u.Type, p, msg.ID)
			}
			logSeen[uid] = len(ups)
		}
	}
	check("new_message", "new_message", msg.Seq)

	pub.reset()
	if _, err := in.EditMessage(ctx, chatID, msg.ID, a, "правка", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	check("edit_message", "edit_message", msg.Seq)

	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	check("reaction", "reaction", msg.Seq)

	pub.reset()
	if err := in.ReadMedia(ctx, chatID, b, msg.ID); err != nil {
		t.Fatalf("ReadMedia: %v", err)
	}
	check("media_read", "media_read", msg.Seq)

	pub.reset()
	if err := in.SetPin(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	check("pin_message", "pin_message", msg.Seq)

	pub.reset()
	if err := in.DeleteMessage(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}
	check("delete_message", "delete_message", msg.Seq)
}

// Закрепление не несёт НИЧЕГО: у messageActionPinMessage параметров нет вовсе,
// а цель адресуется reply_to самого служебного сообщения — тем же номером и в
// том же пире, что и любой другой ответ. Прежде в действии ехали ДВА числа на
// одну цель плюс склеенное сервером превью.
func TestPinService_TargetRidesInReplyTo(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID := chatWithSplitIDs(t, in, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "закрепить это"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.SetPin(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	pill := lastMessage(t, in, chatID)
	if _, ok := pill.Action.(domain.MessageActionPinMessage); !ok {
		t.Fatalf("действие пилюли = %#v, ждали messageActionPinMessage", pill.Action)
	}
	if pill.Text != "" {
		t.Errorf("у пилюли закрепления остался текст: %q", pill.Text)
	}
	if pill.ReplyToID == nil || *pill.ReplyToID != msg.Seq {
		t.Fatalf("цель закрепления = %v, ждали номер %d (внутренний ключ %d)", pill.ReplyToID, msg.Seq, msg.ID)
	}
}

// lastMessage — последнее сообщение чата в фейковом хранилище.
func lastMessage(t *testing.T, in *Interactor, chatID int64) domain.Message {
	t.Helper()
	msgs, err := in.msgs.GetHistory(context.Background(), chatID, 0, 0, 0, 100, nil, 0, "")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatal("в чате нет сообщений")
	}
	return msgs[0]
}

// Ответ адресуется парой «пир + номер». Пары не хватало ровно в том случае,
// который раньше выводился из ключа строки: один и тот же номер существует в
// каждом чате, и без пира ответ попадает в чужое сообщение.
func TestReply_AddressedByPeerAndSeq(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b, c int64 = 1, 2, 3

	chatA, _ := in.CreatePrivateChat(ctx, a, b)
	origA, err := in.Send(ctx, SendInput{ChatID: chatA, SenderID: a, Text: "оригинал в A"})
	if err != nil {
		t.Fatalf("Send A: %v", err)
	}
	chatB, _ := in.CreatePrivateChat(ctx, a, c)
	origB, err := in.Send(ctx, SendInput{ChatID: chatB, SenderID: a, Text: "оригинал в B"})
	if err != nil {
		t.Fatalf("Send B: %v", err)
	}
	if origA.Seq != origB.Seq {
		t.Fatalf("фикстура вырождена: номера %d и %d в разных чатах не совпали", origA.Seq, origB.Seq)
	}

	// Без пира — ответ в СВОЁМ чате.
	seq := origB.Seq
	same, err := in.Send(ctx, SendInput{ChatID: chatB, SenderID: a, Text: "ответ", ReplyToID: &seq})
	if err != nil {
		t.Fatalf("Send reply: %v", err)
	}
	if same.ReplyToPeerID != nil {
		t.Errorf("ответ в своём чате получил чужой пир %d", *same.ReplyToPeerID)
	}
	msgs := []domain.Message{same}
	if err := in.hydrateReplies(ctx, msgs); err != nil {
		t.Fatalf("hydrateReplies: %v", err)
	}
	if msgs[0].ReplyTo == nil || msgs[0].ReplyTo.Text != "оригинал в B" {
		t.Fatalf("превью ответа = %+v, ждали оригинал ИЗ СВОЕГО чата", msgs[0].ReplyTo)
	}

	// С пиром — кросс-чат-ответ на тот же номер, но в другом чате.
	src := chatA
	cross, err := in.Send(ctx, SendInput{
		ChatID: chatB, SenderID: a, Text: "кросс-ответ", ReplyToID: &seq, ReplyToPeerID: &src,
	})
	if err != nil {
		t.Fatalf("Send cross reply: %v", err)
	}
	if cross.ReplyToPeerID == nil || *cross.ReplyToPeerID != chatA {
		t.Fatalf("кросс-чат-ответ потерял пир источника: %v", cross.ReplyToPeerID)
	}
	if cross.ReplyToID == nil || *cross.ReplyToID != seq {
		t.Fatalf("кросс-чат-ответ адресует %v, ждали номер %d в чате A", cross.ReplyToID, seq)
	}
}

// staleMsgs — хранилище, у которого пакетная выборка сообщений страницы ничего
// не находит. Это НЕ выдуманный случай: снимок списка диалогов кэшируется на
// 15 секунд (adapter/cache/redis/dialogscache.go), и сообщение, снесённое в
// этом окне, исчезает из выборки, а строка диалога продолжает на него
// ссылаться. Прежний код искал номер ПО ЗАГРУЖЕННЫМ сообщениям и в этот момент
// молча отдавал 0 — «самое новое», то есть открывал чат не на том месте.
type staleMsgs struct{ fakeMsgs }

func (staleMsgs) GetByIDs(context.Context, []int64) ([]domain.Message, error) { return nil, nil }

// Номер последнего сообщения переживает пустую выборку: он приходит из той же
// строки, что и внутренний ключ, а не собирается поиском.
func TestDialogsPage_TopMessageSurvivesEmptyMessagesVector(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, staleMsgs{fakeMsgs{s}}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	last, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "последнее"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	if len(page.Messages) != 0 {
		t.Fatalf("фикстура не та: вектор messages должен быть пуст, а в нём %d", len(page.Messages))
	}
	if len(page.Dialogs) != 1 {
		t.Fatalf("dialogs = %d, want 1", len(page.Dialogs))
	}
	real, ok := page.Dialogs[0].(domain.DialogReal)
	if !ok {
		t.Fatalf("строка списка = %T", page.Dialogs[0])
	}
	if real.TopMessage != last.Seq {
		t.Fatalf("top_message = %d, ждали номер %d; 0 здесь значит «самое новое», то есть подмену адреса",
			real.TopMessage, last.Seq)
	}
}

// dialog.top_message — номер последнего сообщения, и он приходит из той же
// строки выборки, что и внутренний ключ: промах поиска по загруженным
// сообщениям отдавал бы 0, а 0 в этом пространстве значит «самое новое».
func TestDialogsPage_TopMessageIsSeq(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID := chatWithSplitIDs(t, in, a, b)

	last, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "последнее"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	var found bool
	for _, d := range page.Dialogs {
		real, ok := d.(domain.DialogReal)
		if !ok {
			continue
		}
		if real.TopMessage == last.Seq {
			found = true
		}
		if real.TopMessage == last.ID {
			t.Fatalf("top_message = %d — это внутренний ключ строки, а не номер %d", last.ID, last.Seq)
		}
	}
	if !found {
		t.Fatalf("ни один диалог не адресует последнее сообщение номером %d", last.Seq)
	}
}
