package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// tokenGen is overridable in tests.
var tokenGen = func() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (i *Interactor) requireRight(ctx context.Context, chatID, userID int64, r domain.Rights) error {
	if i.groups == nil {
		return domain.ErrForbidden // no group repo (e.g. private chat) ⇒ no admin rights
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden // not a member ⇒ forbidden
	}
	if !domain.HasRight(m.Role, m.Rights, r) {
		return domain.ErrForbidden
	}
	return nil
}

// serviceText builds the JSON stored in a service message's text. The client
// parses it and renders a localized pill (mirrors tweb's messageAction: the
// action + peer names travel as data, not as baked-in prose).
func serviceText(action string, actor domain.UserCard, target *domain.UserCard) string {
	m := map[string]any{"action": action, "actor_id": actor.ID, "actor": actor.DisplayName}
	if target != nil {
		m["user_id"] = target.ID
		m["user"] = target.DisplayName
	}
	b, _ := json.Marshal(m)
	return string(b)
}

// postGroupService inserts a group service message through the normal Send
// pipeline (seq, updates log, live new_message fan-out to every member). This
// doubles as the "chat appeared" signal: a just-added member receives the frame
// for an unknown chat_id and refetches dialogs. Best-effort — the membership
// change itself has already been committed.
func (i *Interactor) postGroupService(ctx context.Context, chatID, actorID int64, text string) {
	if i.msgs == nil || i.updates == nil {
		return // wired without a message pipeline (some unit-test setups)
	}
	_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: actorID, Type: "service", Text: text})
}

// userCard looks up a user for service-message attribution (zero card on miss).
func (i *Interactor) userCard(ctx context.Context, id int64) domain.UserCard {
	if i.groups == nil {
		return domain.UserCard{ID: id}
	}
	us, err := i.groups.UsersByIDs(ctx, []int64{id})
	if err != nil || len(us) == 0 {
		return domain.UserCard{ID: id}
	}
	return us[0]
}

// CreateGroup creates a group chat with the creator plus memberIDs and posts the
// "created the group" service message (which fans out live to every member).
func (i *Interactor) CreateGroup(ctx context.Context, creatorID int64, title, about, username string, isPublic bool, memberIDs []int64) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "group", title, about, username, isPublic, creatorID)
		if e != nil {
			return e
		}
		chatID = id
		if e := i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights); e != nil {
			return e
		}
		seen := map[int64]bool{creatorID: true}
		for _, uid := range memberIDs {
			if seen[uid] {
				continue
			}
			seen[uid] = true
			if e := i.groups.AddMember(ctx, id, uid, domain.RoleMember, 0); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	// Primary-инвайт существует у группы с рождения (tweb exported_invite).
	if i.invites != nil {
		_, _ = i.invites.Create(ctx, chatID, creatorID, tokenGen(), nil, false)
	}
	i.postGroupService(ctx, chatID, creatorID, serviceText("group_create", i.userCard(ctx, creatorID), nil))
	return chatID, nil
}

func (i *Interactor) AddMember(ctx context.Context, chatID, actorID, userID int64) error {
	// Обычному участнику добавление разрешает дефолтное право группы, админу —
	// RightInviteUsers (tweb invite_users).
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermAddMembers, domain.RightInviteUsers); err != nil {
		return err
	}
	// Настройка приглашаемого «кто может приглашать меня в группы» + чёрный
	// список (tweb USER_PRIVACY_RESTRICTED).
	if i.privacy != nil {
		ok, err := i.privacy.Check(ctx, userID, actorID, domain.PrivacyChatInvite)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrPrivacy
		}
	}
	if banned, err := i.groups.IsBanned(ctx, chatID, userID); err == nil && banned {
		// Забаненного возвращает только админ с BAN_USERS (авторазбан, как в Telegram).
		if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
			return domain.ErrForbidden
		}
		if err := i.groups.Unban(ctx, chatID, userID); err != nil {
			return err
		}
	}
	if err := i.groups.AddMember(ctx, chatID, userID, domain.RoleMember, 0); err != nil {
		return err
	}
	target := i.userCard(ctx, userID)
	i.postGroupService(ctx, chatID, actorID, serviceText("add_user", i.userCard(ctx, actorID), &target))
	return nil
}

// RemoveMember kicks userID (needs BAN_USERS) or self-leave (actor == userID).
// The service message is posted BEFORE the row is deleted so the leaving/kicked
// user still receives the fan-out; afterwards a chat_removed frame tells their
// clients to drop the dialog.
func (i *Interactor) RemoveMember(ctx context.Context, chatID, actorID, userID int64) error {
	if actorID != userID {
		if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
			return err
		}
	}
	if _, err := i.groups.GetMember(ctx, chatID, userID); err != nil {
		return err // not a member — nothing to remove, no service message
	}
	if actorID == userID {
		i.postGroupService(ctx, chatID, actorID, serviceText("leave", i.userCard(ctx, actorID), nil))
	} else {
		target := i.userCard(ctx, userID)
		i.postGroupService(ctx, chatID, actorID, serviceText("kick_user", i.userCard(ctx, actorID), &target))
	}
	payload := map[string]any{"chat_id": chatID, "removed": true}
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.RemoveMember(ctx, chatID, userID); e != nil {
			return e
		}
		if i.updates != nil {
			b, e := json.Marshal(payload)
			if e != nil {
				return e
			}
			if _, e := i.updates.AppendUpdate(ctx, userID, 1, nowMillis(), "chat_removed", b); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		_ = i.publisher.PublishToUser(ctx, userID, frame("chat_removed", payload))
	}
	return nil
}

func (i *Interactor) PromoteAdmin(ctx context.Context, chatID, actorID, userID int64, rights domain.Rights) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightManageAdmins); err != nil {
		return err
	}
	return i.groups.SetRole(ctx, chatID, userID, domain.RoleAdmin, rights)
}

func (i *Interactor) DemoteAdmin(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightManageAdmins); err != nil {
		return err
	}
	return i.groups.SetRole(ctx, chatID, userID, domain.RoleMember, 0)
}

func (i *Interactor) EditInfo(ctx context.Context, chatID, actorID int64, title, about, username string) error {
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermChangeInfo, domain.RightChangeInfo); err != nil {
		return err
	}
	old, _ := i.groups.Card(ctx, chatID, actorID)
	if err := i.groups.EditInfo(ctx, chatID, title, about, username); err != nil {
		return err
	}
	// Смена названия — сервисное сообщение (tweb messageActionChatEditTitle); его
	// fan-out заодно обновляет диалог у всех участников live.
	if old.Title != "" && old.Title != title {
		i.postGroupService(ctx, chatID, actorID, serviceText("edit_title", i.userCard(ctx, actorID), nil))
	}
	return nil
}

// SetChatPhoto points the chat's photo at an uploaded media object (needs
// CHANGE_INFO; the media must belong to the actor, mirroring Send's check) and
// posts the "updated the group photo" service message (tweb editPhoto →
// messageActionChatEditPhoto).
func (i *Interactor) SetChatPhoto(ctx context.Context, chatID, actorID, mediaID int64) error {
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermChangeInfo, domain.RightChangeInfo); err != nil {
		return err
	}
	ownerID, err := i.mediaAccess.OwnerID(ctx, mediaID)
	if err != nil {
		return err // ErrNotFound for absent media
	}
	if ownerID != actorID {
		return domain.ErrNotFound
	}
	if err := i.groups.SetPhoto(ctx, chatID, mediaID); err != nil {
		return err
	}
	i.postGroupService(ctx, chatID, actorID, serviceText("edit_photo", i.userCard(ctx, actorID), nil))
	return nil
}

// SetMute: muted=true без until — навсегда (tweb «Forever»), с until —
// временный mute («For 1 Hour…»); muted=false снимает и то и другое.
func (i *Interactor) SetMute(ctx context.Context, chatID, userID int64, muted bool, until *time.Time) error {
	if !muted {
		until = nil
	}
	forever := muted && until == nil
	return i.groups.SetMuted(ctx, chatID, userID, forever, until)
}

// SetChatNotify обновляет per-chat уведомления (показ превью, звук). nil-поля не
// меняются (sound валидируется до 'default'|'none' в хендлере).
func (i *Interactor) SetChatNotify(ctx context.Context, chatID, userID int64, preview *bool, sound *string) error {
	return i.groups.SetNotify(ctx, chatID, userID, preview, sound)
}

func (i *Interactor) ChatCard(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	return i.groups.Card(ctx, chatID, viewerID)
}

func (i *Interactor) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error) {
	return i.groups.UsersByIDs(ctx, ids)
}

// ListMembers returns the chat's members (role + rights + mute). The viewer must
// be a member of the chat; discussion-группа канала — исключение (комментарии
// и @-упоминания доступны подписчику до вступления, как чтение треда).
func (i *Interactor) ListMembers(ctx context.Context, chatID, viewerID int64, offset, limit int) ([]domain.Member, error) {
	ok, err := i.chats.IsMember(ctx, chatID, viewerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		disc, e := i.groups.IsDiscussionGroup(ctx, chatID)
		if e != nil || !disc {
			return nil, domain.ErrForbidden
		}
	}
	return i.groups.ListMembers(ctx, chatID, offset, limit)
}

func (i *Interactor) CreateInvite(ctx context.Context, chatID, actorID int64, usageLimit *int, requiresApproval bool) (domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return domain.InviteLink{}, err
	}
	return i.invites.Create(ctx, chatID, actorID, tokenGen(), usageLimit, requiresApproval)
}

func (i *Interactor) ListInvites(ctx context.Context, chatID, actorID int64) ([]domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return nil, err
	}
	return i.invites.List(ctx, chatID)
}

func (i *Interactor) RevokeInvite(ctx context.Context, chatID, actorID int64, token string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.invites.Revoke(ctx, chatID, token)
}

// JoinByToken resolves an invite link and either joins the user immediately or,
// for approval-required links, records a pending join request. The returned
// requested bool is true when a request was filed (approval needed) and false
// when the user was added as a member.
func (i *Interactor) JoinByToken(ctx context.Context, token string, userID int64) (requested bool, err error) {
	link, err := i.invites.GetByToken(ctx, token)
	if err != nil {
		return false, err
	}
	if banned, e := i.groups.IsBanned(ctx, link.ChatID, userID); e == nil && banned {
		return false, domain.ErrForbidden // из чёрного списка по ссылке не возвращаются
	}
	if link.RequiresApproval {
		if e := i.joinReqs.Create(ctx, link.ChatID, userID, token); e != nil {
			return false, e
		}
		return true, nil
	}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.AddMember(ctx, link.ChatID, userID, domain.RoleMember, 0); e != nil {
			return e
		}
		return i.invites.IncUses(ctx, link.ID)
	})
	return false, err
}

// ListJoinRequests returns the pending join requests for a chat. The actor must
// hold INVITE_USERS.
func (i *Interactor) ListJoinRequests(ctx context.Context, chatID, actorID int64) ([]domain.JoinRequest, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return nil, err
	}
	return i.joinReqs.List(ctx, chatID)
}

// ApproveJoinRequest adds the requesting user as a member and clears the pending
// request. The actor must hold INVITE_USERS.
func (i *Interactor) ApproveJoinRequest(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.AddMember(ctx, chatID, userID, domain.RoleMember, 0); e != nil {
			return e
		}
		return i.joinReqs.Delete(ctx, chatID, userID)
	})
}

// DeclineJoinRequest drops a pending join request. The actor must hold
// INVITE_USERS.
func (i *Interactor) DeclineJoinRequest(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.joinReqs.Delete(ctx, chatID, userID)
}
