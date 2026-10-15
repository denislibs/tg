package chat

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// PinOpts — флаги messages.updatePinnedMessage (tweb unpinMessage.ts :70, :94).
type PinOpts struct {
	// Silent — без звука: служебка «закрепил» уходит тихо (Send.Silent).
	Silent bool
	// OneSide — закрепить только у себя (pm_oneside): действует лишь в личке;
	// собеседнику кадр и служебка не уходят.
	OneSide bool
}

// SetPin pins or unpins a message in a chat and fans out a pin_message update to
// all members (so everyone's pinned bar updates live). Gated by tweb hasRights
// 'pin_messages' (requirePin).
//
// Ответ — Updates с updatePinnedMessages (пир глазами актора, pts актора) либо
// updatePinnedChannelMessages (pts канала): так отвечает messages.updatePinnedMessage
// (tweb appMessagesManager.ts:6838-6856 → processUpdateMessage).
//
// pm_oneside в личке — закреп только у себя: запись в pinned_messages_oneside,
// строка pin_message только актору, служебки нет. Снятие закрепа в личке снимает
// и общий, и свой «только у себя»; если общего не было — кадр только актору.
func (i *Interactor) SetPin(ctx context.Context, chatID, msgID, userID int64, pin bool, opts PinOpts) (domain.UpdatesReal, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.UpdatesReal{}, err
	}
	if !ok {
		return domain.UpdatesReal{}, domain.ErrNotFound
	}
	if err := i.requirePin(ctx, chatID, userID); err != nil {
		return domain.UpdatesReal{}, err
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.UpdatesReal{}, err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.UpdatesReal{}, domain.ErrNotFound
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return domain.UpdatesReal{}, err
	}

	// broadcast-канал: закреп — одна запись журнала канала
	// (updatePinnedChannelMessages) вместо строки у каждого подписчика.
	broadcast := typ == domain.ChatTypeChannel
	oneSide := pin && opts.OneSide && typ == domain.ChatTypePrivate
	var channelBody map[string]any
	var channelPts int64
	var members []int64
	var pinAddr chatAddress
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		sharedGone := true
		switch {
		case oneSide:
			if e := i.chats.PinMessageOneSide(ctx, chatID, msgID, userID); e != nil {
				return e
			}
		case pin:
			if e := i.chats.PinMessage(ctx, chatID, msgID, userID); e != nil {
				return e
			}
		default:
			shared, e := i.chats.UnpinMessage(ctx, chatID, msgID, userID)
			if e != nil {
				return e
			}
			sharedGone = shared
		}
		if broadcast {
			channelBody = channelPinPayload(chatID, []int64{cur.Seq}, pin)
			p, e := i.appendChannelUpdate(ctx, chatID, "pin_message", channelBody)
			channelPts = p
			return e
		}
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		pinAddr = addr
		// Только актору: закреп «только у себя» и снятие закрепа, которого у
		// собеседника не было (был лишь свой «только у себя»).
		if oneSide || (typ == domain.ChatTypePrivate && !pin && !sharedGone) {
			members = []int64{userID}
		} else {
			mem, e := i.chats.MemberIDs(ctx, chatID)
			if e != nil {
				return e
			}
			slices.Sort(mem)
			members = mem
		}
		date := nowUnix()
		for _, uid := range members {
			payload, e := json.Marshal(pinPayload(addr.forViewer(uid), []int64{cur.Seq}, pin))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "pin_message", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return domain.UpdatesReal{}, err
	}
	if broadcast {
		i.publishChannelUpdate(ctx, chatID, "pin_message", channelBody, channelPts, 0)
	}
	// В канале members пуст: закреп строку списка подписчиков не меняет.
	i.invalidateDialogs(ctx, members...)
	if i.publisher != nil && !broadcast {
		for _, uid := range members {
			body := pinPayload(pinAddr.forViewer(uid), []int64{cur.Seq}, pin)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("pin_message", body, ptsByUser[uid]))
		}
	}
	// Закрепление оставляет след в ленте (tweb messageActionPinMessage). У
	// открепления парного экшена в Telegram нет (в lang.ts только
	// Chat.Service.Group.UpdatedPinnedMessage/ActionPinnedNoText, ключа «открепил»
	// не существует) — снимаем закрепление молча. Закреп «только у себя»
	// служебки не оставляет: собеседнику сообщать не о чем.
	if pin && !oneSide {
		// messageActionPinMessage НЕ НЕСЁТ НИЧЕГО: ни адреса цели, ни превью.
		// Цель — reply_to самого служебного сообщения, превью строит клиент той
		// же wrapMessageForReply, что рисует цитату ответа и строку списка
		// чатов. Прежде сервер клал в действие msg_id, msg_type, «имя» медиа и
		// текст, обрезанный до 100 символов, — то есть склеивал за клиента
		// фразу целиком.
		target := cur.Seq
		_, _ = i.Send(ctx, SendInput{
			ChatID: chatID, SenderID: userID,
			Action: domain.NewMessageActionPinMessage(), ReplyToID: &target,
			Silent: opts.Silent,
		})
	}
	var upd domain.Update
	if broadcast {
		upd = domain.NewUpdatePinnedChannelMessages(chatID, []int64{cur.Seq}, pin, channelPts)
	} else {
		upd = domain.NewUpdatePinnedMessages(domain.NewPeer(pinAddr.forViewer(userID)), []int64{cur.Seq}, pin, ptsByUser[userID])
	}
	return domain.NewUpdates([]domain.Update{upd}, nil, time.Now()), nil
}

// UnpinAll — «Открепить все» (messages.unpinAllMessages, tweb
// appMessagesManager.ts:6858-6893): снимает все общие закрепы чата (с
// topMsgSeq — только закрепы этого треда) и закрепы «только у себя» актора.
//
// Личка и группа: каждому участнику одна строка pin_message со всеми снятыми
// номерами без бита pinned; закрепы «только у себя» — только актору. Ответ —
// affectedHistory с курсором актора: pts его последней строки и их число.
// Broadcast-канал: одна запись журнала канала; пер-юзерного курсора она не
// двигает, поэтому ответ — текущий pts актора с pts_count 0 (applyLocalPts даёт
// no-op, канальный курсор придёт канальным кадром). Нечего снимать — тот же
// ответ с pts_count 0. offset всегда 0: операция атомарна.
func (i *Interactor) UnpinAll(ctx context.Context, chatID, userID int64, topMsgSeq *int64) (domain.MessagesAffectedHistory, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.MessagesAffectedHistory{}, err
	}
	if !ok {
		return domain.MessagesAffectedHistory{}, domain.ErrNotFound
	}
	if err := i.requirePin(ctx, chatID, userID); err != nil {
		return domain.MessagesAffectedHistory{}, err
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return domain.MessagesAffectedHistory{}, err
	}
	broadcast := typ == domain.ChatTypeChannel
	root := i.resolveThreadRootForQuery(ctx, chatID, topMsgSeq)

	var channelBody map[string]any
	var channelPts int64
	var addr chatAddress
	var members []int64
	bodies := map[int64]map[string]any{}
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		shared, oneSide, e := i.chats.UnpinAll(ctx, chatID, userID, root)
		if e != nil {
			return e
		}
		if broadcast {
			if len(shared) == 0 {
				return nil
			}
			channelBody = channelPinPayload(chatID, shared, false)
			channelPts, e = i.appendChannelUpdate(ctx, chatID, "pin_message", channelBody)
			return e
		}
		if addr, e = i.peerAddress(ctx, chatID); e != nil {
			return e
		}
		if members, e = i.chats.MemberIDs(ctx, chatID); e != nil {
			return e
		}
		slices.Sort(members)
		date := nowUnix()
		for _, uid := range members {
			seqs := shared
			if uid == userID && len(oneSide) > 0 {
				seqs = slices.Concat(shared, oneSide)
				slices.Sort(seqs)
				seqs = slices.Compact(seqs)
			}
			if len(seqs) == 0 {
				continue
			}
			body := pinPayload(addr.forViewer(uid), seqs, false)
			payload, e := json.Marshal(body)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "pin_message", payload)
			if e != nil {
				return e
			}
			bodies[uid] = body
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return domain.MessagesAffectedHistory{}, err
	}
	if channelBody != nil {
		i.publishChannelUpdate(ctx, chatID, "pin_message", channelBody, channelPts, 0)
	}
	i.invalidateDialogs(ctx, members...)
	if i.publisher != nil {
		for _, uid := range members {
			if body, ok := bodies[uid]; ok {
				_ = i.publisher.PublishToUser(ctx, uid, framePts("pin_message", body, ptsByUser[uid]))
			}
		}
	}
	if pts, ok := ptsByUser[userID]; ok {
		return domain.NewMessagesAffectedHistory(pts, 1), nil
	}
	st, err := i.updates.GetUserState(ctx, userID)
	if err != nil {
		return domain.MessagesAffectedHistory{}, err
	}
	return domain.NewMessagesAffectedHistory(st.Pts, 0), nil
}

// ListPins returns a chat's pinned messages (newest pin first) for a member:
// общие закрепы и его «только у себя», только то, что он видит.
func (i *Interactor) ListPins(ctx context.Context, chatID, userID int64) ([]domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.chats.ListPins(ctx, chatID, userID)
}

// Порог «кто прочитал» (tweb appConfig chat_read_mark_size_threshold и
// chat_read_mark_expire_period; своего appConfig у нас нет — значения
// Telegram по умолчанию).
const (
	chatReadMarkSizeThreshold = 100
	chatReadMarkExpirePeriod  = 7 * 24 * time.Hour
)

// MessageViewers returns the ids of members who have seen the message (read up to
// its seq), excluding its sender.
//
// Кому — правило tweb canViewMessageReadParticipants
// (appMessagesManager.ts:12314-12340), которое сервер Telegram и держит:
// только АВТОРУ сообщения, не в вещательном канале, в чате не больше
// chatReadMarkSizeThreshold участников и не позже chatReadMarkExpirePeriod
// после отправки. Иначе domain.ErrForbidden: чужое «кто прочитал» и читатели
// постов канала (тот же состав подписчиков) не отдаются.
func (i *Interactor) MessageViewers(ctx context.Context, chatID, msgID, userID int64) ([]int64, error) {
	a, err := i.chats.Access(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !a.Member {
		return nil, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return nil, err
	}
	if msg.ChatID != chatID {
		return nil, domain.ErrNotFound
	}
	if msg.SenderID != userID || a.Type == domain.ChatTypeChannel || time.Since(msg.CreatedAt) >= chatReadMarkExpirePeriod {
		return nil, domain.ErrForbidden
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if len(members) > chatReadMarkSizeThreshold {
		return nil, domain.ErrForbidden
	}
	return i.chats.Viewers(ctx, chatID, msg.Seq, msg.SenderID)
}

// requirePin — порт tweb hasRights 'pin_messages': в канале закрепляет админ с
// pin_messages ИЛИ post_messages (редактор прав канала бита pin_messages не
// предлагает вовсе, так что без второго условия закреплял бы один владелец);
// в группе — дефолт чата ∧ ¬личный запрет у участника, бит у админа. Личный
// чат прав не знает (i.groups == nil — без гейта).
func (i *Interactor) requirePin(ctx context.Context, chatID, userID int64) error {
	if i.groups == nil {
		return nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ != domain.ChatTypeChannel {
		if typ != domain.ChatTypeGroup {
			return nil
		}
		return i.requirePermOrRight(ctx, chatID, userID, domain.PermPinMessages, domain.RightPinMessages)
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden
	}
	if domain.HasRight(m.Role, m.Rights, domain.RightPinMessages) || domain.HasRight(m.Role, m.Rights, domain.RightPostMessages) {
		return nil
	}
	return domain.ErrForbidden
}
