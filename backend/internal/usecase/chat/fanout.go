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
// outLocked — nil, если у сообщения нет платного медиа (обычный случай,
// всегда nil для зеркала — оно платное медиа не копирует); иначе
// получателям (не автору) в pts-лог уходит заблокированный вариант, как в
// Send.
//
// Payload'ы приходят СТРУКТУРАМИ, а не байтами: ключ пира у приватного
// диалога разный у двух сторон, поэтому маршалить приходится не один раз на
// сообщение, а один раз на каждый различный ключ (peerPayloads).
//
// senderID — автор строки для пер-зрительского `out`; 0 — сообщение ничьё
// (зеркало поста канала, A1-13: непрочитано у всех, `out` ни у кого).
func (i *Interactor) fanOutNewMessage(
	ctx context.Context, chatID, senderID, msgID, msgSeq int64,
	out, outLocked map[string]any, mentioned map[int64]bool,
) (recipients []int64, ptsByUser map[int64]int64, mentions map[int64]bool, err error) {
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return nil, nil, nil, err
	}
	slices.Sort(members)
	pp, err := i.newPeerPayloads(ctx, chatID, out)
	if err != nil {
		return nil, nil, nil, err
	}
	// Автор строки — с ним peerPayloads сравнивает получателя, чтобы поставить
	// пер-зрительский pFlags.out и, что важнее, разложить журнальные батчи по
	// паре «пир + свой ли отправитель», а не по одному ключу пира.
	pp.sender = senderID
	var ppLocked *peerPayloads
	if outLocked != nil {
		ppLocked, err = i.newPeerPayloads(ctx, chatID, outLocked)
		if err != nil {
			return nil, nil, nil, err
		}
		ppLocked.sender = senderID
	}
	ptsByUser = map[int64]int64{}
	others := make([]int64, 0, len(members))
	senderIn := false
	for _, uid := range members {
		if uid == senderID {
			senderIn = true
			continue
		}
		others = append(others, uid)
		// Упомянутый получатель (не автор) — свежее упоминание, непрочитано.
		if mentioned[uid] {
			if mentions == nil {
				mentions = map[int64]bool{}
			}
			mentions[uid] = true
		}
	}
	pp.mentions = mentions
	if ppLocked != nil {
		ppLocked.mentions = mentions
	}
	date := nowUnix()
	// pts-лог: автору — обычный payload, получателям — обычный или locked
	// (платное медиа). Один batch-вызов на группу получателей, а не по одному
	// (len-гарды сохраняют семантику «пустой список — ни одного вызова
	// репозитория»; часть тест-стабов не задаёт updates).
	switch {
	case ppLocked != nil:
		if senderIn {
			if e := i.appendByPeer(ctx, pp, []int64{senderID}, date, ptsByUser); e != nil {
				return nil, nil, nil, e
			}
		}
		if len(others) > 0 {
			if e := i.appendByPeer(ctx, ppLocked, others, date, ptsByUser); e != nil {
				return nil, nil, nil, e
			}
		}
	case len(members) > 0:
		if e := i.appendByPeer(ctx, pp, members, date, ptsByUser); e != nil {
			return nil, nil, nil, e
		}
	}
	// Диалог, удалённый кем-то из участников «у себя» (DeleteDialog),
	// возвращается в список с новым сообщением — тот же чат, а не второй.
	// Прятать строку умеет только личка и «Избранное» (у их адреса есть
	// состав, chatAddress.members), остальным чатам вопрос не задаётся.
	if pp.addr.members != nil {
		if e := i.chats.ShowDialogs(ctx, chatID); e != nil {
			return nil, nil, nil, e
		}
	}
	// Непрочитанные — одним запросом всем получателям (кроме автора).
	//
	// Счётчик РАСТЁТ в базе, но в кадр не едет: у конструктора updateNewMessage
	// такого параметра нет, а поле рядом с ним было последним, что осталось
	// вне конструктора. Клиент считает +1 сам — ровно как оригинал
	// (appMessagesManager), а авторитетное значение приезжает со строкой
	// диалога и с кадром прочтения (updateReadHistoryInbox.still_unread_count).
	if len(others) > 0 {
		if _, e := i.chats.IncUnreadBulk(ctx, chatID, others); e != nil {
			return nil, nil, nil, e
		}
		// Упоминания редки — точечно (кто упомянут — см. messageMentions).
		for uid := range mentions {
			if e := i.chats.AddMention(ctx, chatID, msgID, msgSeq, uid); e != nil {
				return nil, nil, nil, e
			}
		}
	}
	return members, ptsByUser, mentions, nil
}

// appendGuestOwn — гость обсуждения (не участник, Send пропускает его только
// в тред комментариев) получает СВОЁ сообщение в журнал, как свои устройства:
// out — его, payload — тот же, что у веера. В веер группы (непрочитанное,
// упоминания, пуш) он не входит. Звать в транзакции отправки после
// fanOutNewMessage; вызывающий добавляет гостя к получателям живого кадра.
func (i *Interactor) appendGuestOwn(ctx context.Context, chatID, senderID int64, out map[string]any, ptsByUser map[int64]int64) error {
	if i.updates == nil {
		return nil
	}
	pp, err := i.newPeerPayloads(ctx, chatID, out)
	if err != nil {
		return err
	}
	pp.sender = senderID
	return i.appendByPeer(ctx, pp, []int64{senderID}, nowUnix(), ptsByUser)
}

// publishMessageDelivery — пост-коммитная половина доставки, парная
// fanOutNewMessage: инвалидация кэша диалогов получателей + realtime-кадры
// (у каждого получателя свой pts). Звать СТРОГО ПОСЛЕ того,
// как закоммитилась транзакция, в которой бежал fanOutNewMessage —
// опубликовать кадр раньше коммита нельзя (получатель может обогнать коммит
// и не найти сообщение при последующем чтении, см. Send).
//
// Корень треда отдельным аргументом больше не едет: он внутри сообщения —
// reply_to.reply_to_top_id, и кладёт его туда messageUpdatePayload. Прежний
// ключ на уровне кадра был вторым источником того же факта, и дописывал его
// каждый вызывающий сам.
//
// Зеркало поста канала ничьё (A1-13): автора у него нет ни для `out`, ни для
// архива, что бы ни передал вызывающий.
func (i *Interactor) publishMessageDelivery(
	ctx context.Context, msg domain.Message, senderID int64,
	recipients []int64, ptsByUser map[int64]int64, mentions map[int64]bool,
) {
	if len(recipients) == 0 {
		return
	}
	author := msg.SenderID
	if msg.IsDiscussionMirror {
		senderID, author = 0, 0
	}
	i.unarchiveOnMessage(ctx, msg.ChatID, senderID, recipients)
	// Список диалогов получателей изменился (unread/порядок/превью) —
	// сбрасываем их кэш снапшота (следующий /chats пересчитает).
	i.invalidateDialogs(ctx, recipients...)
	if i.publisher == nil {
		return
	}
	base := i.messageUpdatePayload(ctx, msg)
	pp, err := i.newPeerPayloads(ctx, msg.ChatID, base)
	if err != nil {
		return
	}
	// Автор строки — с ним peerPayloads сравнивает получателя, чтобы поставить
	// пер-зрительский pFlags.out.
	pp.sender = author
	pp.mentions = mentions
	ppLocked := pp
	if msg.PaidMediaPrice != nil {
		baseLocked := i.messageUpdatePayload(ctx, lockedPaidCopy(msg))
		if ppLocked, err = i.newPeerPayloads(ctx, msg.ChatID, baseLocked); err != nil {
			return
		}
		ppLocked.sender = author
		ppLocked.mentions = mentions
	}
	// Realtime-кадры всем получателям — одним pipeline'ом (было бы M
	// последовательных PUBLISH). У каждого свой кадр: курсор пер-юзерный.
	uids := make([]int64, 0, len(recipients))
	frames := make([][]byte, 0, len(recipients))
	for _, uid := range recipients {
		b := pp
		if senderID == 0 || uid != senderID {
			b = ppLocked
		}
		uids = append(uids, uid)
		frames = append(frames, b.frame("new_message", uid, map[string]any{"pts": ptsByUser[uid]}))
	}
	_ = i.publisher.PublishToUsers(ctx, uids, frames)
}

// notifyNewMessage — пуш-уведомления о новом сообщении получателям (кроме
// автора). Упомянутым и тем, кому ответили (mentions — те же, что пометил
// fanOutNewMessage), мьют не мешает; тема сообщения — корень его треда.
// Звать после коммита, не для тихой отправки.
func (i *Interactor) notifyNewMessage(ctx context.Context, msg domain.Message, senderID int64, recipients []int64, mentions map[int64]bool) {
	if i.notifier == nil {
		return
	}
	var topic int64
	if msg.ThreadRootID != nil {
		topic = *msg.ThreadRootID
	}
	for _, uid := range recipients {
		if uid == senderID {
			continue
		}
		peer, _ := i.ChatIDToPeer(ctx, uid, msg.ChatID)
		i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.Seq, msg.SenderID, msg.Text, peer, mentions[uid], topic)
	}
}

// notifyDiscussionGuests — пуш гостям обсуждения (не участникам группы,
// которые комментируют без вступления): об ответе на их комментарий и об
// упоминании в треде комментариев. Членства и ленты у гостя нет, чата
// «Ответы» (tweb REPLIES_PEER_ID, bubbles.ts:3757-3766) у нас тоже, поэтому
// временная замена — пуш (решение пользователя к В-2). mentioned — все, кого
// упоминает сообщение (messageMentions, до отсева по членству); recipients —
// участники веера. Гость должен читать обсуждение (RequireDiscussionRead):
// text_mention постороннего пушем не становится. Звать после коммита, не для
// тихой отправки.
func (i *Interactor) notifyDiscussionGuests(ctx context.Context, msg domain.Message, recipients []int64, mentioned map[int64]bool) {
	if i.notifier == nil || i.groups == nil || msg.ThreadRootID == nil || len(mentioned) == 0 {
		return
	}
	var guests []int64
	for uid := range mentioned {
		if uid != msg.SenderID && !slices.Contains(recipients, uid) {
			guests = append(guests, uid)
		}
	}
	if len(guests) == 0 {
		return
	}
	if disc, err := i.groups.IsDiscussionGroup(ctx, msg.ChatID); err != nil || !disc {
		return
	}
	slices.Sort(guests)
	for _, uid := range guests {
		if i.discussionGuestThread(ctx, msg.ChatID, uid, msg.ThreadRootID, false) != nil {
			continue
		}
		peer, err := i.ChatIDToPeer(ctx, uid, msg.ChatID)
		if err != nil {
			continue
		}
		i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.Seq, msg.SenderID, msg.Text, peer, true, *msg.ThreadRootID)
	}
}

// unarchiveOnMessage — новое сообщение возвращает архивный НЕзаглушённый чат
// получателя в основной список, как сервер Telegram (keep_archived_unmuted по
// умолчанию выключен): строка выходит из архива, а устройствам получателя
// уходит updateFolderPeers с folder 0 (tweb dialogs.ts applyFolder). Автор
// сообщения свой архив не теряет; заглушённый чат остаётся в архиве.
func (i *Interactor) unarchiveOnMessage(ctx context.Context, chatID, senderID int64, recipients []int64) {
	others := make([]int64, 0, len(recipients))
	for _, uid := range recipients {
		if uid != senderID {
			others = append(others, uid)
		}
	}
	if len(others) == 0 {
		return
	}
	back, err := i.chats.UnarchiveUnmuted(ctx, chatID, others)
	if err != nil || len(back) == 0 {
		return
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, back, "dialog_archive",
		func(peer domain.PeerID) map[string]any { return dialogFolderPayload(peer, domain.FolderAll) })
}
