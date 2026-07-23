package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// isChatAdmin reports whether userID is the creator or an admin of chatID.
func (i *Interactor) isChatAdmin(ctx context.Context, chatID, userID int64) bool {
	if i.groups == nil {
		return false
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return false
	}
	return m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin
}

// GetSendAs returns the "send-as" identities userID may post under in chatID
// (Telegram channels.getSendAs). Always includes the user's personal account.
// For a group it additionally includes:
//   - the linked discussion channel, when userID is its creator/admin
//     (posting as the channel that owns the discussion group);
//   - the group itself, when userID is its creator/admin (anonymous posting).
//
// Упрощение vs tweb: Telegram различает анонимных админов отдельным флагом права;
// у нас анонимный постинг от имени группы доступен любому её админу/владельцу.
func (i *Interactor) GetSendAs(ctx context.Context, userID, chatID int64) ([]domain.SendAsPeer, error) {
	if i.groups == nil {
		return nil, domain.ErrForbidden
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}

	// Личность по умолчанию — сам пользователь.
	uc := i.userCard(ctx, userID)
	out := []domain.SendAsPeer{{PeerID: userID, Kind: "user", Title: uc.DisplayName}}

	// Дополнительные личности есть только в группах (супергруппах-обсуждениях).
	if typ, e := i.chats.ChatType(ctx, chatID); e != nil || typ != "group" {
		return out, e
	}

	var extra []int64
	// Привязанный канал-обсуждение, где юзер — админ/владелец → писать от его имени.
	if ch, e := i.groups.DiscussionChannel(ctx, chatID); e == nil && ch != 0 && i.isChatAdmin(ctx, ch, userID) {
		extra = append(extra, ch)
	}
	// Сама группа (анонимный админ) → писать от имени группы.
	if i.isChatAdmin(ctx, chatID, userID) {
		extra = append(extra, chatID)
	}
	if len(extra) == 0 {
		return out, nil
	}
	briefs, e := i.groups.ChatBriefs(ctx, extra)
	if e != nil {
		return nil, e
	}
	for _, id := range extra {
		b := briefs[id]
		kind := "channel"
		if id == chatID {
			kind = "group"
		}
		out = append(out, domain.SendAsPeer{PeerID: id, Kind: kind, Title: b.Title, PhotoID: b.PhotoID})
	}
	return out, nil
}

// canSendAs validates that userID may post as sendAsID in chatID: sendAsID must
// be one of the identities GetSendAs would offer.
func (i *Interactor) canSendAs(ctx context.Context, userID, chatID, sendAsID int64) (bool, error) {
	peers, err := i.GetSendAs(ctx, userID, chatID)
	if err != nil {
		return false, err
	}
	for _, p := range peers {
		if p.PeerID == sendAsID {
			return true, nil
		}
	}
	return false, nil
}
