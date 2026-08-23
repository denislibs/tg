package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// MessagesContainer готовит содержимое контейнера messages.Messages: вектор
// сообщений вместе с карточками их АВТОРОВ.
//
// Зачем автор едет рядом. У оригинала `users` — обязательный параметр обоих
// конструкторов контейнера, и это не формальность: получатель списка обязан
// уметь нарисовать подпись, не спрашивая ни о ком отдельно. Тот же ход уже
// сделан у диалогов (dialogscontainer.go), где отсутствие авторов заставляло
// сервер склеивать имя строкой (`last_sender_name`).
//
// Аватарки авторов гасятся правилом приватности — тем же, что у собеседников
// диалогов: карточка, доехавшая мимо правила, показала бы фото тому, кому
// автор его не открывал.
//
// Вектор `chats` этой функцией НЕ наполняется, и это названный долг, а не
// пропуск: карточка нужна там, где автор — канал (пост от лица канала) либо
// где список пришёл из ГЛОБАЛЬНОГО поиска по чужим чатам. В остальных случаях
// чат уже известен клиенту из списка диалогов.
func (i *Interactor) MessagesContainer(ctx context.Context, viewerID int64, msgs []domain.Message) ([]domain.MTMessage, []domain.UserReal, error) {
	wire, err := i.MessagesWire(ctx, viewerID, msgs)
	if err != nil {
		return nil, nil, err
	}
	return wire, i.messageAuthors(ctx, viewerID, msgs), nil
}

// messageAuthors — карточки авторов пачки, по одной на автора.
//
// Сбой запроса не роняет выдачу: список сообщений полезен и без подписей, а
// упавшая история полезна никому. Порядок тот же, что у диалогов.
func (i *Interactor) messageAuthors(ctx context.Context, viewerID int64, msgs []domain.Message) []domain.UserReal {
	if i.groups == nil {
		return nil
	}
	seen := make(map[int64]bool, len(msgs))
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if m.SenderID != 0 && !seen[m.SenderID] {
			seen[m.SenderID] = true
			ids = append(ids, m.SenderID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	authors, err := i.groups.UsersByIDs(ctx, ids)
	if err != nil {
		return nil
	}
	i.gateAuthorPhotos(ctx, viewerID, authors)
	return authors
}
