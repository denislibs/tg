package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// SuggestProfilePhoto posts a service message into the private chat between
// fromUserID and toUserID offering a new profile photo. The suggested photo
// rides on the message's media_id (the single place it lives; Send checks that
// the suggester owns the file). Mirrors Telegram
// photos.uploadContactProfilePhoto with suggest=true.
func (i *Interactor) SuggestProfilePhoto(ctx context.Context, fromUserID, toUserID, mediaID int64) (domain.Message, error) {
	if fromUserID == toUserID {
		return domain.Message{}, domain.ErrInvalid
	}
	chatID, err := i.CreatePrivateChat(ctx, fromUserID, toUserID)
	if err != nil {
		return domain.Message{}, err
	}
	// Id предложенной аватарки хранился ДВАЖДЫ — в JSON действия и на media_id
	// самого сообщения. Остаётся одно место: media_id, из которого фото и
	// собирается конструктором photo на границе (Message.ToWire).
	mid := mediaID
	return i.Send(ctx, SendInput{
		ChatID:   chatID,
		SenderID: fromUserID,
		Action:   domain.NewMessageActionSuggestProfilePhoto(nil, false),
		MediaID:  &mid,
		// запрос пользователя: заблокировавшему картинку не доставить
		userAction: true,
	})
}
