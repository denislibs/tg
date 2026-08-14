package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

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
func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) error {
	if i.groups == nil {
		return nil
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
		return err
	}
	if typ != "channel" {
		return nil
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil {
		// транзиентная ошибка (обрыв соединения и т.п.) — не «обсуждения нет»:
		// GroupRepo.GetDiscussion кодирует «нет обсуждения» через disc==0 с
		// err==nil (COALESCE discussion_chat_id в 0), а не через ошибку. Здесь
		// пост уже вставлен той же транзакцией, так что chats-строка канала
		// точно существует — любая ошибка тут реальный сбой и обязана откатить
		// публикацию, иначе пост останется без треда комментариев навсегда.
		return err
	}
	if disc == 0 {
		// у канала нет привязанного обсуждения — зеркалить некуда, это не ошибка
		return nil
	}
	// идемпотентность: ретрай/повторная доставка не должны плодить зеркала
	// (в базе то же самое держит уникальный индекс)
	if existing, err := i.msgs.MirrorByPost(ctx, post.ChatID, post.ID); err != nil {
		return err
	} else if existing != 0 {
		return nil
	}

	seq, err := i.msgs.NextSeq(ctx, disc)
	if err != nil {
		return err
	}
	channelID := post.ChatID
	postID := post.ID
	date := post.CreatedAt
	_, err = i.msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: seq, SenderID: post.SenderID,
		Type: post.Type, Text: post.Text, Entities: post.Entities,
		MediaID: post.MediaID, GroupedID: post.GroupedID, PollID: post.PollID,
		// автор бабла в UI — канал, как в Telegram
		SendAsChatID: &channelID,
		// отсюда кнопка «перейти к оригиналу»
		FwdFromChatID: &channelID, FwdFromMsgID: &postID, FwdDate: &date,
		IsDiscussionMirror: true,
	})
	return err
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
