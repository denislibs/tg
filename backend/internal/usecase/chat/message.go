package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxMessageRunes caps message/caption text length (Telegram's message limit),
// bounding storage, bandwidth, and client render cost.
const maxMessageRunes = 4096

// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
func (i *Interactor) Send(ctx context.Context, in SendInput) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	if in.Type == "" {
		in.Type = "text"
	}
	if utf8.RuneCountInString(in.Text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	in.Entities = sanitizeEntities(in.Entities)
	if in.MediaID != nil {
		ownerID, err := i.mediaAccess.OwnerID(ctx, *in.MediaID)
		if errors.Is(err, domain.ErrNotFound) || (err == nil && ownerID != in.SenderID) {
			return domain.Message{}, domain.ErrNotFound // media absent or not owned by sender
		}
		if err != nil {
			return domain.Message{}, err // propagate real DB errors (don't mask as 403)
		}
	}

	// Групповые дефолтные разрешения + slowmode (сервисные сообщения генерирует
	// сам сервер — их не ограничиваем).
	if in.Type != "service" {
		if err := i.checkSendAllowed(ctx, in); err != nil {
			return domain.Message{}, err
		}
		// Приватный чат: настройки получателя «кто может отправлять мне
		// сообщения / голосовые» + чёрный список.
		if err := i.checkPrivateSendPrivacy(ctx, in); err != nil {
			return domain.Message{}, err
		}
	}

	// Sender's short name rides along in the new_message payload so clients can
	// prefix group chat-list previews ("Имя: …") without an extra lookup.
	senderName := i.userCard(ctx, in.SenderID).ShortName()

	var msg domain.Message
	var recipients []int64 // non-nil only when a NEW message was inserted
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if in.ClientMsgID != "" {
			if existing, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
			} else if !errors.Is(e, domain.ErrNotFound) {
				return e
			}
		}
		seq, e := i.msgs.NextSeq(ctx, in.ChatID)
		if e != nil {
			return e
		}
		var cmid *string
		if in.ClientMsgID != "" {
			cmid = &in.ClientMsgID
		}
		var groupedID *string
		if in.GroupedID != "" && len(in.GroupedID) <= 32 {
			groupedID = &in.GroupedID
		}
		msg, e = i.msgs.Insert(ctx, domain.Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, Entities: in.Entities, ReplyToID: in.ReplyToID, ClientMsgID: cmid,
			MediaID: in.MediaID, ThreadRootID: in.ThreadRootID, GroupedID: groupedID, PollID: in.PollID,
			// Voice/round content starts "unlistened" (Telegram media_unread).
			MediaUnread: in.Type == "voice" || in.Type == "roundVideo",
		})
		if e != nil {
			return e
		}
		msg.SenderName = senderName
		// Сообщение-опрос несёт своё представление прямо в new_message-фрейме
		// (свежий опрос без голосов одинаков для всех получателей).
		if msg.PollID != nil && i.polls != nil {
			if info, e2 := i.pollInfoFor(ctx, *msg.PollID, 0); e2 == nil {
				msg.Poll = &info
			}
		}
		members, e := i.chats.MemberIDs(ctx, in.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(members)
		payload, e := json.Marshal(messageUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "new_message", payload); e != nil {
				return e
			}
			if uid != in.SenderID {
				if e := i.chats.IncUnread(ctx, in.ChatID, uid); e != nil {
					return e
				}
			}
		}
		recipients = members
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			if i.publisher != nil {
				_ = i.publisher.PublishToUser(ctx, uid, f)
			}
			if i.notifier != nil && uid != in.SenderID {
				i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
			}
		}
		// Отправка сообщения снимает черновик чата (Telegram-семантика).
		if in.Type != "service" {
			i.clearDraftAfterSend(ctx, in.SenderID, in.ChatID)
		}
	}
	return msg, nil
}

// MarkRead advances a member's last_read_seq, recomputes unread, and appends a
// read update to all members (so senders see read receipts and other devices sync).
func (i *Interactor) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	var members []int64
	var effective int64
	var advanced bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		cur, e := i.chats.CurrentReadSeq(ctx, chatID, userID)
		if e != nil {
			return e
		}
		effective = upToSeq
		if cur > effective {
			effective = cur
		}
		advanced = effective > cur
		unread, e := i.msgs.CountUnread(ctx, chatID, userID, effective)
		if e != nil {
			return e
		}
		if e := i.chats.SetRead(ctx, chatID, userID, effective, unread); e != nil {
			return e
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		payload, e := json.Marshal(map[string]any{
			"chat_id": chatID, "user_id": userID, "up_to_seq": effective,
		})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "read", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Only fan out when the read marker actually advanced — a no-op re-read
	// must not spam every member with a redundant read frame.
	if i.publisher != nil && advanced {
		f := frame("read", map[string]any{"chat_id": chatID, "user_id": userID, "up_to_seq": effective})
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	// Channel posts track a per-viewer view count: register this reader's view of
	// every post up to the read marker (deduped, self-gated to channels). Only on a
	// real advance — a no-op re-read shouldn't re-run it. Best-effort: views are
	// approximate and must never fail the read.
	if advanced {
		_ = i.msgs.RegisterChannelViews(ctx, chatID, userID, effective)
	}
	return nil
}

// ReadMedia clears a voice/round message's media_unread flag when its recipient
// plays it (tweb messages.readMessageContents) and fans out a media_read frame
// to every member — the sender's "unlistened" dot goes out live. Idempotent:
// repeat plays and own messages publish nothing.
func (i *Interactor) ReadMedia(ctx context.Context, chatID, userID, msgID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if msg.ChatID != chatID || msg.SenderID == userID || !msg.MediaUnread {
		return nil
	}
	var members []int64
	var cleared bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		c, e := i.msgs.ClearMediaUnread(ctx, msgID)
		if e != nil || !c {
			return e
		}
		cleared = true
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		payload, e := json.Marshal(map[string]any{"chat_id": chatID, "msg_id": msgID})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "media_read", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if cleared && i.publisher != nil {
		f := frame("media_read", map[string]any{"chat_id": chatID, "msg_id": msgID})
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}

// checkPrivateSendPrivacy применяет к отправке в приватный чат правила
// получателя «кто может отправлять мне сообщения/голосовые» и чёрный список
// (заблокированный отправитель получает message_error reason=privacy).
func (i *Interactor) checkPrivateSendPrivacy(ctx context.Context, in SendInput) error {
	if i.privacy == nil {
		return nil
	}
	typ, err := i.chats.ChatType(ctx, in.ChatID)
	if err != nil {
		return err
	}
	if typ != "private" {
		return nil
	}
	members, err := i.chats.MemberIDs(ctx, in.ChatID)
	if err != nil {
		return err
	}
	var peer int64
	for _, id := range members {
		if id != in.SenderID {
			peer = id
		}
	}
	if peer == 0 { // «Избранное»/self — ограничений нет
		return nil
	}
	keys := []domain.PrivacyKey{domain.PrivacyMessages}
	if in.Type == "voice" || in.Type == "roundVideo" {
		keys = append(keys, domain.PrivacyVoices)
	}
	for _, key := range keys {
		ok, err := i.privacy.Check(ctx, peer, in.SenderID, key)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrPrivacy
		}
	}
	return nil
}

// RelayCall forwards a 1:1 call signaling frame (call_request / call_accept /
// call_decline / call_end / call_signal) to every device of the callee. The
// server only relays — media is DTLS-encrypted peer-to-peer, so payloads stay
// opaque. The sender id is stamped server-side so it can't be spoofed.
// Ephemeral like Typing: no DB write, no-op without a publisher.
// call_request дополнительно гейтится правилом «кто может мне звонить» +
// чёрным списком: запрещённый вызов сразу отвечает инициатору call_decline
// reason=privacy (адресат ничего не видит, как в Telegram).
func (i *Interactor) RelayCall(ctx context.Context, frameType string, fromUserID, toUserID int64, data map[string]any) error {
	if i.publisher == nil || toUserID == 0 || toUserID == fromUserID {
		return nil
	}
	if frameType == "call_request" && i.privacy != nil {
		ok, err := i.privacy.Check(ctx, toUserID, fromUserID, domain.PrivacyCalls)
		if err != nil {
			return err
		}
		if !ok {
			decline := frame("call_decline", map[string]any{"from_user_id": toUserID, "reason": "privacy"})
			return i.publisher.PublishToUser(ctx, fromUserID, decline)
		}
	}
	if data == nil {
		data = map[string]any{}
	}
	data["from_user_id"] = fromUserID
	return i.publisher.PublishToUser(ctx, toUserID, frame(frameType, data))
}

// Typing publishes an ephemeral typing indicator to the other chat members.
// No DB write. No-op if the user isn't a member or no publisher is attached.
func (i *Interactor) Typing(ctx context.Context, chatID, userID int64, action string) error {
	if i.publisher == nil {
		return nil
	}
	switch action {
	case "voice", "video":
		// keep
	default:
		action = "typing"
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil || !ok {
		return err
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	f := frame("typing", map[string]any{"chat_id": chatID, "user_id": userID, "action": action})
	for _, uid := range members {
		if uid != userID {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
