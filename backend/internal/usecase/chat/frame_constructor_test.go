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
