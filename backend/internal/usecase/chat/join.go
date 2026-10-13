package chat

import (
	"context"
	"errors"

	"github.com/messenger-denis/backend/internal/domain"
)

// admitVia — кто вводит пользователя в чат: от этого зависят проверки бана и
// приватности.
type admitVia int

const (
	// admitSelf — вступает сам: ссылка, @имя, папка. Забаненного не пускает
	// ничто (у оригинала USER_BANNED_IN_CHANNEL / CHANNEL_PRIVATE).
	admitSelf admitVia = iota
	// admitAdded — добавляет другой участник (channels.inviteToChannel):
	// соблюдается настройка «кто может приглашать меня в группы» приглашаемого,
	// а забаненного вернуть может только админ с ban_users (авторазбан).
	admitAdded
	// admitApproved — админ одобряет ЗАЯВКУ пользователя
	// (messages.hideChatJoinRequest approved): пользователь сам попросился,
	// поэтому настройка приватности не спрашивается, а бан — как у admitAdded.
	admitApproved
)

// admit — единственная точка вступления в группу или канал. Роль выводится из
// типа чата (domain.JoinRole), бан и приватность проверяются по пути
// вступления. Права самого действия («может ли актор приглашать», «жива ли
// ссылка», «есть ли заявка») проверяет вызывающий: они у путей разные, а
// общее — здесь.
//
// Прежде путей было семь, и каждый писал строку участника сам: комментарий и
// ответ в тред, вход по @имени и по ссылке на папку бан не смотрели вовсе,
// одобрение «заявки» добавляло кого угодно мимо бана и приватности, а роль
// в канал по ссылке выходила «участником группы».
//
// Уже участник — не ошибка и ничего не меняет (вызывающий решает, нужны ли
// служебка и счёт использований); joined=false.
func (i *Interactor) admit(ctx context.Context, chatID, userID, actorID int64, via admitVia) (joined bool, err error) {
	if i.groups == nil {
		return false, domain.ErrForbidden
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return false, err
	}
	if typ != domain.ChatTypeGroup && typ != domain.ChatTypeChannel {
		return false, domain.ErrForbidden
	}
	if _, e := i.groups.GetMember(ctx, chatID, userID); e == nil {
		return false, nil
	}
	banned, err := i.groups.IsBanned(ctx, chatID, userID)
	if err != nil {
		return false, err
	}
	if via == admitAdded && i.privacy != nil {
		// Настройка приглашаемого «кто может приглашать меня в группы» + чёрный
		// список (tweb USER_PRIVACY_RESTRICTED).
		ok, e := i.privacy.Check(ctx, userID, actorID, domain.PrivacyChatInvite)
		if e != nil {
			return false, e
		}
		if !ok {
			return false, domain.ErrPrivacy
		}
	}
	if banned {
		if via == admitSelf {
			return false, domain.ErrForbidden
		}
		// Забаненного возвращает только админ с BAN_USERS (авторазбан, как в Telegram).
		if e := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); e != nil {
			return false, domain.ErrForbidden
		}
		if e := i.groups.Unban(ctx, chatID, userID); e != nil {
			return false, e
		}
	}
	// Создатель, вышедший и вернувшийся, снова владелец: tweb держит
	// pFlags.creator независимо от left (hasRights.ts:6-7, :25-27), а сервер
	// помнит его в chats.creator_id.
	role, rights := domain.JoinRole(typ), domain.Rights(0)
	switch cid, e := i.groups.CreatorID(ctx, chatID); {
	case e == nil && cid == userID:
		role, rights = domain.RoleCreator, domain.AllRights
	case e != nil && !errors.Is(e, domain.ErrNotFound):
		return false, e
	}
	if err := i.groups.AddMember(ctx, chatID, userID, role, rights); err != nil {
		return false, err
	}
	return true, nil
}

// JoinFolderChat — вступление в чат по ссылке на папку (chatlists.joinChatlistInvite):
// пользователь вступает сам. Набор чатов ссылки проверяет usecase папок.
func (i *Interactor) JoinFolderChat(ctx context.Context, chatID, userID int64) error {
	_, err := i.admit(ctx, chatID, userID, userID, admitSelf)
	return err
}

// rejoinCreator возвращает в чат вышедшего создателя, который пишет в него:
// tweb оставляет создателю право писать и в «покинутый» канал
// (utils/chats/hasRights.ts:6-7, «creator can still send messages to left
// channel»). Что делает сервер Telegram, по tweb не определить; вывод — без
// строки участника автор не попал бы в веер и не получил бы своё сообщение.
// Возвращает true, если пользователь теперь участник. Не создатель, личка и
// «Избранное» — false без ошибки; забаненному (admit) — ErrForbidden.
func (i *Interactor) rejoinCreator(ctx context.Context, chatID, userID int64) (bool, error) {
	if i.groups == nil {
		return false, nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil || (typ != domain.ChatTypeGroup && typ != domain.ChatTypeChannel) {
		return false, err
	}
	cid, err := i.groups.CreatorID(ctx, chatID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && (cid == 0 || cid != userID)) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	joined, err := i.admit(ctx, chatID, userID, userID, admitSelf)
	if err != nil {
		return false, err
	}
	if joined {
		i.afterSelfJoin(ctx, chatID, userID)
	}
	return true, nil
}

// afterSelfJoin — хвост вступления самого пользователя (по @имени, возврат
// создателя): подписка сокетов на канал, служебка «вступил(а)» (только в
// группе: состав broadcast-канала служебками не пишется), снимок чата всем,
// снимок глазами вступившего и кадр участника.
func (i *Interactor) afterSelfJoin(ctx context.Context, chatID, userID int64) {
	i.announceChannelJoin(ctx, chatID, userID)
	i.postGroupService(ctx, chatID, userID, domain.NewMessageActionChatAddUser([]int64{userID}))
	i.publishChatUpdate(ctx, chatID)
	i.publishViewerChat(ctx, chatID, userID)
	i.emitParticipant(ctx, chatID, userID, userID, participantChange{next: i.participantNow(ctx, chatID, userID)})
}

// isMemberOrRejoin — гейт членства отправки: участник — да; вышедший создатель
// сначала возвращается в чат (rejoinCreator) и тоже да; остальные — нет.
func (i *Interactor) isMemberOrRejoin(ctx context.Context, chatID, userID int64) (bool, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil || ok {
		return ok, err
	}
	return i.rejoinCreator(ctx, chatID, userID)
}
