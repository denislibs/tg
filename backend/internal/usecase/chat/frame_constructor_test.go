package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Тело кадра — КОНСТРУКТОР, а не словарь: вид кадра выражен дискриминатором
// `_`, а не строкой `t` рядом с телом.
//
// Разница между личным сообщением и постом канала — тоже конструктор
// (updateNewMessage против updateNewChannelMessage), а не имя ключа с курсором
// (`pts` против `channel_pts`), как было у нас. Ровно так же схема выражает эту
// же развилку у самой доставки — по типу пира.
func TestFrameBody_IsUpdateConstructor(t *testing.T) {
	t.Run("пост канала", func(t *testing.T) {
		i, fg, _, fpub := newChannelTestInteractor(t)
		ctx := context.Background()
		ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
		_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)

		if _, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Text: "пост"}); err != nil {
			t.Fatalf("Send: %v", err)
		}

		body := fpub.lastPayload(t)
		if body["_"] != domain.UpdateNewChannelMessageTag {
			t.Fatalf("дискриминатор кадра = %v, want %s", body["_"], domain.UpdateNewChannelMessageTag)
		}
		if body["pts_count"] != float64(domain.PtsCountOne) {
			t.Fatalf("pts_count = %v, а курсор у нас плотный — кадр двигает его на единицу", body["pts_count"])
		}
		if _, ok := body["message"].(map[string]any); !ok {
			t.Fatalf("сообщение не лежит конструктором внутри кадра: %#v", body)
		}

		// Курсор канала лежит в `pts` САМОГО конструктора: своего имени у него
		// в схеме нет, «канальным» его делает конструктор. Ключ `channel_pts`
		// был вторым именем того же поля — и именно по нему клиент решал вид
		// кадра, вместо дискриминатора.
		if _, stale := body["channel_pts"]; stale {
			t.Fatalf("кадр несёт channel_pts — второе имя того же курсора: %#v", body)
		}
		if body["pts"] == nil {
			t.Fatalf("у кадра нет pts: %#v", body)
		}
	})

	// «Прочитал я» и «прочитали меня» — РАЗНЫЕ конструкторы, а не один кадр с
	// user_id внутри, из которого каждый получатель выводит «чьё это» сам.
	// Счётчик оставшегося непрочитанного есть только у первого: чужой
	// непрочитанный меня не касается.
	t.Run("прочтение раздваивается по получателю", func(t *testing.T) {
		in, _ := newInteractor()
		pub := &fakePublisher{}
		in.SetPublisher(pub)
		ctx := context.Background()
		const author, reader int64 = 1, 2
		chatID, _ := in.CreatePrivateChat(ctx, author, reader)
		msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: author, Text: "привет"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}

		pub.reset()
		if err := in.MarkRead(ctx, chatID, reader, msg.Seq); err != nil {
			t.Fatalf("MarkRead: %v", err)
		}

		inbox := lastFrameFor(t, pub, reader)
		if inbox["_"] != domain.UpdateReadHistoryInboxTag {
			t.Fatalf("читателю = %v, want %s", inbox["_"], domain.UpdateReadHistoryInboxTag)
		}
		if _, ok := inbox["still_unread_count"]; !ok {
			t.Fatalf("у кадра читателя нет счётчика непрочитанного: %#v", inbox)
		}

		outbox := lastFrameFor(t, pub, author)
		if outbox["_"] != domain.UpdateReadHistoryOutboxTag {
			t.Fatalf("автору = %v, want %s", outbox["_"], domain.UpdateReadHistoryOutboxTag)
		}
		if _, stale := outbox["still_unread_count"]; stale {
			t.Fatalf("кадр «прочитали меня» несёт ЧУЖОЙ счётчик непрочитанного: %#v", outbox)
		}
		// Ключ пира — конструктор Peer, а не число: в схеме у прочтения
		// параметр `peer:Peer`.
		peer, ok := outbox["peer"].(map[string]any)
		if !ok || peer["_"] == nil {
			t.Fatalf("пир кадра не конструктор: %#v", outbox["peer"])
		}
	})

	// «Открепили» — тот же конструктор с ОПУЩЕННЫМ битом, а не поле
	// `pinned: false` и не второй тип кадра. На JSON-проводе разница
	// косметическая, на проводе TL — принципиальная: голый флаг не занимает
	// ничего, и материализуйся он значением, чужой разбор поехал бы дальше по
	// полю, которого нет.
	t.Run("закрепление и открепление — один конструктор", func(t *testing.T) {
		in, _ := newInteractor()
		pub := &fakePublisher{}
		in.SetPublisher(pub)
		ctx := context.Background()
		const a, b int64 = 1, 2
		chatID, _ := in.CreatePrivateChat(ctx, a, b)
		msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "закрепить"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}

		pub.reset()
		if err := in.SetPin(ctx, chatID, msg.ID, a, true); err != nil {
			t.Fatalf("SetPin: %v", err)
		}
		// Именно кадр закрепления: следом за ним летит ещё и служебное
		// сообщение-пилюля («закрепил сообщение»), и оно новее.
		pinned := frameOfType(t, pub, b, "pin_message")
		if pinned["_"] != domain.UpdatePinnedMessagesTag {
			t.Fatalf("закрепление = %v, want %s", pinned["_"], domain.UpdatePinnedMessagesTag)
		}
		flags, _ := pinned["pFlags"].(map[string]any)
		if flags["pinned"] != true {
			t.Fatalf("у закрепления нет бита pinned: %#v", pinned)
		}
		if ids, ok := pinned["messages"].([]any); !ok || len(ids) != 1 {
			t.Fatalf("номера едут не вектором: %#v", pinned["messages"])
		}

		pub.reset()
		if err := in.SetPin(ctx, chatID, msg.ID, a, false); err != nil {
			t.Fatalf("SetPin(false): %v", err)
		}
		unpinned := frameOfType(t, pub, b, "pin_message")
		if unpinned["_"] != domain.UpdatePinnedMessagesTag {
			t.Fatalf("открепление = %v, want тот же конструктор", unpinned["_"])
		}
		if _, present := unpinned["pFlags"]; present {
			t.Fatalf("у открепления появился pFlags: %#v", unpinned)
		}
		if _, stale := unpinned["pinned"]; stale {
			t.Fatalf("открепление везёт поле pinned вместо ОТСУТСТВИЯ бита: %#v", unpinned)
		}
	})

	// Правка несёт сообщение ЦЕЛИКОМ, а не патч полей. Прежде кадр вёз
	// собственный набор (id + текст + сущности + дата + разметка) — вторую
	// проводную форму сообщения; теперь форма одна, и отличается только
	// конструктор.
	t.Run("правка несёт сообщение целиком", func(t *testing.T) {
		in, _ := newInteractor()
		pub := &fakePublisher{}
		in.SetPublisher(pub)
		ctx := context.Background()
		const a, b int64 = 1, 2
		chatID, _ := in.CreatePrivateChat(ctx, a, b)
		msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "было"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}

		pub.reset()
		if _, err := in.EditMessage(ctx, chatID, msg.ID, a, "стало", nil); err != nil {
			t.Fatalf("EditMessage: %v", err)
		}

		body := frameOfType(t, pub, b, "edit_message")
		if body["_"] != domain.UpdateEditMessageTag {
			t.Fatalf("правка = %v, want %s", body["_"], domain.UpdateEditMessageTag)
		}
		inner, ok := body["message"].(map[string]any)
		if !ok || inner["_"] != domain.MessageTag {
			t.Fatalf("внутри кадра не сообщение: %#v", body["message"])
		}
		if inner["message"] != "стало" {
			t.Fatalf("текст правки = %v", inner["message"])
		}
		// Патч-поля верхнего уровня исчезли вместе со второй формой.
		for _, stale := range []string{"id", "entities", "edit_date", "reply_markup"} {
			if _, present := body[stale]; present {
				t.Fatalf("кадр правки везёт поле патча %q: %#v", stale, body)
			}
		}
		// Пир — внутри сообщения, как у new_message: это параметр самого
		// сообщения, а не поле конверта.
		if _, ok := inner["peer_id"].(map[string]any); !ok {
			t.Fatalf("у сообщения в кадре нет ключа пира: %#v", inner)
		}
	})

	// Журнал канала хранит ТО ЖЕ тело, что уходит живым кадром: догон разрыва
	// и live обязаны совпадать, иначе клиент разбирает их двумя путями.
	t.Run("журнал канала", func(t *testing.T) {
		i, fg, _, _ := newChannelTestInteractor(t)
		ctx := context.Background()
		ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
		_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)

		if _, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Text: "пост"}); err != nil {
			t.Fatalf("Send: %v", err)
		}

		ups, err := i.GetChannelDifference(ctx, ch, 8, 0, 100)
		if err != nil || len(ups) != 1 {
			t.Fatalf("догон разрыва: %d записей, err = %v", len(ups), err)
		}
		var body map[string]any
		if err := json.Unmarshal(ups[0].Payload, &body); err != nil {
			t.Fatalf("тело записи журнала не разбирается: %v", err)
		}
		if body["_"] != domain.UpdateNewChannelMessageTag {
			t.Fatalf("дискриминатор записи журнала = %v, want %s", body["_"], domain.UpdateNewChannelMessageTag)
		}
	})
}

// frameOfType — последний кадр ЗАДАННОГО типа для получателя. Нужен там, где
// одно действие порождает несколько кадров (закрепление шлёт ещё и служебное
// сообщение), и «последний» отвечает не про то.
func frameOfType(t *testing.T, pub *fakePublisher, userID int64, typ string) map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("разбор кадра: %v", err)
		}
		if env.T == typ {
			return env.D
		}
	}
	t.Fatalf("кадра %q для пользователя %d не было", typ, userID)
	return nil
}
