package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// mirrorDelivery — результат mirrorChannelPost, нужный ПОСЛЕ коммита
// транзакции вызывающего, чтобы зеркало было опубликовано участникам группы
// обсуждения тем же путём, что и обычное сообщение (см. publishMessageDelivery
// в fanout.go). nil, если зеркала не было (обсуждения нет / уже зеркалировано
// / чат-получатель — не канал) — вызывающий тогда просто ничего не публикует.
type mirrorDelivery struct {
	msg          domain.Message
	recipients   []int64
	ptsByUser    map[int64]int64
	unreadByUser map[int64]int64
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
// доедет до подписчиков в реальном времени/через /sync.
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
	if typ != "channel" {
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
	mirror, err := i.msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: seq, SenderID: post.SenderID,
		Type: post.Type, Text: post.Text, Entities: post.Entities,
		MediaID: post.MediaID, GroupedID: post.GroupedID, PollID: post.PollID,
		// автор бабла в UI — канал, как в Telegram
		SendAsChatID: &channelID,
		// отсюда кнопка «перейти к оригиналу»
		FwdFromChatID: &channelID, FwdFromMsgID: &postID, FwdDate: &date,
		IsDiscussionMirror: true,
	})
	if err != nil {
		return nil, err
	}

	// Доставка зеркала переиспользует обычный путь группового сообщения — тот
	// же веер по MemberIDs, что у Send (design-doc, раздел «Создание»): без
	// него зеркало ложится в БД, но не попадает в pts-лог получателей (клиент
	// не увидит его в /sync), в unread, в realtime-кадр, а кэш диалогов
	// участников группы не инвалидируется — подписчики канала узнают о
	// комментируемом посте только перезагрузив историю руками.
	// thread_root_id у зеркала не нуждается в переводе (в отличие от Send):
	// зеркало САМО корень треда, messageUpdatePayload(mirror) уже несёт
	// thread_root_id=nil.
	mentioned := mentionedUserIDs(mirror.Entities)
	payload, err := json.Marshal(messageUpdatePayload(mirror))
	if err != nil {
		return nil, err
	}
	recipients, ptsByUser, unreadByUser, err := i.fanOutNewMessage(
		ctx, disc, post.SenderID, mirror.ID, mirror.Seq, payload, nil, mentioned)
	if err != nil {
		return nil, err
	}
	return &mirrorDelivery{msg: mirror, recipients: recipients, ptsByUser: ptsByUser, unreadByUser: unreadByUser}, nil
}

// ExternalizeThreadRoots — обратный перевод mirrorChannelPost и ЕДИНАЯ точка
// перевода thread_root_id для ЛЮБОГО пути, которым сообщения покидают
// процесс: HTTP-сериализация ответа (см. messagesJSON/messageJSONOut,
// chat_handler.go) и сборка WS/лог-пейлоада (см. externalThreadRoot ниже,
// вызывается из message.go/message_forward.go/suggested.go/paidmedia.go).
// Наружу комментарий обязан нести thread_root_id = id ПОСТА, а не id
// зеркала, на котором тред физически держится в БД (см.
// PostComment/ListComments/CommentCounts) — иначе один и тот же комментарий
// уезжает клиенту с разными id по разным путям, и окно треда на клиенте
// расъезжается с историей.
//
// Батчевый: один резолв (PostsByMirrors) на весь набор сообщений, а не
// запрос на сообщение — критично для списков истории (N+1 недопустим).
// Обычные сообщения (ThreadRootID == nil) и форум-топики (root — настоящее
// сообщение темы чата, не зеркало) не меняются. Возвращает НОВЫЙ слайс
// (той же длины и порядка) — входной msgs не мутируется, вызывающие вправе
// держать оригинал (например, PostComment/ListComments отдают его тестам
// как внутреннее представление с id зеркала — контракт этих методов не
// меняется, перевод применяется только на границе доставки).
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
	postByRoot, err := i.msgs.PostsByMirrors(ctx, roots)
	if err != nil {
		return nil, err
	}
	if len(postByRoot) == 0 {
		return msgs, nil
	}
	out := make([]domain.Message, len(msgs))
	copy(out, msgs)
	for idx := range out {
		if out[idx].ThreadRootID == nil {
			continue
		}
		if postID, ok := postByRoot[*out[idx].ThreadRootID]; ok {
			p := postID
			out[idx].ThreadRootID = &p
		}
	}
	return out, nil
}

// externalThreadRoot — удобная обёртка ExternalizeThreadRoots для одного
// сообщения: WS/лог-пейлоад всегда строится по одному сообщению за раз
// (Send/ForwardMessages/publishApprovedPost/paidmedia — не список), батчить
// тут нечего. Сбой резолва — best-effort деградация до внутреннего id
// (кадр всё равно обязан уйти, а не потеряться из-за сбоя перевода).
func (i *Interactor) externalThreadRoot(ctx context.Context, m domain.Message) *int64 {
	if m.ThreadRootID == nil {
		return nil
	}
	ext, err := i.ExternalizeThreadRoots(ctx, []domain.Message{m})
	if err != nil || len(ext) != 1 {
		return m.ThreadRootID
	}
	return ext[0].ThreadRootID
}

// resolveThreadRootForQuery переводит ВХОДЯЩИЙ клиентский thread_root (id
// ПОСТА — внешний контракт) в id ЗЕРКАЛА для запроса к хранилищу —
// зеркальная (в обоих смыслах) операция к ExternalizeThreadRoots: та
// переводит наружу при отдаче, эта — внутрь при чтении. Нужна generic-
// истории чата (GetHistory/GetHistoryAround, ?thread_root=<id>): текущий
// клиент читает комментарии именно так, передавая id поста, а
// MessageRepo.GetHistory/GetAround/CountThread фильтруют по буквальному
// значению — без перевода тред «не находится» (комментарии физически висят
// на id зеркала), и страница молча возвращается пустой.
//
// chatID — группа обсуждения (только там комментарии читаются нечленами,
// см. checkHistoryAccess); для форум-топиков (chatID — обычная группа,
// threadRoot уже настоящий id сообщения темы) отдаёт вход без изменений.
// threadRoot == nil -> nil. Если резолв не нашёл зеркала для этого id —
// возвращает указатель на 0: реальные id сообщений всегда положительны, так
// что запрос с ним гарантированно не совпадёт ни с одним сообщением
// («треда ещё нет» — не ошибка, как и у ListComments/CommentCounts).
func (i *Interactor) resolveThreadRootForQuery(ctx context.Context, chatID int64, threadRoot *int64) *int64 {
	if threadRoot == nil || i.groups == nil {
		return threadRoot
	}
	disc, err := i.groups.IsDiscussionGroup(ctx, chatID)
	if err != nil || !disc {
		return threadRoot
	}
	channelID, err := i.groups.DiscussionChannel(ctx, chatID)
	if err != nil || channelID == 0 {
		return threadRoot
	}
	root, err := i.msgs.MirrorByPost(ctx, channelID, *threadRoot)
	if err != nil {
		return threadRoot
	}
	return &root
}

// ResolveThreadRootForSend — трансляция id поста в id зеркала для ВХОДЯЩЕЙ
// записи (generic Send). Блокер: resolveThreadRootForQuery применялась
// только на чтении (GetHistory/GetHistoryAround), а thread_root_id,
// приходящий в Send с HTTP/WS, оставался буквальным id ПОСТА — комментарий,
// отправленный generic-путём (не через PostComment), приземлялся на
// несуществующий/чужой корень и в треде никогда не появлялся.
//
// НЕ переиспользует resolveThreadRootForQuery — это отдельная, специально
// разведённая логика, а не обёртка над ней. Причина: resolveThreadRootForQuery
// при отсутствии зеркала возвращает указатель на 0 — безопасный sentinel
// ТОЛЬКО для SQL-фильтра чтения (0 не совпадёт ни с одним реальным id).
// На записи thread_root_id уходит в INSERT: у колонки нет FK, так что 0
// молча запишется как валидное значение, а НЕ как «треда нет» — и тогда
// СХЛОПНЕТ в один «тред» все комментарии к РАЗНЫМ домиграционным постам,
// у которых зеркала ещё нет (у всех thread_root_id=0 читался бы как один и
// тот же корень). Ревью на живом стенде воспроизвело это буквально: два
// поста, опубликованные до EnableDiscussion, generic-send с
// thread_root_id=<post1> и thread_root_id=<post2> → обе строки получали
// thread_root_id=0, а GetHistory(thread_root=post1) резолвился в тот же 0 и
// отдавал ОБА комментария разом.
//
// Вместо sentinel запись обязана вести себя как PostComment: если зеркала
// нет — дозеркалировать пост тем же lazyMirrorPost (включая правило
// альбома), а если корня и после этого нет — отклонить domain.ErrNotFound,
// а не писать 0.
//
// Резолвить нужно СНАРУЖИ Send, на границе HTTP/WS-хендлера, а не внутри
// самого Send: PostComment уже вызывает Send с ThreadRootID = id зеркала
// (см. PostComment в discussion.go) — если бы Send резолвил ещё раз, он
// попытался бы найти «зеркало зеркала» (несуществующее, root=0) и сломал бы
// комментарии, отправленные штатным путём PostComment. Экспортирован ровно
// для того, чтобы единственными легальными вызывающими были пограничные
// хендлеры (delivery/http.ChatHandler.Send, delivery/ws dispatch
// send_message), а не usecase-код.
func (i *Interactor) ResolveThreadRootForSend(ctx context.Context, chatID int64, threadRoot *int64) (*int64, error) {
	if threadRoot == nil || i.groups == nil {
		return threadRoot, nil
	}
	disc, err := i.groups.IsDiscussionGroup(ctx, chatID)
	if err != nil || !disc {
		// не discussion-группа (форум-топик и т.п.) — вход не трогаем, как раньше.
		return threadRoot, nil
	}
	channelID, err := i.groups.DiscussionChannel(ctx, chatID)
	if err != nil || channelID == 0 {
		return threadRoot, nil
	}
	root, err := i.msgs.MirrorByPost(ctx, channelID, *threadRoot)
	if err != nil {
		return nil, err
	}
	if root == 0 {
		// Зеркала нет — почти наверняка домиграционный пост (опубликован до
		// EnableDiscussion/LinkDiscussion): дозаводим ровно тем же путём, что
		// и первый комментарий через PostComment (см. её комментарий и
		// правило альбома), а не пишем sentinel и не молчим.
		root, err = i.lazyMirrorPost(ctx, channelID, *threadRoot)
		if err != nil {
			return nil, err
		}
	}
	if root == 0 {
		// Дозаводка не помогла (поста нет / чужой канал / удалён) — треда
		// действительно нет, отклоняем запрос понятной доменной ошибкой
		// вместо записи 0.
		return nil, domain.ErrNotFound
	}
	return &root, nil
}
