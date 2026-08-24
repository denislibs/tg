package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// SavedDialogsPage — «Избранное» в разрезе источников, РАЗЛОЖЕННОЕ по векторам
// контейнера messages.savedDialogs (см. domain/mtsaveddialog.go).
//
// Строка перестала держать в себе снимок источника (заголовок, номер аватарки)
// и выжимку последнего сообщения: карточки едут в `chats`/`users`, сообщение —
// в `messages`, а строка адресует его числом `top_message`.
type SavedDialogsPage struct {
	Dialogs  []domain.SavedDialogRecord
	Messages []domain.Message
	Chats    []domain.Chat
	Users    []domain.UserReal
}

// SavedDialogsPage собирает «Избранное» в раскладке контейнера.
//
// Обращений к базе фиксированное число: список строк → ОДИН запрос за
// последними сообщениями → ОДИН за карточками людей. Карточки чатов-источников
// берутся по одной (`Card`), и это осознанно: пакетного чтения карточек в
// порту нет, а число РАЗНЫХ чатов-источников равно числу строк списка, который
// не пагинируется и умещается на экран.
func (i *Interactor) SavedDialogsPage(ctx context.Context, viewerID int64) (SavedDialogsPage, error) {
	rows, err := i.SavedDialogs(ctx, viewerID)
	if err != nil {
		return SavedDialogsPage{}, err
	}

	// ── messages: последние сохранённые сообщения источников ────────────────
	ids := make([]int64, 0, len(rows))
	for _, d := range rows {
		if d.LastMsgID != 0 {
			ids = append(ids, d.LastMsgID)
		}
	}
	var messages []domain.Message
	if len(ids) > 0 && i.msgs != nil {
		messages, err = i.msgs.GetByIDs(ctx, ids)
		if err != nil {
			return SavedDialogsPage{}, err
		}
	}

	// ── chats/users: карточки самих источников ──────────────────────────────
	// Прежде вместо них ехали `title` и `photo_id`, подклеенные JOIN-ами прямо
	// в строку, — снимок вместо ссылки.
	userIDs := make([]int64, 0, len(rows))
	var chats []domain.Chat
	seen := make(map[int64]bool, len(rows))
	for _, d := range rows {
		if seen[int64(d.PeerID)] {
			continue
		}
		seen[int64(d.PeerID)] = true
		switch {
		case d.PeerID.IsAnyChat():
			if i.groups == nil {
				continue
			}
			card, err := i.groups.Card(ctx, d.PeerID.ToChatID(), viewerID)
			if err != nil {
				// Источник мог быть удалён — строка остаётся, карточки нет:
				// клиент нарисует её фолбэком, как и любой пробел зеркала.
				continue
			}
			ch := card.ToChannel()
			chats = append(chats, ch)
		case d.PeerID != 0:
			userIDs = append(userIDs, int64(d.PeerID))
		}
	}
	var users []domain.UserReal
	if len(userIDs) > 0 && i.groups != nil {
		users, err = i.groups.UsersByIDs(ctx, userIDs)
		if err != nil {
			return SavedDialogsPage{}, err
		}
	}

	return SavedDialogsPage{Dialogs: rows, Messages: messages, Chats: chats, Users: users}, nil
}
