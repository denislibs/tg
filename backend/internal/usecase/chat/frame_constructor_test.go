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
