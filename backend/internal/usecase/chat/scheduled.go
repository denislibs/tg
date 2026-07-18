package chat

import (
	"context"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Запланированные сообщения (Telegram scheduled messages): отдельная очередь;
// воркер (DispatchDueScheduled) отправляет созревшие обычным Send — весь
// фан-аут/pts/пуши идут штатным путём. Каждый видит только свои запланированные.

// maxScheduledPerUser — лимит очереди (Telegram: 100 на чат; берём на юзера).
const maxScheduledPerUser = 100

// ScheduleMessage кладёт сообщение в очередь на send_at (должен быть в будущем).
func (i *Interactor) ScheduleMessage(ctx context.Context, in SendInput, sendAt time.Time) (domain.ScheduledMessage, error) {
	if i.scheduled == nil {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.ScheduledMessage{}, err
	}
	if !ok {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	if in.Text == "" && in.MediaID == nil {
		return domain.ScheduledMessage{}, domain.ErrTooLong
	}
	if utf8.RuneCountInString(in.Text) > maxMessageRunes {
		return domain.ScheduledMessage{}, domain.ErrTooLong
	}
	if !sendAt.After(time.Now()) {
		return domain.ScheduledMessage{}, domain.ErrTooLong
	}
	if n, e := i.scheduled.CountByUser(ctx, in.SenderID); e != nil {
		return domain.ScheduledMessage{}, e
	} else if n >= maxScheduledPerUser {
		return domain.ScheduledMessage{}, domain.ErrTooLong
	}
	if in.Type == "" {
		in.Type = "text"
	}
	return i.scheduled.Create(ctx, domain.ScheduledMessage{
		ChatID: in.ChatID, SenderID: in.SenderID, Type: in.Type, Text: in.Text,
		Entities: sanitizeEntities(in.Entities), ReplyToID: in.ReplyToID, MediaID: in.MediaID,
		SendAt: sendAt,
	})
}

// ListScheduled — свои запланированные в чате (ближайшие сверху).
func (i *Interactor) ListScheduled(ctx context.Context, chatID, userID int64) ([]domain.ScheduledMessage, error) {
	if i.scheduled == nil {
		return nil, nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.scheduled.ListByChat(ctx, chatID, userID)
}

// DeleteScheduled удаляет своё запланированное.
func (i *Interactor) DeleteScheduled(ctx context.Context, id, userID int64) error {
	if i.scheduled == nil {
		return domain.ErrNotFound
	}
	m, err := i.scheduled.ByID(ctx, id)
	if err != nil {
		return err
	}
	if m.SenderID != userID {
		return domain.ErrForbidden
	}
	return i.scheduled.Delete(ctx, id)
}

// SendScheduledNow отправляет своё запланированное немедленно (tweb Send Now).
func (i *Interactor) SendScheduledNow(ctx context.Context, id, userID int64) (domain.Message, error) {
	if i.scheduled == nil {
		return domain.Message{}, domain.ErrNotFound
	}
	m, err := i.scheduled.ByID(ctx, id)
	if err != nil {
		return domain.Message{}, err
	}
	if m.SenderID != userID {
		return domain.Message{}, domain.ErrForbidden
	}
	msg, err := i.dispatchScheduled(ctx, m)
	if err != nil {
		return domain.Message{}, err
	}
	return msg, nil
}

// DispatchDueScheduled отправляет созревшие запланированные (фоновый воркер).
func (i *Interactor) DispatchDueScheduled(ctx context.Context) (int, error) {
	if i.scheduled == nil {
		return 0, nil
	}
	due, err := i.scheduled.Due(ctx, time.Now(), 50)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, m := range due {
		if _, e := i.dispatchScheduled(ctx, m); e == nil {
			sent++
		}
	}
	return sent, nil
}

// dispatchScheduled: обычный Send (фан-аут/pts/пуши) + удаление из очереди.
// Отправка идёт даже если правая проверка теперь бы не прошла — как в Telegram,
// момент планирования уже валидировал доступ; Send сам повторит критичные проверки.
func (i *Interactor) dispatchScheduled(ctx context.Context, m domain.ScheduledMessage) (domain.Message, error) {
	msg, err := i.Send(ctx, SendInput{
		ChatID: m.ChatID, SenderID: m.SenderID, Type: m.Type, Text: m.Text,
		Entities: m.Entities, ReplyToID: m.ReplyToID, MediaID: m.MediaID,
	})
	if err != nil {
		// не смогли отправить (выгнали из чата и т.п.) — убираем из очереди,
		// иначе воркер будет ретраить вечно
		_ = i.scheduled.Delete(ctx, m.ID)
		return domain.Message{}, err
	}
	_ = i.scheduled.Delete(ctx, m.ID)
	return msg, nil
}
