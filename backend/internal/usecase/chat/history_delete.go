package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// deleteFrameChunk — сколько номеров несёт один кадр удаления при очистке
// истории и удалении диалога: оригинал отдаёт историю пачками (affectedHistory
// с offset, по кадру updateDeleteMessages на пачку), и кадр без предела на
// большом чате вышел бы неподъёмным.
const deleteFrameChunk = 1000

// ClearHistory очищает историю чата у себя (Telegram messages.deleteHistory
// just_clear): поднимает персональный горизонт участника до текущего максимума
// seq чата — сообщения с seq<=горизонта больше не отдаются ему и не удаляются
// у других. Непрочитанное, «@» и ❤ на них гаснут.
//
// Его устройствам — через журнал (A2-08): кадры удаления пропавших у него
// номеров и прочтение входящих (still_unread_count = 0), — второе устройство
// очищает окно и строку живьём, а не держит историю и бейджи до перезагрузки
// (оригинал: другие сессии получают updateDeleteMessages). Не член →
// domain.ErrNotFound.
func (i *Interactor) ClearHistory(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	var deliver func(context.Context)
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		maxSeq, e := i.chats.MaxSeq(ctx, chatID)
		if e != nil {
			return e
		}
		gone, e := i.clearForUser(ctx, chatID, userID, maxSeq)
		if e != nil {
			return e
		}
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		peer := addr.forViewer(userID)
		frames := append(deleteChunks(peer, gone), ownFrame{"read", readPayload(peer, maxSeq, 0, true)})
		deliver, e = i.journalOwn(ctx, userID, frames)
		return e
	})
	if err != nil {
		return err
	}
	i.invalidateDialogs(ctx, userID)
	deliver(ctx)
	return nil
}

// DeleteDialog — «Удалить чат» в личке и «Избранном» (Telegram
// messages.deleteHistory just_clear=false; tweb deleteDialog.ts → flushHistory).
// История очищается у удалившего, строка диалога пропадает из его списка, но
// участие остаётся: следующее сообщение — его или собеседника — идёт в тот же
// чат и возвращает строку (fanOutNewMessage → ShowDialogs). Собеседник
// служебки не получает. revoke — удалить и у собеседника: сообщения до
// горизонта удаляются у всех, его счётчики пересчитываются, его устройствам
// уходят кадры удаления.
//
// Группа и канал так не удаляются (выход — RemoveMember, удаление для всех —
// DeleteGroup): domain.ErrInvalid.
func (i *Interactor) DeleteDialog(ctx context.Context, chatID, userID int64, revoke bool) error {
	a, err := i.chats.Access(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !a.Member {
		return domain.ErrNotFound
	}
	if a.Type != domain.ChatTypePrivate && a.Type != domain.ChatTypeSaved {
		return domain.ErrInvalid
	}
	revoke = revoke && a.Type == domain.ChatTypePrivate
	var deliver []func(context.Context)
	var touched []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		members, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		maxSeq, e := i.chats.MaxSeq(ctx, chatID)
		if e != nil {
			return e
		}
		// Собеседнику — до удаления у всех: какие номера пропадут ИМЕННО у него.
		others := map[int64][]int64{}
		if revoke {
			for _, uid := range members {
				if uid == userID {
					continue
				}
				seqs, e := i.chats.VisibleSeqsUpTo(ctx, chatID, uid, maxSeq)
				if e != nil {
					return e
				}
				others[uid] = seqs
			}
		}
		gone, e := i.clearForUser(ctx, chatID, userID, maxSeq)
		if e != nil {
			return e
		}
		if e := i.chats.SetDialogHidden(ctx, chatID, userID, true); e != nil {
			return e
		}
		peer := addr.forViewer(userID)
		// Строка пропадает со всех устройств удалившего — тем же кадром, что
		// у выхода из группы, адресом пира ГЛАЗАМИ удалившего.
		frames := append(deleteChunks(peer, gone), ownFrame{"chat_removed",
			map[string]any{"_": domain.UpdateChatRemovedTag, "peer": domain.NewPeer(peer)}})
		d, e := i.journalOwn(ctx, userID, frames)
		if e != nil {
			return e
		}
		deliver = append(deliver, d)
		touched = append(touched, userID)
		if !revoke {
			return nil
		}
		if e := i.msgs.SoftDeleteUpTo(ctx, chatID, maxSeq); e != nil {
			return e
		}
		// У собеседника история пуста — пустую строку оригинал из списка
		// выбрасывает (tweb storages/dialogs.ts dropDialogWithEvent: диалог без
		// top_message), поэтому прячется и его строка; следующее сообщение
		// вернёт её обоим (ShowDialogs).
		for uid, seqs := range others {
			if e := i.chats.SetDialogHidden(ctx, chatID, uid, true); e != nil {
				return e
			}
			upeer := addr.forViewer(uid)
			frames := append(deleteChunks(upeer, seqs), ownFrame{"chat_removed",
				map[string]any{"_": domain.UpdateChatRemovedTag, "peer": domain.NewPeer(upeer)}})
			d, e := i.journalOwn(ctx, uid, frames)
			if e != nil {
				return e
			}
			deliver = append(deliver, d)
			touched = append(touched, uid)
		}
		return i.chats.RecountCounters(ctx, chatID, members)
	})
	if err != nil {
		return err
	}
	i.invalidateDialogs(ctx, touched...)
	for _, d := range deliver {
		d(ctx)
	}
	return nil
}

// clearForUser — очистка истории у одного участника до горизонта maxSeq
// (один на всю операцию: сообщение, пришедшее посреди неё, не должно у
// удалившего исчезнуть, а у собеседника остаться) внутри транзакции
// вызывающего: горизонт очистки и прочтения — maxSeq, упоминания и реакции до
// него гаснут. Возвращает номера, которые у участника пропали.
func (i *Interactor) clearForUser(ctx context.Context, chatID, userID, maxSeq int64) ([]int64, error) {
	gone, err := i.chats.VisibleSeqsUpTo(ctx, chatID, userID, maxSeq)
	if err != nil {
		return nil, err
	}
	if err := i.chats.SetClearedSeq(ctx, chatID, userID, maxSeq); err != nil {
		return nil, err
	}
	// Всё «до горизонта» считается прочитанным: read-маркер и непрочитанное
	// сдвигаются к максимуму (иначе бейдж застынет на скрытых сообщениях).
	if err := i.chats.SetRead(ctx, chatID, userID, maxSeq, 0); err != nil {
		return nil, err
	}
	if _, err := i.chats.ClearMentions(ctx, chatID, userID, maxSeq); err != nil {
		return nil, err
	}
	// Очищенное ему больше не видно — реакции на нём из ❤ уходят.
	if _, err := i.chats.RecountUnreadReactions(ctx, chatID, userID); err != nil {
		return nil, err
	}
	return gone, nil
}

// ownFrame — кадр журнала одного пользователя: тип конверта и тело.
type ownFrame struct {
	typ  string
	body map[string]any
}

// deleteChunks — кадры удаления номеров seqs пачками по deleteFrameChunk.
func deleteChunks(peer domain.PeerID, seqs []int64) []ownFrame {
	var out []ownFrame
	for len(seqs) > 0 {
		n := min(len(seqs), deleteFrameChunk)
		out = append(out, ownFrame{"delete_message", deletePayload(peer, seqs[:n]...)})
		seqs = seqs[n:]
	}
	return out
}

// journalOwn пишет кадры frames в журнал ОДНОГО пользователя (внутри
// транзакции вызывающего) и возвращает доставку живых кадров его устройствам —
// звать после коммита.
func (i *Interactor) journalOwn(ctx context.Context, userID int64, frames []ownFrame) (func(context.Context), error) {
	live := make([][]byte, 0, len(frames))
	date := nowMillis()
	for _, f := range frames {
		payload, err := json.Marshal(f.body)
		if err != nil {
			return nil, err
		}
		pts, err := i.updates.AppendUpdate(ctx, userID, 1, date, f.typ, payload)
		if err != nil {
			return nil, err
		}
		live = append(live, framePts(f.typ, f.body, pts))
	}
	return func(ctx context.Context) {
		if i.publisher == nil {
			return
		}
		for _, f := range live {
			_ = i.publisher.PublishToUser(ctx, userID, f)
		}
	}, nil
}
