package chat

import (
	"context"
	"encoding/json"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// React adds or removes a user's reaction to a message in a chat, then appends a
// reaction update to every member and publishes it live. The chatID must match
// the message's chat and the user must be a member.
func (i *Interactor) React(ctx context.Context, chatID, messageID, userID int64, emoji string, add bool) error {
	if emoji == "" || len(emoji) > maxEmojiLen || !utf8.ValidString(emoji) {
		return domain.ErrBadReaction
	}
	msgChat, err := i.msgs.MessageChatID(ctx, messageID)
	if err != nil {
		return err // domain.ErrNotFound if the message is gone
	}
	if msgChat != chatID {
		return domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}

	// Build the payload once so the pts log and the live frame can never diverge.
	action := "remove"
	if add {
		action = "add"
	}
	p := reactionPayload(chatID, messageID, userID, emoji, action)

	var members []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if add {
			if e := i.reactions.Add(ctx, messageID, userID, emoji); e != nil {
				return e
			}
		} else {
			if e := i.reactions.Remove(ctx, messageID, userID, emoji); e != nil {
				return e
			}
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		members = m
		payload, e := json.Marshal(p)
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "reaction", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		f := frame("reaction", p)
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}

// ReactionsOf returns aggregated reaction counts for a message the user can see.
func (i *Interactor) ReactionsOf(ctx context.Context, chatID, messageID, userID int64) ([]domain.ReactionCount, error) {
	msgChat, err := i.msgs.MessageChatID(ctx, messageID)
	if err != nil {
		return nil, err
	}
	if msgChat != chatID {
		return nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.reactions.ReactionsFor(ctx, messageID)
}

// CanAccessMedia reports whether userID may download a media object: either they
// own it, or they are a member of a chat that has a message referencing it.
func (i *Interactor) CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	return i.mediaAccess.CanAccess(ctx, userID, mediaID)
}
