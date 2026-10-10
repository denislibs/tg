package chat

import (
	"context"
	"encoding/json"
	"errors"
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
//
// Правка поста канала доходит и до его зеркала в группе обсуждения (A2-20):
// шапка треда комментариев у tweb — зеркало в хранилище группы, и сменить его
// текст может только updateEditChannelMessage ГРУППЫ (onUpdateEditMessage,
// appMessagesManager.ts:10670-10760, правит лишь сообщение пира из апдейта).
func (i *Interactor) EditMessage(ctx context.Context, chatID, msgID, userID int64, text string, entities domain.MessageEntities) (domain.Message, error) {
	cur, guest, err := i.messageForAction(ctx, chatID, msgID, userID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.Deleted {
		return domain.Message{}, domain.ErrNotFound
	}
	if err := i.canEditMessage(ctx, cur, userID); err != nil {
		return domain.Message{}, err
	}
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	entities = domain.SanitizeEntities(entities)

	broadcast := i.isBroadcast(ctx, chatID)
	// broadcast-канал: правка — одна запись журнала канала (channelBody/
	// channelPts) вместо строки в журнале каждого подписчика.
	var channelBody map[string]any
	var channelPts int64
	var msg domain.Message
	var edit, mirror *editDelivery
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
		if broadcast {
			channelBody = i.channelEditPayload(ctx, msg)
			if channelPts, e = i.appendChannelUpdate(ctx, chatID, "edit_message", channelBody); e != nil {
				return e
			}
			mirror, e = i.mirrorSync(ctx, msg, true)
			return e
		}
		var extra []int64
		if guest {
			extra = []int64{userID}
		}
		edit, e = i.fanOutEdit(ctx, msg, msg.SenderID, msg.SenderID, extra)
		return e
	})
	if err != nil {
		return domain.Message{}, err
	}
	if broadcast {
		i.publishChannelUpdate(ctx, chatID, "edit_message", channelBody, channelPts, msg.SenderID)
		i.publishEdit(ctx, mirror)
		return msg, nil
	}
	i.publishEdit(ctx, edit)
	return msg, nil
}

// messageForAction — сообщение msgID чата chatID для правки или удаления
// пользователем userID. Участник — как всегда; не участник — только гостем
// обсуждения (Ф-5 В-2) и только со СВОИМ комментарием в треде зеркала:
// комментировать он может без вступления, значит, и править или удалять своё
// (tweb canEditMessage/canDeleteMessage членства не спрашивают, им хватает
// pFlags.out). guest — путь гостя: его устройствам кадр уходит отдельно, в
// веер группы он не входит.
func (i *Interactor) messageForAction(ctx context.Context, chatID, msgID, userID int64) (domain.Message, bool, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.Message{}, false, err
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, false, err
	}
	if cur.ChatID != chatID {
		return domain.Message{}, false, domain.ErrNotFound
	}
	if ok {
		return cur, false, nil
	}
	if cur.SenderID != userID {
		return domain.Message{}, false, domain.ErrNotFound
	}
	if err := i.discussionGuestThread(ctx, chatID, userID, cur.ThreadRootID, true); err != nil {
		return domain.Message{}, false, err
	}
	return cur, true, nil
}

// editDelivery — правка сообщения группы, разложенная по журналам получателей
// в транзакции (fanOutEdit); после коммита её публикует publishEdit. nil —
// публиковать нечего.
type editDelivery struct {
	recipients   []int64
	opener       int64
	pp, ppLocked *peerPayloads
	ptsByUser    map[int64]int64
}

// ppFor — тело кадра получателю: автору (у зеркала — продавцу) — открытое,
// остальным при платном медиа — заблокированная копия (как у доставки
// new_message, fanout.go).
func (d *editDelivery) ppFor(uid int64) *peerPayloads {
	if uid != d.opener {
		return d.ppLocked
	}
	return d.pp
}

// fanOutEdit пишет edit_message сообщения msg (уже гидрированного) в журнал
// участников его чата и extra (гость обсуждения — свои устройства).
// author — у кого `out` (0 — сообщение ничьё, зеркало поста, A1-13); opener —
// кому открытая копия платного медиа. Звать в транзакции правки.
func (i *Interactor) fanOutEdit(ctx context.Context, msg domain.Message, author, opener int64, extra []int64) (*editDelivery, error) {
	members, err := i.chats.MemberIDs(ctx, msg.ChatID)
	if err != nil {
		return nil, err
	}
	for _, uid := range extra {
		if !slices.Contains(members, uid) {
			members = append(members, uid)
		}
	}
	slices.Sort(members)
	mentions, err := i.syncEditMentions(ctx, msg, members)
	if err != nil {
		return nil, err
	}
	d := &editDelivery{recipients: members, opener: opener, ptsByUser: map[int64]int64{}}
	if d.pp, err = i.newPeerPayloads(ctx, msg.ChatID, i.editMessagePayload(ctx, msg)); err != nil {
		return nil, err
	}
	// Автор строки — с ним peerPayloads сравнивает получателя, чтобы
	// поставить пер-зрительский pFlags.out (своё сообщение у автора).
	d.pp.sender = author
	d.pp.mentions = mentions
	d.ppLocked = d.pp
	if msg.PaidMediaPrice != nil {
		if d.ppLocked, err = i.newPeerPayloads(ctx, msg.ChatID, i.editMessagePayload(ctx, lockedPaidCopy(msg))); err != nil {
			return nil, err
		}
		d.ppLocked.sender = author
		d.ppLocked.mentions = mentions
	}
	if i.updates == nil {
		return d, nil
	}
	date := nowUnix()
	for _, uid := range members {
		payload, err := d.ppFor(uid).payload(uid)
		if err != nil {
			return nil, err
		}
		pts, err := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", payload)
		if err != nil {
			return nil, err
		}
		d.ptsByUser[uid] = pts
	}
	return d, nil
}

// publishEdit — живые кадры правки после коммита (пара fanOutEdit).
func (i *Interactor) publishEdit(ctx context.Context, d *editDelivery) {
	if d == nil || i.publisher == nil {
		return
	}
	for _, uid := range d.recipients {
		_ = i.publisher.PublishToUser(ctx, uid, d.ppFor(uid).framePts("edit_message", uid, d.ptsByUser[uid]))
	}
}

// mirrorSync переносит содержимое поста канала post (уже записанное) в его
// зеркало в группе обсуждения и раскладывает edit_message участникам группы.
// edited — это правка поста: текст и сущности, отметка edited_at
// (UpdateText); иначе (догоняющее превью ссылки) edited_at не трогается.
// web_page переносится всегда. Зеркала нет — nil. Звать в транзакции записи
// поста; опубликовать — publishEdit после коммита.
//
// Своей логики «пост → зеркало» у tweb нет: вывод из клиента — шапку треда
// обновляет только updateEditChannelMessage группы (спецификация Ф-5 п. 6).
// Элемент альбома правит СВОЁ зеркало (MirrorOfExactPost).
func (i *Interactor) mirrorSync(ctx context.Context, post domain.Message, edited bool) (*editDelivery, error) {
	if post.IsDiscussionMirror {
		return nil, nil
	}
	id, err := i.msgs.MirrorOfExactPost(ctx, post.ChatID, post.ID)
	if err != nil || id == 0 {
		return nil, err
	}
	var m domain.Message
	if edited {
		if m, err = i.msgs.UpdateText(ctx, id, post.Text, post.Entities); err != nil {
			return nil, err
		}
	}
	if err := i.msgs.SetWebPage(ctx, id, post.WebPage); err != nil {
		return nil, err
	}
	if m, err = i.msgs.GetByID(ctx, id); err != nil {
		return nil, err
	}
	if m, err = i.hydrateBroadcastMessage(ctx, m); err != nil {
		return nil, err
	}
	return i.fanOutEdit(ctx, m, 0, m.SenderID, nil)
}

// syncMirrorContent — содержимое поста канала изменилось ВНЕ транзакции
// правки (догоняющее превью ссылки поста — P1, Ф-5 НО-5): своя транзакция
// mirrorSync и публикация. Нет зеркала — no-op; сбой — best-effort (зеркало
// догонит следующая правка поста).
func (i *Interactor) syncMirrorContent(ctx context.Context, post domain.Message, edited bool) {
	var d *editDelivery
	if err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		var e error
		d, e = i.mirrorSync(ctx, post, edited)
		return e
	}); err != nil {
		return
	}
	i.publishEdit(ctx, d)
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
// новой отправки. Гость обсуждения (не участник, путь проверен вызывающим) —
// как обычный участник: у left tweb берёт default_banned_rights
// (hasRights.ts:29-34, 70-73).
func (i *Interactor) canSendInGroup(ctx context.Context, chatID, userID int64) bool {
	if i.groups == nil {
		return true
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return false
	}
	if err == nil && (m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin) {
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
//
// Пост канала, удалённый у всех, уносит своё зеркало в группе обсуждения
// (решение пользователя к В-1: по tweb не определить — onUpdateDeleteMessages
// пост и зеркало не связывает); комментарии треда остаются.
func (i *Interactor) DeleteMessage(ctx context.Context, chatID, msgID, userID int64, revoke bool) error {
	cur, guest, err := i.messageForAction(ctx, chatID, msgID, userID)
	if err != nil {
		return err
	}
	// Зеркало поста ничьё (A1-13): опубликовавший пост админ удаляет его у
	// всех только правом delete_messages группы, как чужое (tweb
	// canDeleteMessage смотрит на pFlags.out, которого у зеркала нет).
	if revoke && (cur.SenderID != userID || cur.IsDiscussionMirror) {
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

	// broadcast-канал, «удалить у всех»: одна запись журнала канала
	// (updateDeleteChannelMessages) вместо строки у каждого подписчика.
	channelDelete := revoke && i.isBroadcast(ctx, chatID)
	var channelBody map[string]any
	var channelPts int64
	var del *deleteDelivery
	var mirrors []*deleteDelivery
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if channelDelete {
			if e := i.msgs.SoftDelete(ctx, msgID); e != nil {
				return e
			}
			// Непрочитанное канала считается на чтении — удалённый пост выпадает
			// из него сам, хранимых счётчиков править не нужно.
			channelBody = channelDeletePayload(chatID, []int64{cur.Seq})
			p, e := i.appendChannelUpdate(ctx, chatID, "delete_message", channelBody)
			if e != nil {
				return e
			}
			channelPts = p
			mirrors, e = i.mirrorDelete(ctx, cur)
			return e
		}
		if revoke {
			var extra []int64
			if guest {
				extra = []int64{userID}
			}
			var e error
			author := cur.SenderID
			if cur.IsDiscussionMirror {
				author = 0
			}
			del, e = i.fanOutDelete(ctx, cur, author, extra)
			return e
		}
		// delete for me: hide for this user only; sync only their own devices.
		if e := i.msgs.HideForUser(ctx, userID, msgID); e != nil {
			return e
		}
		var e error
		del, e = i.logDelete(ctx, cur, []int64{userID})
		return e
	})
	if err != nil {
		return err
	}
	if channelDelete {
		i.publishChannelUpdate(ctx, chatID, "delete_message", channelBody, channelPts, 0)
		// Подписчики — только ради сброса снимка списка ниже.
		if members, e := i.chats.MemberIDs(ctx, chatID); e == nil && i.dialogsCache != nil {
			i.dialogsCache.Invalidate(ctx, members...)
		}
		for _, d := range mirrors {
			i.publishDelete(ctx, d)
		}
		return nil
	}
	i.publishDelete(ctx, del)
	// Снятый комментарий уменьшает счётчик «N комментариев» у поста канала —
	// тот же кадр, что и на приходе (см. publishPostReplies). Только у
	// удаления «у всех»: «удалить у себя» тред не трогает.
	if revoke {
		i.publishPostReplies(ctx, cur)
	}
	return nil
}

// deleteDelivery — удаление сообщения, разложенное по журналам получателей в
// транзакции; после коммита его публикует publishDelete. nil — нечего.
type deleteDelivery struct {
	addr       chatAddress
	seq        int64
	recipients []int64
	ptsByUser  map[int64]int64
}

// fanOutDelete — удаление «у всех» сообщения msg его чата: мягкое удаление,
// снятие с непрочитанного (sender — автор, у которого оно не непрочитано; 0 —
// ничьё, зеркало) и delete_message в журнал участников и extra (гость
// обсуждения — свои устройства). Звать в транзакции.
func (i *Interactor) fanOutDelete(ctx context.Context, msg domain.Message, sender int64, extra []int64) (*deleteDelivery, error) {
	if err := i.msgs.SoftDelete(ctx, msg.ID); err != nil {
		return nil, err
	}
	// Кто ещё не прочёл удалённое, тому оно больше не непрочитанное.
	// Без этого хранимый счётчик держал удалённое в бейдже до
	// следующего прочтения (tweb: сервер пересчитывает unread_count
	// сам, клиент вычитает на кадре удаления — handleDeletedMessages).
	if err := i.chats.ForgetUnread(ctx, msg.ChatID, sender, msg.Seq); err != nil {
		return nil, err
	}
	members, err := i.chats.MemberIDs(ctx, msg.ChatID)
	if err != nil {
		return nil, err
	}
	for _, uid := range extra {
		if !slices.Contains(members, uid) {
			members = append(members, uid)
		}
	}
	slices.Sort(members)
	return i.logDelete(ctx, msg, members)
}

// logDelete — delete_message сообщения msg в журналы users (ключ пира —
// глазами каждого).
func (i *Interactor) logDelete(ctx context.Context, msg domain.Message, users []int64) (*deleteDelivery, error) {
	addr, err := i.peerAddress(ctx, msg.ChatID)
	if err != nil {
		return nil, err
	}
	d := &deleteDelivery{addr: addr, seq: msg.Seq, recipients: users, ptsByUser: map[int64]int64{}}
	if i.updates == nil {
		return d, nil
	}
	date := nowUnix()
	for _, uid := range users {
		payload, err := json.Marshal(deletePayload(addr.forViewer(uid), msg.Seq))
		if err != nil {
			return nil, err
		}
		pts, err := i.updates.AppendUpdate(ctx, uid, 1, date, "delete_message", payload)
		if err != nil {
			return nil, err
		}
		d.ptsByUser[uid] = pts
	}
	return d, nil
}

// publishDelete — после коммита: сброс снимка списка получателей (удаление
// могло снять последнее сообщение диалога — top_message и порядок) и живые
// кадры.
func (i *Interactor) publishDelete(ctx context.Context, d *deleteDelivery) {
	if d == nil {
		return
	}
	if i.dialogsCache != nil {
		i.dialogsCache.Invalidate(ctx, d.recipients...)
	}
	if i.publisher == nil {
		return
	}
	for _, uid := range d.recipients {
		body := deletePayload(d.addr.forViewer(uid), d.seq)
		_ = i.publisher.PublishToUser(ctx, uid, framePts("delete_message", body, d.ptsByUser[uid]))
	}
}

// mirrorDelete — зеркала, которые уносит удалённый у всех пост канала post, в
// группе обсуждения; тред (комментарии) остаётся. Звать в транзакции удаления
// поста, после его SoftDelete.
//
// Альбом: у каждого элемента своё зеркало, а корень треда — зеркало ПЕРВОГО
// элемента, даже удалённого (MirrorByPost сознательно не смотрит на
// deleted_at, чтобы тред не раздвоился). Поэтому зеркало первого элемента
// уходит только вместе с последним живым элементом альбома, а до того держит
// тред; остальные элементы уносят свои зеркала сразу.
func (i *Interactor) mirrorDelete(ctx context.Context, post domain.Message) ([]*deleteDelivery, error) {
	posts := []int64{post.ID}
	if post.GroupedID != nil {
		album, err := i.msgs.AlbumMessages(ctx, post.ChatID, *post.GroupedID)
		if err != nil {
			return nil, err
		}
		root := post.ID
		alive := false
		for _, m := range album {
			root = min(root, m.ID)
			if m.ID != post.ID && !m.Deleted {
				alive = true
			}
		}
		switch {
		case alive && root == post.ID:
			posts = nil // корень треда держится, пока жив альбом
		case !alive && root != post.ID:
			posts = append(posts, root) // последний элемент уносит и корень
		}
	}
	var out []*deleteDelivery
	for _, pid := range posts {
		id, err := i.msgs.MirrorOfExactPost(ctx, post.ChatID, pid)
		if err != nil {
			return nil, err
		}
		if id == 0 {
			continue
		}
		m, err := i.msgs.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		d, err := i.fanOutDelete(ctx, m, 0, nil)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}
