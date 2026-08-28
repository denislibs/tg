package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// SetChatTheme задаёт (или сбрасывает при themeID="") тему оформления чата
// (Telegram messages.setChatTheme). Тема общая для чата — применяется у обоих
// участников, поэтому смена рассылается всем членам фреймом chat_theme_update
// (как dialog_pin/archive — живой fan-out; при перезагрузке тема приезжает в
// ПОЛНОЙ КАРТОЧКЕ пира — chatFull/channelFull/userFull.theme_emoticon, — а не
// в списке диалогов: в схеме у диалога такого поля нет вовсе, см. решение Р7
// в docs/readiness/tl-dialogs-analysis.md). Менять может любой участник.
func (i *Interactor) SetChatTheme(ctx context.Context, chatID, actorID int64, themeID string) error {
	ok, err := i.chats.IsMember(ctx, chatID, actorID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if err := i.chats.SetChatTheme(ctx, chatID, themeID, actorID); err != nil {
		return err
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	// Логируем + шлём chat_theme_update всем членам: плотный pts-курсор доносит
	// смену темы и через /sync (при перезагрузке она едет в полной карточке).
	// Ключ кадра — theme_id, а не theme_emoticon: кадры апдейтов объектами
	// схемы ещё не стали (подсистема обновлений в программе TL не переведена),
	// поэтому одно и то же поле пока зовётся по-разному на двух путях.
	// Лог/публикация — best-effort: мутация уже закоммичена, её сбой не должен
	// возвращаться как ошибка запроса (иначе клиент увидит 500 при успешной смене).
	_ = i.logAndPublishPerPeer(ctx, chatID, members, "chat_theme_update",
		func(peer domain.PeerID) map[string]any {
			return map[string]any{
				"_": domain.UpdateChatThemeTag, "peer": domain.NewPeer(peer), "theme_id": themeID,
			}
		})
	return nil
}
