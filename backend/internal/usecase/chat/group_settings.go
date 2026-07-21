package chat

import (
	"context"
	"encoding/json"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// memberCan resolves an action gated by a default member permission (plain
// members) or an admin right (admins; creator always may). Channel subscribers
// may do none of these. Private-chat members pass through the default 31 mask.
func (i *Interactor) memberCan(ctx context.Context, chatID, userID int64, perm domain.MemberPerms, right domain.Rights) (bool, error) {
	if i.groups == nil {
		return false, nil
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return false, err
	}
	switch m.Role {
	case domain.RoleCreator, domain.RoleAdmin:
		return domain.HasRight(m.Role, m.Rights, right), nil
	case domain.RoleSubscriber:
		return false, nil
	}
	s, err := i.groups.Settings(ctx, chatID)
	if err != nil {
		return false, err
	}
	return s.DefaultPerms&perm == perm, nil
}

// requirePermOrRight is requireRight's member-aware counterpart.
func (i *Interactor) requirePermOrRight(ctx context.Context, chatID, userID int64, perm domain.MemberPerms, right domain.Rights) error {
	ok, err := i.memberCan(ctx, chatID, userID, perm, right)
	if err != nil {
		return domain.ErrForbidden
	}
	if !ok {
		return domain.ErrForbidden
	}
	return nil
}

// checkSendAllowed enforces group default permissions + slowmode for plain
// members (tweb groupPermissions). Admins/creator are exempt; a resend of an
// already-inserted client_msg_id is exempt too (the dedupe path returns the
// existing message, slowmode must not NACK it).
func (i *Interactor) checkSendAllowed(ctx context.Context, in SendInput) error {
	if i.groups == nil {
		return nil
	}
	m, err := i.groups.GetMember(ctx, in.ChatID, in.SenderID)
	if err != nil || m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
		return nil // membership уже проверена; админам можно всё
	}
	s, err := i.groups.Settings(ctx, in.ChatID)
	if err != nil {
		return nil
	}
	if s.DefaultPerms&domain.PermSendMessages == 0 {
		return domain.ErrForbidden
	}
	if in.MediaID != nil && s.DefaultPerms&domain.PermSendMedia == 0 {
		return domain.ErrForbidden
	}
	// Пер-юзерное ограничение (Telegram ChatBannedRights) поверх дефолта чата:
	// запрет SendMessages блокирует любую отправку, запрет SendMedia — только
	// медиа. Истёкшее ограничение игнорируется (best-effort удаляем).
	if res, ok, e := i.groups.GetRestriction(ctx, in.ChatID, in.SenderID); e == nil && ok {
		if res.Active(time.Now()) {
			if res.DeniedRights.Denies(domain.PermSendMessages) {
				return domain.ErrForbidden
			}
			if in.MediaID != nil && res.DeniedRights.Denies(domain.PermSendMedia) {
				return domain.ErrForbidden
			}
		} else {
			_ = i.groups.DeleteRestriction(ctx, in.ChatID, in.SenderID)
		}
	}
	if s.SlowmodeSeconds > 0 {
		if in.ClientMsgID != "" {
			if _, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				return nil // ретрай уже принятого сообщения
			}
		}
		last, e := i.msgs.LastMessageAt(ctx, in.ChatID, in.SenderID)
		if e == nil && time.Since(last) < time.Duration(s.SlowmodeSeconds)*time.Second {
			return domain.ErrSlowmode
		}
	}
	return nil
}

// ChatSettingsFor returns the chat's group settings (any member may read them).
func (i *Interactor) ChatSettingsFor(ctx context.Context, chatID, viewerID int64) (domain.ChatSettings, error) {
	ok, err := i.chats.IsMember(ctx, chatID, viewerID)
	if err != nil {
		return domain.ChatSettings{}, err
	}
	if !ok {
		return domain.ChatSettings{}, domain.ErrForbidden
	}
	return i.groups.Settings(ctx, chatID)
}

// SetChatType switches the group between private and public (tweb chatType tab).
func (i *Interactor) SetChatType(ctx context.Context, chatID, actorID int64, isPublic bool, username string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.groups.SetType(ctx, chatID, isPublic, username)
}

// SetChatPermissions stores the default member permissions + slowmode (tweb
// groupPermissions; needs the admin's BAN_USERS, tweb's change_permissions).
func (i *Interactor) SetChatPermissions(ctx context.Context, chatID, actorID int64, perms domain.MemberPerms, slowmodeSeconds int) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	perms &= domain.AllMemberPerms
	if !slices.Contains([]int{0, 5, 10, 30, 60, 300, 900, 3600}, slowmodeSeconds) {
		slowmodeSeconds = 0
	}
	return i.groups.SetPermissions(ctx, chatID, perms, slowmodeSeconds)
}

// SetChatReactions stores the reaction policy: 'all' | 'some' (allowed list) | 'none'.
func (i *Interactor) SetChatReactions(ctx context.Context, chatID, actorID int64, mode string, allowed []string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	if mode != "all" && mode != "some" && mode != "none" {
		return domain.ErrBadReaction
	}
	if mode != "some" {
		allowed = nil
	}
	if len(allowed) > 64 {
		allowed = allowed[:64]
	}
	for _, e := range allowed {
		if e == "" || len(e) > maxEmojiLen || !utf8.ValidString(e) {
			return domain.ErrBadReaction
		}
	}
	return i.groups.SetReactions(ctx, chatID, mode, allowed)
}

// SetChatHistoryForNew toggles "Chat history for new members" (tweb ChatHistory).
func (i *Interactor) SetChatHistoryForNew(ctx context.Context, chatID, actorID int64, visible bool) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.groups.SetHistoryForNew(ctx, chatID, visible)
}

// BanMember kicks userID (if a member) and puts them on the removed-users list
// so invite links / re-adding by plain members won't let them back.
func (i *Interactor) BanMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	if userID == actorID {
		return domain.ErrForbidden
	}
	if m, err := i.groups.GetMember(ctx, chatID, userID); err == nil {
		if m.Role == domain.RoleCreator {
			return domain.ErrForbidden
		}
		if e := i.RemoveMember(ctx, chatID, actorID, userID); e != nil {
			return e
		}
	}
	return i.groups.Ban(ctx, chatID, userID, actorID)
}

// UnbanMember removes userID from the removed-users list (they may rejoin).
func (i *Interactor) UnbanMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	return i.groups.Unban(ctx, chatID, userID)
}

// ListBanned returns the chat's removed users (admins with BAN_USERS only).
func (i *Interactor) ListBanned(ctx context.Context, chatID, actorID int64) ([]domain.BannedUser, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return nil, err
	}
	return i.groups.ListBans(ctx, chatID)
}

// RestrictMember applies a granular per-user restriction (Telegram editBanned /
// ChatBannedRights): deniedRights is a MemberPerms bitmask of what the target
// may NOT do, in effect until now+untilSeconds (untilSeconds<=0 — forever). The
// member stays in the chat (unlike a ban). Gated by the ban/restrict admin
// right; the creator can't be restricted. Announced as a `restrict` service msg.
func (i *Interactor) RestrictMember(ctx context.Context, chatID, actorID, targetID int64, deniedRights domain.MemberPerms, untilSeconds int) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	if targetID == actorID {
		return domain.ErrForbidden
	}
	if m, err := i.groups.GetMember(ctx, chatID, targetID); err == nil {
		if m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
			return domain.ErrForbidden // админов/создателя ограничить нельзя
		}
	}
	deniedRights &= domain.AllMemberPerms
	var until *time.Time
	if untilSeconds > 0 {
		t := time.Now().Add(time.Duration(untilSeconds) * time.Second)
		until = &t
	}
	if err := i.groups.SetRestriction(ctx, domain.MemberRestriction{
		ChatID: chatID, UserID: targetID, DeniedRights: deniedRights,
		UntilDate: until, RestrictedBy: actorID,
	}); err != nil {
		return err
	}
	actor := i.userCard(ctx, actorID)
	target := i.userCard(ctx, targetID)
	text, _ := json.Marshal(map[string]any{
		"action": "restrict", "actor_id": actor.ID, "actor": actor.DisplayName,
		"user_id": target.ID, "user": target.DisplayName, "denied_rights": int(deniedRights),
	})
	i.postGroupService(ctx, chatID, actorID, string(text))
	return nil
}

// UnrestrictMember lifts a member's granular restriction.
func (i *Interactor) UnrestrictMember(ctx context.Context, chatID, actorID, targetID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	return i.groups.DeleteRestriction(ctx, chatID, targetID)
}

// ListRestricted returns the chat's granularly-restricted members (admins with
// BAN_USERS only). Expired restrictions are filtered out.
func (i *Interactor) ListRestricted(ctx context.Context, chatID, actorID int64) ([]domain.MemberRestriction, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return nil, err
	}
	all, err := i.groups.ListRestrictions(ctx, chatID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	out := make([]domain.MemberRestriction, 0, len(all))
	for _, r := range all {
		if r.Active(now) {
			out = append(out, r)
		}
	}
	return out, nil
}

// DeleteGroup deletes the whole group for everyone (creator only, tweb
// «Delete and Leave Group» for the owner): every member gets a chat_removed
// frame, then the chat row (members/messages cascade) is dropped.
func (i *Interactor) DeleteGroup(ctx context.Context, chatID, actorID int64) error {
	m, err := i.groups.GetMember(ctx, chatID, actorID)
	if err != nil {
		return domain.ErrForbidden
	}
	if m.Role != domain.RoleCreator {
		return domain.ErrForbidden
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	slices.Sort(members)
	payload := map[string]any{"chat_id": chatID, "removed": true}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if i.updates != nil {
			b, e := json.Marshal(payload)
			if e != nil {
				return e
			}
			date := nowMillis()
			for _, uid := range members {
				if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "chat_removed", b); e != nil {
					return e
				}
			}
		}
		return i.groups.DeleteChat(ctx, chatID)
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		f := frame("chat_removed", payload)
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
