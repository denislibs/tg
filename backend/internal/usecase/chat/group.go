package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"github.com/messenger-denis/backend/internal/domain"
)

// tokenGen is overridable in tests.
var tokenGen = func() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (i *Interactor) requireRight(ctx context.Context, chatID, userID int64, r domain.Rights) error {
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden // not a member ⇒ forbidden
	}
	if !domain.HasRight(m.Role, m.Rights, r) {
		return domain.ErrForbidden
	}
	return nil
}

func (i *Interactor) CreateGroup(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "group", title, about, username, isPublic, creatorID)
		if e != nil {
			return e
		}
		chatID = id
		return i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights)
	})
	return chatID, err
}

func (i *Interactor) AddMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.groups.AddMember(ctx, chatID, userID, domain.RoleMember, 0)
}

// RemoveMember kicks userID (needs BAN_USERS) or self-leave (actor == userID).
func (i *Interactor) RemoveMember(ctx context.Context, chatID, actorID, userID int64) error {
	if actorID != userID {
		if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
			return err
		}
	}
	return i.groups.RemoveMember(ctx, chatID, userID)
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
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.groups.EditInfo(ctx, chatID, title, about, username)
}

func (i *Interactor) SetMute(ctx context.Context, chatID, userID int64, muted bool) error {
	return i.groups.SetMuted(ctx, chatID, userID, muted)
}

func (i *Interactor) ChatCard(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	return i.groups.Card(ctx, chatID, viewerID)
}

func (i *Interactor) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error) {
	return i.groups.UsersByIDs(ctx, ids)
}

// ListMembers returns the chat's members (role + rights + mute). The viewer must
// be a member of the chat; otherwise domain.ErrForbidden.
func (i *Interactor) ListMembers(ctx context.Context, chatID, viewerID int64, offset, limit int) ([]domain.Member, error) {
	ok, err := i.chats.IsMember(ctx, chatID, viewerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrForbidden
	}
	return i.groups.ListMembers(ctx, chatID, offset, limit)
}

func (i *Interactor) CreateInvite(ctx context.Context, chatID, actorID int64, usageLimit *int) (domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return domain.InviteLink{}, err
	}
	return i.invites.Create(ctx, chatID, actorID, tokenGen(), usageLimit)
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

func (i *Interactor) JoinByToken(ctx context.Context, token string, userID int64) error {
	link, err := i.invites.GetByToken(ctx, token)
	if err != nil {
		return err
	}
	return i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.AddMember(ctx, link.ChatID, userID, domain.RoleMember, 0); e != nil {
			return e
		}
		return i.invites.IncUses(ctx, link.ID)
	})
}
