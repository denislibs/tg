package chat

import (
	"context"
	"slices"
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
	msg, err := i.msgs.GetByID(ctx, messageID)
	if err != nil {
		return err // domain.ErrNotFound if the message is gone
	}
	if msg.ChatID != chatID {
		return domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	// Политика реакций чата: none — запрещены, some — только из списка (снятие
	// своей реакции разрешено всегда, чтобы можно было убрать устаревшую).
	if add && i.groups != nil {
		if s, e := i.groups.Settings(ctx, chatID); e == nil {
			switch s.ReactionsMode {
			case "none":
				return domain.ErrForbidden
			case "some":
				if !slices.Contains(s.ReactionsAllowed, emoji) {
					return domain.ErrBadReaction
				}
			}
		}
	}

	action := "remove"
	if add {
		action = "add"
	}

	// Build the payload once so the pts log and the live frame can never diverge.
	// It carries the diff (user_id/emoji/action) AND the absolute aggregate (counts),
	// computed in the tx after Add/Remove — the same payload goes to the log, so a
	// /sync replay is idempotent by construction. Per-recipient pts is injected on
	// top of this shared base at publish time.
	var members []int64
	var p map[string]any
	var pp *peerPayloads
	ptsByUser := map[int64]int64{} // per-recipient pts на каждый live-кадр реакции
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		unreadReactions := int64(-1)
		if add {
			if e := i.reactions.Add(ctx, messageID, userID, emoji); e != nil {
				return e
			}
			// Реакция на ЧУЖОЕ сообщение бампит счётчик непрочитанных реакций его
			// автора (Telegram unread_reactions_count) — свои реакции не считаются.
			if userID != msg.SenderID {
				n, e := i.chats.IncUnreadReactions(ctx, chatID, msg.SenderID)
				if e != nil {
					return e
				}
				unreadReactions = int64(n)
			}
		} else {
			if e := i.reactions.Remove(ctx, messageID, userID, emoji); e != nil {
				return e
			}
		}
		// Абсолютный агрегат сообщения ПОСЛЕ Add/Remove; viewerID=0 — без mine
		// (payload общий для всех получателей и лога; mine клиент выводит из
		// user_id/action локально).
		byMsg, e := i.reactions.ReactionsFor(ctx, []int64{messageID}, 0)
		if e != nil {
			return e
		}
		p = reactionPayload(msg.Seq, userID, msg.SenderID, emoji, action, byMsg[messageID])
		// unread_reactions адресован автору сообщения (клиент применяет, только если
		// author_id == me); для остальных получателей поле безвредно.
		if unreadReactions >= 0 {
			p["unread_reactions"] = unreadReactions
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		members = m
		pp, e = i.newPeerPayloads(ctx, chatID, p)
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			payload, e := pp.payload(uid)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "reaction", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		// Кадр с per-recipient pts (клиент двигает по нему курсор); payload несёт
		// абсолютные counts, так что catch-up-реплей идемпотентен by construction.
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, pp.frame("reaction", uid, map[string]any{"pts": ptsByUser[uid]}))
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
	byMsg, err := i.reactions.ReactionsFor(ctx, []int64{messageID}, userID)
	if err != nil {
		return nil, err
	}
	return byMsg[messageID], nil
}

// ReactionUsers returns who reacted to a message (with which emoji) for the
// who-reacted popup. The caller must be a member of the message's chat.
func (i *Interactor) ReactionUsers(ctx context.Context, chatID, messageID, userID int64) ([]domain.ReactionUser, error) {
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
	return i.reactions.ReactionUsers(ctx, messageID)
}

// CanAccessMedia reports whether userID may download a media object: either they
// own it, or they are a member of a chat that has a message referencing it.
// Медиа стикеров читается всеми: наборы публичны, и стикер из неустановленного
// набора должен отрисоваться у любого получателя.
func (i *Interactor) CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	ok, err := i.mediaAccess.CanAccess(ctx, userID, mediaID)
	if err != nil {
		return false, err
	}
	if ok {
		// Платное медиа: даже член чата не качает байты, пока не оплатил (автор —
		// исключение, проверяется по sender_id внутри LockedMedia).
		if i.paidMedia != nil {
			locked, e := i.paidMedia.LockedMedia(ctx, userID, mediaID)
			if e != nil {
				return false, e
			}
			if locked {
				return false, nil
			}
		}
		return true, nil
	}
	if i.stickers != nil {
		return i.stickers.IsStickerMedia(ctx, mediaID)
	}
	return false, nil
}
