package chat

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// SuggestBirthday — users.suggestBirthday: fromUserID предлагает toUserID
// указать дату рождения. У оригинала результат — служебное сообщение
// messageActionSuggestBirthday в их личной переписке; получатель принимает
// дату кнопкой «Посмотреть» у своей пилюли (tweb bubbles/suggestBirthday.tsx).
//
// Дата — ввод: границы те же, что у собственной даты (domain.Birthday.Time);
// дискриминатор ставится здесь, клиент присылает day/month/year.
func (i *Interactor) SuggestBirthday(ctx context.Context, fromUserID, toUserID int64, b domain.Birthday) (domain.Message, error) {
	if fromUserID == toUserID {
		return domain.Message{}, domain.ErrInvalid
	}
	if _, err := b.Time(time.Now()); err != nil {
		return domain.Message{}, err
	}
	b.Underscore = domain.BirthdayTag
	chatID, err := i.CreatePrivateChat(ctx, fromUserID, toUserID)
	if err != nil {
		return domain.Message{}, err
	}
	return i.Send(ctx, SendInput{
		ChatID:   chatID,
		SenderID: fromUserID,
		Action:   domain.NewMessageActionSuggestBirthday(b),
	})
}
