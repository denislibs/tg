package chat

import (
	"context"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// fanOutNewMessage — «веер» доставки только что вставленного сообщения ВСЕМ
// участникам чата: pts-лог (payload/payloadLocked) + инкремент непрочитанных
// + отметка упоминаний. Единственный путь, которым сообщение попадает в
// pts-лог и unread получателей — вынесен из Send, чтобы им же пользовалась
// доставка зеркала поста канала (mirrorChannelPost, discussion_mirror.go):
// спека требует доставлять зеркало «тем же веером по MemberIDs, что у
// Send», а не копией его логики (см. design-doc, раздел «Создание»).
//
// Выполняется в АМБИЕНТНОЙ транзакции — ctx уже несёт tx вызывающего
// (TxManager.WithinTx кладёт его в контекст через querier()); своей
// транзакции не открывает и не может: голый pgxpool.Begin завёл бы вторую,
// никак не связанную с первой (наш TxManager вложенность не поддерживает).
//
// payloadLocked — nil, если у сообщения нет платного медиа (обычный случай,
// всегда nil для зеркала — оно платное медиа не копирует); иначе
// получателям (не автору) в pts-лог уходит заблокированный вариант, как в
// Send.
func (i *Interactor) fanOutNewMessage(
	ctx context.Context, chatID, senderID, msgID, msgSeq int64,
	payload, payloadLocked []byte, mentioned map[int64]bool,
) (recipients []int64, ptsByUser, unreadByUser map[int64]int64, err error) {
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return nil, nil, nil, err
	}
	slices.Sort(members)
	ptsByUser = map[int64]int64{}
	unreadByUser = map[int64]int64{}
	others := make([]int64, 0, len(members))
	senderIn := false
	for _, uid := range members {
		if uid == senderID {
			senderIn = true
			continue
		}
		others = append(others, uid)
	}
	date := nowMillis()
	// pts-лог: автору — обычный payload, получателям — обычный или locked
	// (платное медиа). Один batch-вызов на группу получателей, а не по одному
	// (len-гарды сохраняют семантику «пустой список — ни одного вызова
	// репозитория»; часть тест-стабов не задаёт updates).
	switch {
	case payloadLocked != nil:
		if senderIn {
			m1, e := i.updates.AppendUpdateBulk(ctx, []int64{senderID}, 1, date, "new_message", payload)
			if e != nil {
				return nil, nil, nil, e
			}
			for u, p := range m1 {
				ptsByUser[u] = p
			}
		}
		if len(others) > 0 {
			m2, e := i.updates.AppendUpdateBulk(ctx, others, 1, date, "new_message", payloadLocked)
			if e != nil {
				return nil, nil, nil, e
			}
			for u, p := range m2 {
				ptsByUser[u] = p
			}
		}
	case len(members) > 0:
		pm, e := i.updates.AppendUpdateBulk(ctx, members, 1, date, "new_message", payload)
		if e != nil {
			return nil, nil, nil, e
		}
		for u, p := range pm {
			ptsByUser[u] = p
		}
	}
	// Непрочитанные — одним запросом всем получателям (кроме автора).
	if len(others) > 0 {
		um, e := i.chats.IncUnreadBulk(ctx, chatID, others)
		if e != nil {
			return nil, nil, nil, e
		}
		for u, n := range um {
			unreadByUser[u] = n
		}
		// Упоминания редки — точечно (по остатку text_mention).
		for _, uid := range others {
			if mentioned[uid] {
				if e := i.chats.AddMention(ctx, chatID, msgID, msgSeq, uid); e != nil {
					return nil, nil, nil, e
				}
			}
		}
	}
	return members, ptsByUser, unreadByUser, nil
}

// publishMessageDelivery — пост-коммитная половина доставки, парная
// fanOutNewMessage: инвалидация кэша диалогов получателей + realtime-кадры
// (pts всем, unread — получателям кроме автора). Звать СТРОГО ПОСЛЕ того,
// как закоммитилась транзакция, в которой бежал fanOutNewMessage —
// опубликовать кадр раньше коммита нельзя (получатель может обогнать коммит
// и не найти сообщение при последующем чтении, см. Send).
//
// extRoot — thread_root_id, каким его должен увидеть клиент (внешний
// чокпоинт, см. externalThreadRoot); для зеркала — всегда nil (зеркало само
// корень треда).
func (i *Interactor) publishMessageDelivery(
	ctx context.Context, msg domain.Message, extRoot *int64, senderID int64,
	recipients []int64, ptsByUser, unreadByUser map[int64]int64,
) {
	if len(recipients) == 0 {
		return
	}
	// Список диалогов получателей изменился (unread/порядок/превью) —
	// сбрасываем их кэш снапшота (следующий /chats пересчитает).
	if i.dialogsCache != nil {
		i.dialogsCache.Invalidate(ctx, recipients...)
	}
	if i.publisher == nil {
		return
	}
	base := messageUpdatePayload(msg)
	base["thread_root_id"] = extRoot
	var baseLocked map[string]any
	if msg.PaidMediaPrice != nil {
		baseLocked = messageUpdatePayload(lockedPaidCopy(msg))
		baseLocked["thread_root_id"] = extRoot
	}
	// Realtime-кадры всем получателям — одним pipeline'ом (было бы M
	// последовательных PUBLISH). У каждого свой кадр (pts у всех; authoritative
	// unread — только у получателей, не автора).
	uids := make([]int64, 0, len(recipients))
	frames := make([][]byte, 0, len(recipients))
	for _, uid := range recipients {
		b := base
		if baseLocked != nil && uid != senderID {
			b = baseLocked
		}
		extra := map[string]any{"pts": ptsByUser[uid]}
		if uid != senderID {
			extra["unread"] = unreadByUser[uid]
		}
		uids = append(uids, uid)
		frames = append(frames, frameFields("new_message", b, extra))
	}
	_ = i.publisher.PublishToUsers(ctx, uids, frames)
}
