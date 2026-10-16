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
// нет — право то же, что у эфира (создатель/админ). Звонок «идёт», если в нём
// есть участники или активен эфир чата. Запрет — domain.ErrForbidden: отказ
// сообщает входящему соединению СЛОЙ ТРАНСПОРТА (ws: group_call_update
// {action: "rejected"}), потому что это ответ на кадр одного соединения, а не
// событие пользователя — на других его устройствах открытый звонок не трогаем.
//
// В звонке уже domain.GroupCallMaxParticipants участников — domain.ErrGroupCallFull
// (К3, предел mesh; у tweb видеочат через SFU предела не знает).
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
// переход 0→1, joined=false — вход запрещён. В группе сначала JoinIfActive
// (проверка «звонок идёт» и вход — один скрипт Redis, иначе последний вышедший
// оставил бы пустой звонок, а не-админ вошёл бы в него; проверка права в БД
// только когда звонка нет). Звонка нет — открыть его может админ либо любой при
// активном эфире.
//
// ОТСТУПЛЕНИЕ ОТ TWEB (В-S3, решение пользователя 2026-10-15): в вещательном
// канале JoinIfActive пропускается — идущий видеочат открыт только
// создателю/админам, подписчика пускает лишь активный эфир. tweb пускает
// подписчика слушателем через SFU (components/chat/topbar.ts:387-392); SFU у нас
// нет, и подписчик стал бы полноправным участником mesh (O(N²) потоков). Снимется
// с В-М17.
func (i *Interactor) admitToGroupCall(ctx context.Context, chatID, userID int64) (first, joined bool, err error) {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return false, false, err
	}
	if typ != domain.ChatTypeChannel {
		joined, err = i.groupCalls.JoinIfActive(ctx, chatID, userID, domain.GroupCallMaxParticipants)
		if err != nil || joined {
			return false, joined, err
		}
	}
	allowed, err := i.isCallAdmin(ctx, chatID, userID)
	if err != nil {
		return false, false, err
	}
	if !allowed {
		if allowed, err = i.livestreamActive(ctx, chatID); err != nil || !allowed {
			return false, false, err
		}
	}
	first, err = i.groupCalls.Join(ctx, chatID, userID, domain.GroupCallMaxParticipants)
	return first, err == nil, err
}

// isCallAdmin — создатель/админ чата (как requireCallAdmin), но сбой хранилища
// возвращается ошибкой, а не «не админ»: иначе таймаут БД выглядел бы как отказ
// по праву, и создателю закрывало бы звонок.
func (i *Interactor) isCallAdmin(ctx context.Context, chatID, userID int64) (bool, error) {
	if i.groups == nil {
		return false, nil
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin, nil
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
