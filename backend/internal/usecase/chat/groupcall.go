package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Групповые звонки (видеочаты): сервер — сигналинг-реле + список участников
// (Redis-set). Медиа ходит mesh WebRTC между участниками; join/leave фанятся
// всем членам чата фреймом group_call_update (баннер «Видеочат» + счётчик).

// JoinGroupCall добавляет участника и оповещает членов чата.
// Возвращает участников ДО входа (им новичок шлёт офферы).
func (i *Interactor) JoinGroupCall(ctx context.Context, chatID, userID int64) ([]int64, error) {
	if i.groupCalls == nil {
		return nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	before, err := i.groupCalls.Participants(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if err := i.groupCalls.Join(ctx, chatID, userID); err != nil {
		return nil, err
	}
	i.publishGroupCallUpdate(ctx, chatID, userID, "joined")
	// без себя (на случай повторного join с другой вкладки)
	out := make([]int64, 0, len(before))
	for _, id := range before {
		if id != userID {
			out = append(out, id)
		}
	}
	return out, nil
}

// LeaveGroupCall убирает участника и оповещает членов чата.
func (i *Interactor) LeaveGroupCall(ctx context.Context, chatID, userID int64) error {
	if i.groupCalls == nil {
		return nil
	}
	if err := i.groupCalls.Leave(ctx, chatID, userID); err != nil {
		return err
	}
	i.publishGroupCallUpdate(ctx, chatID, userID, "left")
	return nil
}

// GroupCallParticipants — текущие участники (для баннера Join при открытии чата).
func (i *Interactor) GroupCallParticipants(ctx context.Context, chatID, userID int64) ([]int64, error) {
	if i.groupCalls == nil {
		return nil, nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.groupCalls.Participants(ctx, chatID)
}

// RelayGroupCallSignal переадресует SDP/ICE/media-state конкретному участнику
// (сервер — глупое реле, как в 1:1 RelayCall).
func (i *Interactor) RelayGroupCallSignal(ctx context.Context, fromUserID, chatID, toUserID int64, data map[string]any) error {
	if i.publisher == nil || toUserID == 0 || toUserID == fromUserID {
		return nil
	}
	if data == nil {
		data = map[string]any{}
	}
	data["from_user_id"] = fromUserID
	data["chat_id"] = chatID
	return i.publisher.PublishToUser(ctx, toUserID, frame("group_call_signal", data))
}

func (i *Interactor) publishGroupCallUpdate(ctx context.Context, chatID, userID int64, action string) {
	if i.publisher == nil {
		return
	}
	participants, err := i.groupCalls.Participants(ctx, chatID)
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("group_call_update", map[string]any{
		"chat_id": chatID, "user_id": userID, "action": action, "participants": participants,
	})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
