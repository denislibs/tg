package chat

import (
	"context"
	"errors"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// Групповые звонки (видеочаты): сервер — сигналинг-реле + список участников
// (Redis-set). Медиа ходит mesh WebRTC между участниками; join/leave фанятся
// всем членам чата фреймом group_call_update (баннер «Видеочат» + счётчик).

// JoinGroupCall добавляет участника и оповещает членов чата.
// Возвращает участников ДО входа (им новичок шлёт офферы).
//
// Видеочат с нуля начинает только создатель/админ (tweb: кнопка «начать» —
// `hasRights(chat, 'manage_call')`, topbar.ts:350-361; без права и без идущего
// звонка appImManager.joinGroupCall выходит, :2343-2358). Бита manage_call у нас
// нет — право то же, что у эфира (requireCallAdmin). Звонок «идёт», если в нём
// есть участники или активен эфир чата. Отказ — ErrForbidden и кадр
// group_call_update {action: "rejected"} только входящему: клиент к этому
// моменту уже взял микрофон и открыл экран звонка.
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
	first, joined, err := i.admitToGroupCall(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !joined {
		i.publishGroupCallRejected(ctx, chatID, userID, before)
		return nil, domain.ErrForbidden
	}
	i.publishGroupCallUpdate(ctx, chatID, userID, "joined")
	if first {
		// Появился первый участник: у чата теперь call_active.
		i.announceCallChange(ctx, chatID)
	}
	// без себя (на случай повторного join с другой вкладки)
	out := make([]int64, 0, len(before))
	for _, id := range before {
		if id != userID {
			out = append(out, id)
		}
	}
	return out, nil
}

// admitToGroupCall вносит пользователя в звонок по правилам Б-9. first —
// переход 0→1, joined=false — вход запрещён. Не-админ при выключенном эфире
// входит через JoinIfActive: проверка «звонок идёт» и вход — один скрипт Redis,
// иначе последний вышедший оставил бы пустой звонок, а не-админ вошёл бы в него.
func (i *Interactor) admitToGroupCall(ctx context.Context, chatID, userID int64) (first, joined bool, err error) {
	if i.requireCallAdmin(ctx, chatID, userID) == nil {
		first, err = i.groupCalls.Join(ctx, chatID, userID)
		return first, err == nil, err
	}
	live, err := i.livestreamActive(ctx, chatID)
	if err != nil {
		return false, false, err
	}
	if live {
		first, err = i.groupCalls.Join(ctx, chatID, userID)
		return first, err == nil, err
	}
	joined, err = i.groupCalls.JoinIfActive(ctx, chatID, userID)
	return false, joined, err
}

// livestreamActive — идёт ли эфир чата. Эфир не заводили — нет.
func (i *Interactor) livestreamActive(ctx context.Context, chatID int64) (bool, error) {
	if i.livestreams == nil {
		return false, nil
	}
	ls, err := i.livestreams.Get(ctx, chatID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	return ls.Active, err
}

// publishGroupCallRejected сообщает отказ входа ТОЛЬКО входящему (ключ пира —
// его глазами); остальным членам чата ничего не уходит.
func (i *Interactor) publishGroupCallRejected(ctx context.Context, chatID, userID int64, participants []int64) {
	i.publishPeerFrame(ctx, chatID, []int64{userID}, 0, "group_call_update", map[string]any{
		"user_id": userID, "action": "rejected", "participants": participants,
	})
}

// LeaveGroupCall убирает участника и оповещает членов чата.
func (i *Interactor) LeaveGroupCall(ctx context.Context, chatID, userID int64) error {
	if i.groupCalls == nil {
		return nil
	}
	last, err := i.groupCalls.Leave(ctx, chatID, userID)
	if err != nil {
		return err
	}
	i.publishGroupCallUpdate(ctx, chatID, userID, "left")
	if last {
		// Вышел последний участник: у чата снимается call_active.
		i.announceCallChange(ctx, chatID)
	}
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

// RelayGroupCallSignal переадресует SDP/ICE/media-state конкретному участнику.
// Реле — только между УЧАСТНИКАМИ звонка: отправитель состоит в чате, и оба —
// и он, и адресат — в списке участников видеочата (у оригинала участие —
// phone.joinGroupCall с правами, чужой сигнал невозможен). Иначе посторонний,
// зная id чата и участника, слал бы offer и получал его микрофон и камеру.
func (i *Interactor) RelayGroupCallSignal(ctx context.Context, fromUserID, chatID, toUserID int64, data map[string]any) error {
	if i.publisher == nil || toUserID == 0 || toUserID == fromUserID {
		return nil
	}
	if i.groupCalls == nil {
		return domain.ErrNotFound
	}
	member, err := i.chats.IsMember(ctx, chatID, fromUserID)
	if err != nil {
		return err
	}
	if !member {
		return domain.ErrForbidden
	}
	participants, err := i.groupCalls.Participants(ctx, chatID)
	if err != nil {
		return err
	}
	if !slices.Contains(participants, fromUserID) || !slices.Contains(participants, toUserID) {
		return domain.ErrForbidden
	}
	if data == nil {
		data = map[string]any{}
	}
	data["from_user_id"] = fromUserID
	// Ключ пира — глазами ПОЛУЧАТЕЛЯ реле: в приватном звонке у сторон он разный.
	peer, err := i.ChatIDToPeer(ctx, toUserID, chatID)
	if err != nil {
		return err
	}
	data["peer_id"] = peer
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
	i.publishPeerFrame(ctx, chatID, members, 0, "group_call_update", map[string]any{
		"user_id": userID, "action": action, "participants": participants,
	})
}
