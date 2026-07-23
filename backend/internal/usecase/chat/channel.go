package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// CreateChannel creates a channel and adds the creator as RoleCreator with all rights.
func (i *Interactor) CreateChannel(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "channel", title, about, username, isPublic, creatorID)
		if e != nil {
			return e
		}
		chatID = id
		return i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights)
	})
	return chatID, err
}

// PostToChannel inserts a channel message and delivers it O(1): bump channel_pts,
// append a channel_update, then PUBLISH once to channel:{id}. No per-subscriber fan-out.
func (i *Interactor) PostToChannel(ctx context.Context, channelID, actorID int64, text, clientMsgID string) (domain.Message, error) {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightPostMessages); err != nil {
		return domain.Message{}, err
	}
	var cmid *string
	if clientMsgID != "" {
		cmid = &clientMsgID
	}
	var msg domain.Message
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		seq, e := i.msgs.NextSeq(ctx, channelID)
		if e != nil {
			return e
		}
		m, e := i.msgs.Insert(ctx, domain.Message{
			ChatID: channelID, Seq: seq, SenderID: actorID, Type: "text", Text: text, ClientMsgID: cmid,
		})
		if e != nil {
			return e
		}
		msg = m
		payload, _ := json.Marshal(map[string]any{
			"chat_id": channelID, "msg_id": m.ID, "seq": m.Seq, "sender_id": actorID,
			"type": "text", "text": text, "media_id": nil, "created_at": m.CreatedAt,
		})
		_, e = i.channels.AppendUpdate(ctx, channelID, payload)
		return e
	})
	if err != nil {
		return domain.Message{}, err
	}
	// publish once after commit
	if i.chPub != nil {
		frame, _ := json.Marshal(map[string]any{"t": "new_message", "d": map[string]any{
			"chat_id": channelID, "msg_id": msg.ID, "seq": msg.Seq, "sender_id": actorID,
			"type": "text", "text": text, "media_id": nil, "created_at": msg.CreatedAt,
		}})
		_ = i.chPub.PublishToChannel(ctx, channelID, frame)
	}
	return msg, nil
}

// GetChannelDifference returns channel updates newer than sincePts. Membership-gated.
func (i *Interactor) GetChannelDifference(ctx context.Context, channelID, userID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	ok, err := i.chats.IsMember(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrForbidden
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return i.channels.UpdatesSince(ctx, channelID, sincePts, limit)
}

// JoinPublic subscribes userID to a public chat resolved by username.
func (i *Interactor) JoinPublic(ctx context.Context, username string, userID int64) error {
	id, err := i.search.PublicChatByUsername(ctx, username)
	if err != nil {
		return err
	}
	return i.groups.AddMember(ctx, id, userID, domain.RoleSubscriber, 0)
}

// SearchChats returns public chats matching q.
func (i *Interactor) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return i.search.SearchChats(ctx, q, limit)
}

// SimilarChannels рекомендует публичные каналы, похожие на chatID по аудитории.
func (i *Interactor) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]domain.ChatCard, int, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	return i.search.SimilarChannels(ctx, chatID, viewerID, limit)
}

// SearchUsers returns users matching q.
func (i *Interactor) SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return i.search.SearchUsers(ctx, q, limit)
}
