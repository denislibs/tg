package auth

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// EnsureServiceAvatar ставит служебному аккаунту (777000) фото профиля, если
// его ещё нет. Идемпотентно: при уже стоящей аватарке upload не зовётся вовсе,
// так что перезапуск сервера ничего не заливает повторно.
//
// Загрузка приходит параметром: байты и путь в объектное хранилище — забота
// сборки (app), здесь только решение «нужно ли» и привязка к профилю тем же
// путём, что у любой аватарки (галерея + stripped-превью).
//
// Событие user_update не рассылается: вызывается на старте, до того как сервер
// начал слушать порт, — подписчиков ещё нет, а клиенты получат карточку с фото
// первым же ответом.
func (i *Interactor) EnsureServiceAvatar(ctx context.Context, upload func(context.Context) (int64, error)) error {
	u, err := i.users.GetByID(ctx, domain.ServiceUserID)
	if err != nil {
		return err
	}
	if u.PhotoID != nil {
		return nil
	}
	mediaID, err := upload(ctx)
	if err != nil {
		return err
	}
	_, err = i.users.AddProfilePhoto(ctx, domain.ServiceUserID, mediaID, nil, i.avatarPreviewFor(ctx, mediaID))
	return err
}
