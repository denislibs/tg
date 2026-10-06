package chat

import (
	"context"
	"encoding/json"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// editTimeLimit — сколько своё сообщение правится в личке (Telegram appConfig
// edit_time_limit, 48 часов). В группе и канале (peerChannel) срока нет.
const editTimeLimit = 48 * time.Hour

// EditMessage replaces the text of a message, stamps edited_at, and fans out an
// "edit_message" update to every member (so all see the new text and the
// "edited" marker). Who may edit is tweb canEditMessage (see canEditMessage).
func (i *Interactor) EditMessage(ctx context.Context, chatID, msgID, userID int64, text string, entities domain.MessageEntities) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.Message{}, domain.ErrNotFound
	}
	if err := i.canEditMessage(ctx, cur, userID); err != nil {
		return domain.Message{}, err
	}
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	entities = domain.SanitizeEntities(entities)

	var msg domain.Message
	var members []int64
	var pp, ppLocked *peerPayloads
	// Тело кадра получателю: автору — открытое, остальным при платном медиа —
	// заблокированная копия (как у доставки new_message, fanout.go).
	ppFor := func(uid int64) *peerPayloads {
		if uid != msg.SenderID {
			return ppLocked
		}
		return pp
	}
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		m, e := i.msgs.UpdateText(ctx, msgID, text, entities)
		if e != nil {
			return e
		}
		// Правка заменяет сообщение на клиенте ЦЕЛИКОМ (updateEditMessage),
		// поэтому и ответ, и кадр несут его той же формой, что история:
		// без гидрации правка подписи у фото приезжала без media, а без
		// агрегата реакций клиент их гасил.
		if msg, e = i.hydrateBroadcastMessage(ctx, m); e != nil {
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		mentions, e := i.syncEditMentions(ctx, msg, members)
		if e != nil {
			return e
		}
		pp, e = i.newPeerPayloads(ctx, chatID, i.editMessagePayload(ctx, msg))
		if e != nil {
			return e
		}
		// Автор строки — с ним peerPayloads сравнивает получателя, чтобы
		// поставить пер-зрительский pFlags.out (своё сообщение у автора).
		pp.sender = msg.SenderID
		pp.mentions = mentions
		ppLocked = pp
		if msg.PaidMediaPrice != nil {
			if ppLocked, e = i.newPeerPayloads(ctx, chatID, i.editMessagePayload(ctx, lockedPaidCopy(msg))); e != nil {
				return e
			}
			ppLocked.sender = msg.SenderID
			ppLocked.mentions = mentions
		}
		date := nowUnix()
		for _, uid := range members {
			payload, e := ppFor(uid).payload(uid)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if i.publisher != nil {
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, ppFor(uid).framePts("edit_message", uid, ptsByUser[uid]))
		}
	}
	return msg, nil
}

// canEditMessage — серверный порт tweb appMessagesManager.canEditMessage
// (:8312-8390, сервер Telegram отвечает MESSAGE_EDIT_FORBIDDEN /
// MESSAGE_AUTHOR_REQUIRED):
//   - правится только обычное сообщение (canMessageBeEdited): не служебка и не
//     лог звонка, не пересланное (иначе «Переслано от Алисы» с чужим текстом),
//     не стикер и не кружок, не секретное, не гео/контакт/опрос/розыгрыш/подарок
//     (у их медиа нет подписи — goodMedias: фото, документ, превью, чек-лист);
//     сообщение бота правит только бот (via_bot у нас не хранится);
//   - «Избранное» — всегда;
//   - канал — админ с edit_messages, автор не нужен;
//   - группа — только своё и только при праве писать (send_plain ‖ send_media);
//   - личка — только своё и не позже editTimeLimit.
func (i *Interactor) canEditMessage(ctx context.Context, m domain.Message, userID int64) error {
	if !editableContent(m) {
		return domain.ErrForbidden
	}
	if i.bots != nil {
		if bot, err := i.bots.IsBot(ctx, m.SenderID); err == nil && bot {
			return domain.ErrForbidden
		}
	}
	typ, err := i.chats.ChatType(ctx, m.ChatID)
	if err != nil {
		return err
	}
	switch typ {
	case domain.ChatTypeSaved:
		return nil
	case domain.ChatTypeChannel:
		return i.requireRight(ctx, m.ChatID, userID, domain.RightEditMessages)
	}
	if m.SenderID != userID {
		return domain.ErrForbidden
	}
	switch typ {
	case domain.ChatTypeGroup:
		if !i.canSendInGroup(ctx, m.ChatID, userID) {
			return domain.ErrForbidden
		}
	default:
		if time.Since(m.CreatedAt) > editTimeLimit {
			return domain.ErrForbidden
		}
	}
	return nil
}

// editableContent — tweb canMessageBeEdited: что у сообщения вообще можно
// править (подпись или текст).
func editableContent(m domain.Message) bool {
	if m.Action != nil || len(m.EncBody) > 0 ||
		m.FwdFromUserID != nil || m.FwdFromChatID != nil || m.FwdFromName != nil || m.IsDiscussionMirror {
		return false
	}
	if m.GeoLat != nil || m.ContactUserID != nil || m.PollID != nil || m.GiveawayID != nil || m.GiftID != nil {
		return false
	}
	switch m.Type {
	case "service", "call", "sticker", "roundVideo", "encrypted", "gift", "geo", "contact", "poll", "giveaway":
		return false
	}
	return true
}

// canSendInGroup — может ли участник писать в группу (tweb hasRights
// send_plain ‖ send_media): админ — всегда, участник — по правам чата и без
// личного запрета писать. Без медленного режима: это проверка права, а не
// новой отправки.
func (i *Interactor) canSendInGroup(ctx context.Context, chatID, userID int64) bool {
	if i.groups == nil {
		return true
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return false
	}
	if m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
		return true
	}
	s, err := i.groups.Settings(ctx, chatID)
	if err != nil {
		return false
	}
	if s.DefaultPerms&domain.PermSendMessages == 0 {
		return false
	}
	denied, err := i.restricted(ctx, chatID, userID, domain.PermSendMessages)
	return err == nil && !denied
}

// syncEditMentions пересобирает упоминания правленого сообщения: новые
// адресаты (участник, не автор) получают упоминание и +1 к счётчику, у
// снятых строка message_mentions удаляется и счётчик пересчитывается.
// Прежние упоминания остаются как были — вместе с их «прочитано».
// Возвращает итог: userID -> упоминание не прочитано (флаги кадра правки).
func (i *Interactor) syncEditMentions(ctx context.Context, msg domain.Message, members []int64) (map[int64]bool, error) {
	want, err := i.messageMentions(ctx, msg)
	if err != nil {
		return nil, err
	}
	have, err := i.chats.MessageMentions(ctx, msg.ID)
	if err != nil {
		return nil, err
	}
	for _, uid := range members {
		if uid == msg.SenderID || !want[uid] {
			continue
		}
		if _, ok := have[uid]; ok {
			continue
		}
		if err := i.chats.AddMention(ctx, msg.ChatID, msg.ID, msg.Seq, uid); err != nil {
			return nil, err
		}
		have[uid] = true
	}
	for uid := range have {
		if want[uid] {
			continue
		}
		if err := i.chats.RemoveMention(ctx, msg.ChatID, msg.ID, uid); err != nil {
			return nil, err
		}
		delete(have, uid)
	}
	return have, nil
}

// DeleteMessage removes a message. revoke=true deletes for everyone (soft-delete
// + broadcast to all members); revoke=false hides it only for the caller (their
// own devices sync via a for_me delete frame). "For everyone" requires the author.
func (i *Interactor) DeleteMessage(ctx context.Context, chatID, msgID, userID int64, revoke bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID {
		return domain.ErrNotFound
	}
	if revoke && cur.SenderID != userID {
		// In a private 1:1 either participant may delete for everyone (Telegram).
		// Elsewhere a non-author needs the group-admin delete-messages right.
		typ, e := i.chats.ChatType(ctx, chatID)
		if e != nil {
			return e
		}
		if typ != domain.ChatTypePrivate {
			if err := i.requireRight(ctx, chatID, userID, domain.RightDeleteMessages); err != nil {
				return domain.ErrForbidden
			}
		}
	}

	var members []int64
	ptsByUser := map[int64]int64{}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return err
	}
	payloadFor := func(uid int64) ([]byte, error) {
		return json.Marshal(deletePayload(addr.forViewer(uid), cur.Seq))
	}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		date := nowUnix()
		if revoke {
			if e := i.msgs.SoftDelete(ctx, msgID); e != nil {
				return e
			}
			// Кто ещё не прочёл удалённое, тому оно больше не непрочитанное.
			// Без этого хранимый счётчик держал удалённое в бейдже до
			// следующего прочтения (tweb: сервер пересчитывает unread_count
			// сам, клиент вычитает на кадре удаления — handleDeletedMessages).
			if e := i.chats.ForgetUnread(ctx, chatID, cur.SenderID, cur.Seq); e != nil {
				return e
			}
			mem, e := i.chats.MemberIDs(ctx, chatID)
			if e != nil {
				return e
			}
			slices.Sort(mem)
			members = mem
			for _, uid := range members {
				payload, e := payloadFor(uid)
				if e != nil {
					return e
				}
				pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "delete_message", payload)
				if e != nil {
					return e
				}
				ptsByUser[uid] = pts
			}
			return nil
		}
		// delete for me: hide for this user only; sync only their own devices.
		if e := i.msgs.HideForUser(ctx, userID, msgID); e != nil {
			return e
		}
		members = []int64{userID}
		payload, e := payloadFor(userID)
		if e != nil {
			return e
		}
		pts, e := i.updates.AppendUpdate(ctx, userID, 1, date, "delete_message", payload)
		if e != nil {
			return e
		}
		ptsByUser[userID] = pts
		return nil
	})
	if err != nil {
		return err
	}
	// Удаление могло снять последнее сообщение диалога (top_message и порядок
	// списка) — снимок списка чатов затронутых пользователей сбрасываем, иначе
	// /chats до истечения TTL показывал бы последним удалённое.
	if i.dialogsCache != nil {
		i.dialogsCache.Invalidate(ctx, members...)
	}
	if i.publisher != nil {
		for _, uid := range members {
			body := deletePayload(addr.forViewer(uid), cur.Seq)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("delete_message", body, ptsByUser[uid]))
		}
	}
	// Снятый комментарий уменьшает счётчик «N комментариев» у поста канала —
	// тот же кадр, что и на приходе (см. publishPostReplies). Только у
	// удаления «у всех»: «удалить у себя» тред не трогает.
	if revoke {
		i.publishPostReplies(ctx, cur)
	}
	return nil
}
