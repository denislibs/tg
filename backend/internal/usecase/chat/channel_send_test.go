package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Пост в канал доезжает через ДОГОН РАЗРЫВА (/difference) только если он лёг в
// журнал канала. Ручка постинга принимает лишь текст, поэтому пост С ФОТО
// уходит обычной отправкой — и до этого пина шёл пер-юзерным веером мимо
// журнала: подписчик, вернувшийся после разрыва связи, такого поста не видел
// вовсе. Найдено на стенде счётом: 197 постов в каналах при 187 записях
// журнала — расхождение ровно на число постов с картинкой.
//
// Спрашиваем не внутренности, а САМ догон: то, чем пользуется клиент.
func TestSendMediaToChannel_ReachesChannelJournal(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)

	mediaID := int64(42)
	if _, err := i.Send(ctx, SendInput{
		ChatID: ch, SenderID: 7, Type: "photo", Text: "подпись", MediaID: &mediaID,
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	ups, err := i.GetChannelDifference(ctx, ch, 8, 0, 100)
	if err != nil {
		t.Fatalf("GetChannelDifference: %v", err)
	}
	if len(ups) != 1 {
		t.Fatalf("записей в журнале канала = %d, want 1 — пост с медиа мимо журнала, догон разрыва его не отдаст", len(ups))
	}
	if ups[0].Type != "new_message" {
		t.Fatalf("тип записи = %q, want new_message", ups[0].Type)
	}
}

// Пересылка В канал — тот же пост канала, и до пина шла ТРЕТЬЕЙ веткой
// доставки: собственный веер по подписчикам внутри message_forward.go, тоже
// мимо журнала. Дефект тот же, вход другой — потому и спрашиваем догон, а не
// внутренности.
func TestForwardToChannel_ReachesChannelJournal(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	src, _ := i.CreateChannel(ctx, 7, "Src", "", "", true)
	dst, _ := i.CreateChannel(ctx, 7, "Dst", "", "", true)
	_ = fg.AddMember(ctx, dst, 8, domain.RoleSubscriber, 0)

	post, err := i.PostToChannel(ctx, src, 7, "исходный", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if _, err := i.ForwardMessages(ctx, ForwardInput{
		FromChatID: src, ToChatID: dst, MsgIDs: []int64{post.ID}, SenderID: 7,
	}); err != nil {
		t.Fatalf("ForwardMessages: %v", err)
	}

	ups, err := i.GetChannelDifference(ctx, dst, 8, 0, 100)
	if err != nil {
		t.Fatalf("GetChannelDifference: %v", err)
	}
	if len(ups) != 1 {
		t.Fatalf("записей в журнале канала-приёмника = %d, want 1 — пересылка мимо журнала", len(ups))
	}
}

// Тот же гейт, что у отправки: подписчик не публикует в канал и пересылкой.
func TestForwardToChannel_SubscriberForbidden(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	src, _ := i.CreateChannel(ctx, 7, "Src", "", "", true)
	dst, _ := i.CreateChannel(ctx, 7, "Dst", "", "", true)
	_ = fg.AddMember(ctx, src, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, dst, 8, domain.RoleSubscriber, 0)

	post, _ := i.PostToChannel(ctx, src, 7, "исходный", nil, "")
	_, err := i.ForwardMessages(ctx, ForwardInput{
		FromChatID: src, ToChatID: dst, MsgIDs: []int64{post.ID}, SenderID: 8,
	})
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылка подписчика в канал = %v, want ErrForbidden", err)
	}
}

// Подписчик канала писать в него не может — это read-only роль (domain/rights.go).
// Право проверяла ТОЛЬКО ручка постинга (PostToChannel → RightPostMessages), а
// обычная отправка гейта по типу чата не имела вовсе: checkSendAllowed
// сваливался в дефолтные права участника ГРУППЫ (маска 31), где отправка
// разрешена. То есть подписчик мог опубликовать в канал что угодно, послав
// сообщение обычным путём.
func TestSendToChannel_SubscriberForbidden(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)

	if _, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 8, Text: "я подписчик"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("отправка подписчика в канал = %v, want ErrForbidden", err)
	}
}
