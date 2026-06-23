package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// ErrBadReaction is returned for an empty or oversized emoji.
var ErrBadReaction = errors.New("invalid reaction")

const maxEmojiLen = 32

// reactions is a package-level repo instance (stateless, like the others).
var reactionsRepo = NewReactionsRepo()

// React adds or removes a user's reaction to a message in a chat, then appends a
// reaction update to every member and publishes it live. The chatID must match
// the message's chat and the user must be a member.
func (s *Service) React(ctx context.Context, chatID, messageID, userID int64, emoji string, add bool) error {
	if emoji == "" || len(emoji) > maxEmojiLen || !utf8.ValidString(emoji) {
		return ErrBadReaction
	}
	msgChat, err := s.msgs.GetMessageMeta(ctx, s.pool, messageID)
	if err != nil {
		return err // ErrNotFound if the message is gone
	}
	if msgChat != chatID {
		return ErrNotFound
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	var members []int64
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if add {
			if e := reactionsRepo.Add(ctx, tx, messageID, userID, emoji); e != nil {
				return e
			}
		} else {
			if e := reactionsRepo.Remove(ctx, tx, messageID, userID, emoji); e != nil {
				return e
			}
		}
		m, e := s.chats.MemberIDs(ctx, tx, chatID)
		if e != nil {
			return e
		}
		members = m
		action := "remove"
		if add {
			action = "add"
		}
		payload, e := json.Marshal(reactionPayload(chatID, messageID, userID, emoji, action))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "reaction", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.publisher != nil {
		action := "remove"
		if add {
			action = "add"
		}
		f := frame("reaction", reactionPayload(chatID, messageID, userID, emoji, action))
		for _, uid := range members {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}

// ReactionsOf returns aggregated reaction counts for a message the user can see.
func (s *Service) ReactionsOf(ctx context.Context, chatID, messageID, userID int64) ([]ReactionCount, error) {
	msgChat, err := s.msgs.GetMessageMeta(ctx, s.pool, messageID)
	if err != nil {
		return nil, err
	}
	if msgChat != chatID {
		return nil, ErrNotFound
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return reactionsRepo.ReactionsFor(ctx, s.pool, messageID)
}

func reactionPayload(chatID, messageID, userID int64, emoji, action string) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": messageID, "user_id": userID,
		"emoji": emoji, "action": action,
	}
}
