package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// mirrorDelivery — результат mirrorChannelPost, нужный ПОСЛЕ коммита
// транзакции вызывающего, чтобы зеркало было опубликовано участникам группы
// обсуждения тем же путём, что и обычное сообщение (см. publishMessageDelivery
// в fanout.go). nil, если зеркала не было (обсуждения нет / уже зеркалировано
// / чат-получатель — не канал) — вызывающий тогда просто ничего не публикует.
type mirrorDelivery struct {
	msg        domain.Message
	recipients []int64
	ptsByUser  map[int64]int64
	mentions   map[int64]bool
}

// mirrorChannelPost кладёт зеркало поста канала в его группу обсуждения.
// Telegram-модель: комментарии — это обычный тред в группе, отвечающий на
// зеркало, поэтому зеркало обязано появиться вместе с постом (в той же
// транзакции), иначе у поста не будет треда.
//
// Единственное место, где рождается зеркало — его зовут ВСЕ пути вставки
// сообщения (PostToChannel, Send, ForwardMessages, publishApprovedPost)
// БЕЗУСЛОВНО, самим хелпером. «Это пост канала или нет» решается ЗДЕСЬ, по
// типу чата-получателя, а не на месте вызова по полю сообщения:
// ThreadRootID приходит из HTTP/WS-фрейма и не валидируется на
// принадлежность чату (в отличие от ReplyToID), плюс то же поле
// переиспользуют форум-топики — гейтить по нему «это пост» означало бы, что
// обычный пост в канал с обсуждением, отправленный со сфабрикованным
// thread_root_id, навсегда остаётся без зеркала и без треда, штатным API,
// без каких-либо ухищрений.
//
// Комментарии живут в группе обсуждения (или форум-топики — в группе), а не
// в канале, поэтому досюда как «пост» и не долетают: проверка типа чата
// ниже отсекает их так же надёжно, как заодно отсекает Send в любой
// private/group чат.
//
// Возвращает mirrorDelivery, если зеркало было создано И довезено до
// pts-лога/unread участников группы ВНУТРИ этой же (амбиентной) транзакции —
// вызывающий обязан после коммита позвать publishMessageDelivery с этим
// результатом (см. её комментарий и вызовы в message.go/channel.go/
// message_forward.go/suggested.go), иначе зеркало осядет в БД, но не
// доедет до подписчиков в реальном времени/через getDifference.
func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) (*mirrorDelivery, error) {
	if i.groups == nil {
		return nil, nil
	}
	// GetDiscussion ниже сам по себе почти достаточен (у группы/привата
	// discussion_chat_id не выставляется штатными путями), но
	// EnableDiscussion/LinkDiscussion не проверяют тип чата и технически
	// позволяют привязать «обсуждение» к обычной группе (отдельный баг вне
	// рамок этой задачи) — явная проверка типа не даёт такой группе начать
	// зеркалить в себя каждое сообщение своих участников.
	typ, err := i.chats.ChatType(ctx, post.ChatID)
	if err != nil {
		// та же логика, что и у ошибки GetDiscussion ниже: пост уже вставлен
		// этой же транзакцией, chats-строка точно существует — любая ошибка
		// тут реальный сбой и обязана откатить публикацию.
		return nil, err
	}
	if typ != domain.ChatTypeChannel {
		return nil, nil
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil {
		// транзиентная ошибка (обрыв соединения и т.п.) — не «обсуждения нет»:
		// GroupRepo.GetDiscussion кодирует «нет обсуждения» через disc==0 с
		// err==nil (COALESCE discussion_chat_id в 0), а не через ошибку. Здесь
		// пост уже вставлен той же транзакцией, так что chats-строка канала
		// точно существует — любая ошибка тут реальный сбой и обязана откатить
		// публикацию, иначе пост останется без треда комментариев навсегда.
		return nil, err
	}
	if disc == 0 {
		// у канала нет привязанного обсуждения — зеркалить некуда, это не ошибка
		return nil, nil
	}
	// идемпотентность: ретрай/повторная доставка не должны плодить зеркала
	// (в базе то же самое держит уникальный индекс). Намеренно
	// MirrorOfExactPost, а не MirrorByPost: последний для элемента альбома
	// коллапсирует резолв в зеркало ПЕРВОГО элемента группы (см. правило
	// «один тред на альбом»), и если бы идемпотентность проверялась им,
	// второй и последующие элементы альбома решили бы, что уже зеркалены
	// (через зеркало первого), и не завели бы СВОИХ строк — альбом в группе
	// обсуждения приехал бы обрезанным. Каждый элемент альбома обязан
	// получить собственное зеркало, даже когда тред у них общий.
	//
	// Повторная попытка (existing != 0) не переделивает зеркало: если строка
	// уже есть, её ПЕРВАЯ вставка уже прошла ту же самую транзакцию целиком
	// (включая fan-out ниже) — иначе строки просто не было бы, обе части
	// коммитятся или откатываются вместе.
	if existing, err := i.msgs.MirrorOfExactPost(ctx, post.ChatID, post.ID); err != nil {
		return nil, err
	} else if existing != 0 {
		return nil, nil
	}

	seq, err := i.msgs.NextSeq(ctx, disc)
	if err != nil {
		return nil, err
	}
	channelID := post.ChatID
	postID := post.ID
	date := post.CreatedAt
	// Зеркало — та же публикация (у оригинала автопересылка поста с тем же
	// media): содержимое — общим копировщиком, иначе гео, контакт, чек-лист,
	// розыгрыш, превью, клавиатура и спойлер терялись. grouped_id остаётся
	// ключом альбома поста: «один тред на альбом» ищет зеркало по нему.
	m := copyContent(post)
	m.ChatID, m.Seq, m.SenderID = disc, seq, post.SenderID
	m.Effect = post.Effect
	// автор бабла в UI — канал, как в Telegram
	m.SendAsChatID = &channelID
	// отсюда кнопка «перейти к оригиналу»
	m.FwdFromChatID, m.FwdFromMsgID, m.FwdDate = &channelID, &postID, &date
	m.IsDiscussionMirror = true
	if m.ChecklistID, err = i.snapshotChecklist(ctx, m.ChecklistID, disc); err != nil {
		return nil, err
	}
	// Клавиатура поста зеркалу не нужна: кнопки — у поста в канале.
	m.ReplyMarkup = nil
	mirror, err := i.insertCopy(ctx, m)
	if err != nil {
		return nil, err
	}
	// Платное медиа поста: зеркало продаётся тем же предложением (цена и
	// продавец — поста). Без этого группа обсуждения получала медиа даром.
	if i.paidMedia != nil && mirror.MediaID != nil {
		offers, err := i.paidMedia.Offers(ctx, []int64{post.ID})
		if err != nil {
			return nil, err
		}
		if o, ok := offers[post.ID]; ok {
			if err := i.paidMedia.SetPrice(ctx, mirror.ID, o.Price, o.OfferID); err != nil {
				return nil, err
			}
		}
	}
	// Кадр и журнал несут зеркало той же формой, что история (медиа-мета,
	// опрос, чек-лист, розыгрыш, платное медиа), — иначе бабл приезжал пустым
	// до перезагрузки.
	if mirror, err = i.hydrateBroadcastMessage(ctx, mirror); err != nil {
		return nil, err
	}
	var outLocked map[string]any
	if mirror.PaidMediaPrice != nil {
		outLocked = i.messageUpdatePayload(ctx, lockedPaidCopy(mirror))
	}

	// Доставка зеркала переиспользует обычный путь группового сообщения — тот
	// же веер по MemberIDs, что у Send (design-doc, раздел «Создание»): без
	// него зеркало ложится в БД, но не попадает в pts-лог получателей (клиент
	// не увидит его в getDifference), в unread, в realtime-кадр, а кэш диалогов
	// участников группы не инвалидируется — подписчики канала узнают о
	// комментируемом посте только перезагрузив историю руками.
	// thread_root_id у зеркала не нуждается в переводе (в отличие от Send):
	// зеркало САМО корень треда, i.messageUpdatePayload(ctx, mirror) уже несёт
	// thread_root_id=nil.
	mentioned, err := i.mentionedUsers(ctx, disc, mirror.Text, mirror.Entities)
	if err != nil {
		return nil, err
	}
	recipients, ptsByUser, mentions, err := i.fanOutNewMessage(
		ctx, disc, post.SenderID, mirror.ID, mirror.Seq, i.messageUpdatePayload(ctx, mirror), outLocked, mentioned)
	if err != nil {
		return nil, err
	}
	return &mirrorDelivery{msg: mirror, recipients: recipients, ptsByUser: ptsByUser, mentions: mentions}, nil
}

// ExternalizeThreadRoots переводит thread_root_id из внутреннего ключа строки в
// НОМЕР корня В ТОМ ЖЕ ПИРЕ — единая точка для любого пути, которым сообщения
// покидают процесс (MessagesWire для HTTP, externalThreadRoot для кадров).
//
// На проводе корень треда это messageReplyHeader.reply_to_top_id, и он ВСЕГДА
// в том же пире, что и само сообщение: у комментария это номер ЗЕРКАЛА поста в
// группе обсуждения, где комментарий физически и живёт.
//
// Ступени перевода «зеркало → пост канала» здесь БОЛЬШЕ НЕТ, и это снятая
// самодеятельность: наружу уезжал номер поста В ДРУГОМ ПИРЕ, то есть пара «пир
// + номер» была неполна — пир корня ехал неявно. Поля thread_root_id в схеме
// нет вовсе.
//
// Входящий контракт симметричен: ?thread_root=/thread_root_id — тоже номер
// корня в том же пире (у комментария — номер зеркала, см.
// resolveThreadRootForQuery). Перевод «пост канала → зеркало» — одна ручка
// GetDiscussionMessage, как messages.getDiscussionMessage у оригинала.
//
// Батчевый: один резолв на весь набор, а не запрос на сообщение. Возвращает
// НОВЫЙ слайс (той же длины и порядка) — входной msgs не мутируется.
func (i *Interactor) ExternalizeThreadRoots(ctx context.Context, msgs []domain.Message) ([]domain.Message, error) {
	roots := make([]int64, 0, len(msgs))
	seen := map[int64]bool{}
	for _, m := range msgs {
		if m.ThreadRootID != nil && !seen[*m.ThreadRootID] {
			seen[*m.ThreadRootID] = true
			roots = append(roots, *m.ThreadRootID)
		}
	}
	if len(roots) == 0 {
		return msgs, nil
	}
	seqByID, err := i.msgs.SeqsByIDs(ctx, roots)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Message, len(msgs))
	copy(out, msgs)
	for idx := range out {
		if out[idx].ThreadRootID == nil {
			continue
		}
		seq, ok := seqByID[*out[idx].ThreadRootID]
		if !ok {
			// Корня в базе больше нет: номера у него не существует, а внутренний
			// ключ наружу не выходит ни при каких обстоятельствах.
			out[idx].ThreadRootID = nil
			continue
		}
		v := seq
		out[idx].ThreadRootID = &v
	}
	return out, nil
}

// externalThreadRoot — удобная обёртка ExternalizeThreadRoots для одного
// сообщения: WS/лог-пейлоад всегда строится по одному сообщению за раз
// (Send/ForwardMessages/publishApprovedPost/paidmedia — не список), батчить
// тут нечего. Сбой резолва — деградация до «корня нет»: внутренний ключ наружу
// не уходит
// даже best-effort (он адресует не то сообщение в пространстве номеров).
func (i *Interactor) externalThreadRoot(ctx context.Context, m domain.Message) *int64 {
	if m.ThreadRootID == nil {
		return nil
	}
	ext, err := i.ExternalizeThreadRoots(ctx, []domain.Message{m})
	if err != nil || len(ext) != 1 {
		return nil
	}
	return ext[0].ThreadRootID
}

// resolveThreadRootForQuery переводит ВХОДЯЩИЙ клиентский thread_root (НОМЕР
// корня треда В ЭТОМ ЖЕ ЧАТЕ) в ключ строки для запроса к хранилищу —
// обратная операция к ExternalizeThreadRoots: та переводит наружу при отдаче,
// эта — внутрь при чтении (GetHistory/GetHistoryAround, ?thread_root=<номер>).
//
// Пара «пир + номер» полна: у форум-топика корень — сообщение темы в chatID,
// у комментариев — ЗЕРКАЛО поста в группе обсуждения (chatID — сама группа).
// Как у оригинала: тред комментариев адресуется номером зеркала
// (`messages.getDiscussionMessage` → `threadId` = mid в группе, tweb
// appImManager.ts:2212-2224, bubbles.ts:3773-3780), а перевод «пост канала →
// зеркало» делает ровно одна ручка — GetDiscussionMessage.
//
// threadRoot == nil -> nil. Номера в чате нет — указатель на 0: реальные id
// сообщений всегда положительны, так что фильтр гарантированно не совпадёт ни
// с одним сообщением («треда нет» — не ошибка, пустая страница).
func (i *Interactor) resolveThreadRootForQuery(ctx context.Context, chatID int64, threadRoot *int64) *int64 {
	if threadRoot == nil {
		return nil
	}
	rootID, err := i.msgs.IDBySeq(ctx, chatID, *threadRoot)
	if err != nil {
		miss := int64(0)
		return &miss
	}
	return &rootID
}

// ResolveThreadRootForSend — тот же перевод номера корня (в том же чате) в
// ключ строки для ВХОДЯЩЕЙ записи (generic Send с HTTP/WS).
//
// НЕ переиспользует resolveThreadRootForQuery: та при отсутствии корня
// возвращает указатель на 0 — безопасный sentinel ТОЛЬКО для SQL-фильтра
// чтения. На записи thread_root_id уходит в INSERT: у колонки нет FK, и 0
// молча записался бы как валидный корень, схлопнув в один «тред» все
// сообщения с несуществующим корнем. Поэтому здесь — domain.ErrNotFound.
//
// Резолвить нужно СНАРУЖИ Send, на границе HTTP/WS-хендлера: PostComment зовёт
// Send уже с ключом строки зеркала, и второй перевод внутри Send принял бы его
// за номер. Экспортирован ровно для пограничных хендлеров
// (delivery/http.ChatHandler.Send, delivery/ws dispatch send_message).
func (i *Interactor) ResolveThreadRootForSend(ctx context.Context, chatID int64, threadRoot *int64) (*int64, error) {
	if threadRoot == nil {
		return nil, nil
	}
	rootID, err := i.msgs.IDBySeq(ctx, chatID, *threadRoot)
	if err != nil {
		return nil, err // ErrNotFound — тредить некуда, отклоняем
	}
	return &rootID, nil
}
