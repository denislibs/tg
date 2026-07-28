package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// SetChatTheme задаёт (или сбрасывает при themeID="") тему оформления чата
// (Telegram messages.setChatTheme). Тема общая для чата — применяется у обоих
// участников, поэтому смена рассылается всем членам фреймом chat_theme_update
// (как dialog_pin/archive — живой fan-out; при перезагрузке тема приезжает
// полем theme_id в списке диалогов). Менять может любой участник.
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
	// смену темы и через /sync (при перезагрузке тема также едет в списке диалогов).
	return i.logAndPublish(ctx, members, "chat_theme_update", map[string]any{"chat_id": chatID, "theme_id": themeID})
}
