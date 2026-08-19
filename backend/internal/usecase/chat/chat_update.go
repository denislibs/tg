package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// chatUpdatePayload — АБСОЛЮТНЫЙ снимок чата (не дифф) в форме оригинала:
// messages.chatFull, то есть полная карточка ВМЕСТЕ с краткой формой самого
// чата. Как и у reaction/poll, абсолютное представление делает catch-up через
// /sync идемпотентным — клиент просто заменяет карточку чата на этот снимок,
// в каком бы порядке апдейты ни доехали.
//
// Это ТОТ ЖЕ объект, что отдаёт ручка карточки (GroupHandler.Card). Раньше
// одна и та же ChatCard ехала здесь и там в двух разных формах — плоско с id
// против вложенно, — и клиент разбирал их двумя разными путями.
//
// Снимок БЕЗ ЗРИТЕЛЯ (кадр один на всех участников), и это видно в самом
// объекте: флагов членства нет вовсе (см. ChatRecord.ViewerID), а обязательные
// горизонты чтения channelFull едут нулями. Их зритель-зависимые значения
// приезжают ручкой карточки, которую клиент и без того открывает поимённо.
func chatUpdatePayload(c domain.ChatRecord) map[string]any {
	return map[string]any{"chat_full": domain.NewMessagesChatFull(c.ToChannelFull(), c.ToChannel())}
}

// publishChatUpdate логирует и рассылает участникам chat_update — абсолютный
// снимок метаданных чата после мутации (title/photo/member/admin/settings), так
// что изменение доезжает и через /sync (плотный pts-курсор), а не только живым
// кадром. Снимок viewer-agnostic (viewerID=0): один payload всем и в лог.
// Best-effort — метаданные косметические, ошибка рассылки не должна валить мутацию.
func (i *Interactor) publishChatUpdate(ctx context.Context, chatID int64) {
	if i.groups == nil {
		return
	}
	card, err := i.groups.Card(ctx, chatID, 0)
	if err != nil {
		return
	}
	payload := chatUpdatePayload(card)
	// Канал: один channel-broadcast (O(1)) по channel-конверту вместо N+1 fan-out
	// в per-user лог каждого подписчика. Подписчики получают кадр живым, остальные
	// добирают снимок при открытии через /channels/{id}/difference. Группа —
	// прежний per-user путь (у групп нет channel_pts/топика).
	if card.Type == domain.ChatTypeChannel {
		_ = i.logAndPublishChannel(ctx, chatID, "chat_update", payload)
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	_ = i.logAndPublish(ctx, chatID, members, "chat_update", payload)
}
