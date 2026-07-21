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

// maxReplyQuoteRunes caps the length of a reply's quoted fragment (Telegram reply
// quote), bounding storage/render cost independently of the full message limit.
const maxReplyQuoteRunes = 1024

// mentionedUserIDs collects the distinct target users of a message's
// "text_mention" entities (Telegram's mention-of-a-user-without-username, which
// carries the user id inline). Plain "@username" mentions aren't resolved here —
// they don't carry a user id — so they don't feed the unread-mentions counter.
func mentionedUserIDs(entities []domain.MessageEntity) map[int64]bool {
	var out map[int64]bool
	for _, e := range entities {
		if e.Type == "text_mention" && e.UserID != 0 {
			if out == nil {
				out = map[int64]bool{}
			}
			out[e.UserID] = true
		}
	}
	return out
}

// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
func (i *Interactor) Send(ctx context.Context, in SendInput) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		// Комментарий в discussion-группе канала: подписчик пишет без вступления —
		// авто-джойн, как PostComment (tweb: sendMessage в тред вступает в группу).
		joined := false
		if in.ThreadRootID != nil && i.groups != nil {
			if disc, e := i.groups.IsDiscussionGroup(ctx, in.ChatID); e == nil && disc {
				if e := i.groups.AddMember(ctx, in.ChatID, in.SenderID, domain.RoleMember, 0); e == nil {
					joined = true
				}
			}
		}
		if !joined {
			return domain.Message{}, domain.ErrNotFound
		}
	}
	if in.Type == "" {
		in.Type = "text"
	}
	if utf8.RuneCountInString(in.Text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	in.Entities = sanitizeEntities(in.Entities)
	// Reply quote: осмыслен только при ответе; обрезаем длину, пустой — сбрасываем.
	if in.ReplyToID == nil {
		in.ReplyQuoteText, in.ReplyQuoteOffset = nil, nil
	} else if in.ReplyQuoteText != nil {
		q := *in.ReplyQuoteText
		if utf8.RuneCountInString(q) > maxReplyQuoteRunes {
			q = string([]rune(q)[:maxReplyQuoteRunes])
		}
		if q == "" {
			in.ReplyQuoteText, in.ReplyQuoteOffset = nil, nil
		} else {
			in.ReplyQuoteText = &q
		}
	}
	if in.MediaID != nil {
		ownerID, err := i.mediaAccess.OwnerID(ctx, *in.MediaID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			return domain.Message{}, domain.ErrNotFound // media absent
		case err != nil:
			return domain.Message{}, err // propagate real DB errors (don't mask as 403)
		case ownerID != in.SenderID:
			// Стикер шлётся чужим media: наборы публичны, поэтому достаточно,
			// чтобы media принадлежало какому-либо стикеру.
			if in.Type == "sticker" && i.stickers != nil {
				ok, e := i.stickers.IsStickerMedia(ctx, *in.MediaID)
				if e != nil {
					return domain.Message{}, e
				}
				if ok {
					break
				}
			}
			return domain.Message{}, domain.ErrNotFound // not owned by sender
		}
	}

	// Гео/контакт: координаты в валидном диапазоне; контакт гидрируется по
	// аккаунту (снимок имени/телефона хранится на сообщении, как в Telegram).
	var contactName, contactPhone *string
	if in.Type == "geo" {
		if in.GeoLat == nil || in.GeoLng == nil ||
			*in.GeoLat < -90 || *in.GeoLat > 90 || *in.GeoLng < -180 || *in.GeoLng > 180 {
			return domain.Message{}, domain.ErrForbidden
		}
		// Live location: период трансляции в разумных пределах (Telegram: 15 мин…8 ч).
		if in.GeoLivePeriod != nil {
			if *in.GeoLivePeriod < 60 || *in.GeoLivePeriod > 8*3600 {
				return domain.Message{}, domain.ErrForbidden
			}
		}
		if in.GeoHeading != nil && (*in.GeoHeading < 0 || *in.GeoHeading > 359) {
			in.GeoHeading = nil
		}
	} else {
		in.GeoLat, in.GeoLng = nil, nil
		in.GeoTitle, in.GeoAddress, in.GeoLivePeriod, in.GeoHeading = nil, nil, nil, nil
	}
	if in.Type == "contact" {
		if in.ContactUserID == nil {
			return domain.Message{}, domain.ErrForbidden
		}
		c := i.userCard(ctx, *in.ContactUserID)
		if c.DisplayName == "" && c.Phone == "" {
			return domain.Message{}, domain.ErrNotFound // такого аккаунта нет
		}
		name, phone := c.DisplayName, c.Phone
		contactName, contactPhone = &name, &phone
	} else {
		in.ContactUserID = nil
	}

	if in.Type == "encrypted" {
		if len(in.EncBody) == 0 {
			return domain.Message{}, domain.ErrInvalid
		}
		// Плейнтекст в секретном чате не хранится: сервер держит только шифр-блоб.
		in.Text, in.Entities = "", nil
	}

	// Эффект сообщения (наш аналог Telegram message effects): whitelist + только
	// у text/медиа-сообщений (service/encrypted/gift/… эффект не несут).
	in.Effect = sanitizeEffect(in.Effect, in.Type)

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
	var charge paidCharge  // платная группа: списание/начисление (публикуем после коммита)
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if in.ClientMsgID != "" {
			if existing, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
			} else if !errors.Is(e, domain.ErrNotFound) {
				return e
			}
		}
		// Платные сообщения (Telegram paid messages): списываем звёзды ПЕРЕД
		// вставкой, в той же транзакции (нехватка → ErrPaidRequired откатывает всё).
		c, e := i.chargePaidMessage(ctx, in)
		if e != nil {
			return e
		}
		charge = c
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
			ReplyQuoteText: in.ReplyQuoteText, ReplyQuoteOffset: in.ReplyQuoteOffset,
			MediaID: in.MediaID, ThreadRootID: in.ThreadRootID, GroupedID: groupedID, PollID: in.PollID,
			GiftID: in.GiftID, ReplyMarkup: in.ReplyMarkup,
			GeoLat: in.GeoLat, GeoLng: in.GeoLng,
			GeoTitle: in.GeoTitle, GeoAddress: in.GeoAddress,
			GeoLivePeriod: in.GeoLivePeriod, GeoHeading: in.GeoHeading,
			ContactUserID: in.ContactUserID, ContactName: contactName, ContactPhone: contactPhone,
			EncBody: in.EncBody, TTLSeconds: in.TTLSeconds, Effect: in.Effect,
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
		// Медиа-мета в live-кадр (имя/размер/mime/размеры) — как в history read
		// model, чтобы файл у получателя не рисовался заглушкой до перезагрузки.
		if msg.MediaID != nil {
			one := []domain.Message{msg}
			if e := i.hydrateMedia(ctx, one); e == nil {
				msg = one[0]
			}
		}
		members, e := i.chats.MemberIDs(ctx, in.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(members)
		// Упоминания: пользователи, явно указанные в тексте (text_mention несёт
		// user_id). @username-упоминания сервер не резолвит — их user_id нет в
		// entity (клиентский mention), поэтому в счётчик они не попадают.
		mentioned := mentionedUserIDs(msg.Entities)
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
				// Отмечаем упоминание только для реального участника (кроме автора).
				if mentioned[uid] {
					if e := i.chats.AddMention(ctx, in.ChatID, msg.ID, msg.Seq, uid); e != nil {
						return e
					}
				}
			}
		}
		recipients = members
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	// Платная отправка прошла: рассылаем обеим сторонам новый баланс звёзд.
	if charge.applied {
		i.publishBalance(ctx, in.SenderID, charge.senderBal)
		if charge.creatorID != 0 {
			i.publishBalance(ctx, charge.creatorID, charge.creatorBal)
		}
	}
	if recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			if i.publisher != nil {
				_ = i.publisher.PublishToUser(ctx, uid, f)
			}
			if i.notifier != nil && uid != in.SenderID && !in.Silent {
				i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
			}
		}
		// Отправка сообщения снимает черновик чата (Telegram-семантика).
		if in.Type != "service" {
			i.clearDraftAfterSend(ctx, in.SenderID, in.ChatID)
		}
	}
	// Серверное превью ссылки (Telegram-семантика: превью строит сервер и
	// рассылает всем): для нового текстового сообщения с http/https-ссылкой —
	// асинхронно после коммита, кадром web_page_update (сервисные/секретные
	// сообщения исключены: service не text, secret отсекается по типу чата).
	if recipients != nil && i.preview != nil && in.Type == "text" {
		if u := firstURL(msg.Text, msg.Entities); u != "" {
			go i.attachWebPreview(msg, u, recipients)
		}
	}
	// Авто-ответ бота: обычное текстовое сообщение в приватный чат с ботом.
	if in.Type == "text" && in.Text != "" {
		i.maybeBotReply(ctx, in.ChatID, in.SenderID, msg.ID, in.Text)
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
		// Прочитанное до effective снимает непрочитанные упоминания с seq<=effective
		// и пересчитывает счётчик «@» (Telegram readMentions).
		if _, e := i.chats.ClearMentions(ctx, chatID, userID, effective); e != nil {
			return e
		}
		// Открытие чата гасит и бейдж непрочитанных реакций (Telegram
		// readReactions): счётчик простой, сбрасываем в ноль при прочтении.
		if e := i.chats.ClearUnreadReactions(ctx, chatID, userID); e != nil {
			return e
		}
		// Self-destruct: запускаем таймер для секретных сообщений, которые
		// читатель только что получил (no-op для чатов без ttl).
		if e := i.msgs.SetDestructOnRead(ctx, chatID, userID, effective); e != nil {
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

// NextMention returns the seq/message id of the caller's earliest unread mention
// past afterSeq (Telegram getUnreadMentions / «jump to next @»). Not a member →
// domain.ErrNotFound; also domain.ErrNotFound when there is no such mention.
func (i *Interactor) NextMention(ctx context.Context, chatID, userID, afterSeq int64) (seq, msgID int64, err error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return 0, 0, err
	}
	if !ok {
		return 0, 0, domain.ErrNotFound
	}
	return i.chats.NextMention(ctx, chatID, userID, afterSeq)
}

// ClearHistory очищает историю чата у себя (Telegram deleteHistory just_clear):
// поднимает персональный горизонт участника до текущего максимума seq чата —
// сообщения с seq<=горизонта больше не отдаются в истории этому пользователю и
// не удаляются у других. Заодно обнуляет непрочитанное. Не член → ErrNotFound.
func (i *Interactor) ClearHistory(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.tx.WithinTx(ctx, func(ctx context.Context) error {
		maxSeq, e := i.chats.MaxSeq(ctx, chatID)
		if e != nil {
			return e
		}
		if e := i.chats.SetClearedSeq(ctx, chatID, userID, maxSeq); e != nil {
			return e
		}
		// Всё «до горизонта» считается прочитанным: read-маркер и непрочитанное
		// сдвигаются к максимуму (иначе бейдж застынет на скрытых сообщениях).
		if e := i.chats.SetRead(ctx, chatID, userID, maxSeq, 0); e != nil {
			return e
		}
		// ...включая непрочитанные упоминания — иначе «@»-бейдж застынет.
		_, e = i.chats.ClearMentions(ctx, chatID, userID, maxSeq)
		return e
	})
}

// ReadReactions explicitly clears the caller's unread-reactions badge for a chat
// (Telegram readReactions — POST /chats/{chatID}/reactions/read), without
// touching the read horizon. MarkRead clears it too; this is the "read only the
// reactions" path. Not a member → domain.ErrNotFound.
func (i *Interactor) ReadReactions(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.chats.ClearUnreadReactions(ctx, chatID, userID)
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
	case "voice", "video", "upload_file", "upload_photo", "upload_video", "upload_audio":
		// keep (upload_* — «отправляет файл/фото/…» на время аплоада, tweb sendMessageUpload*Action)
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
