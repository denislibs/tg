package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// EnableDiscussion attaches a discussion group to a channel so its posts can
// receive threaded comments. Requires RightChangeInfo on the channel. Idempotent:
// if a discussion group already exists it is returned unchanged. Otherwise a new
// "group" chat is created (actor = creator) and linked via chats.discussion_chat_id.
func (i *Interactor) EnableDiscussion(ctx context.Context, channelID, actorID int64) (int64, error) {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil {
		return 0, err
	}
	if cur, _ := i.groups.GetDiscussion(ctx, channelID); cur != 0 {
		return cur, nil
	}
	var gid int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, actorID)
		if e != nil {
			return e
		}
		if e := i.groups.AddMember(ctx, id, actorID, domain.RoleCreator, domain.AllRights); e != nil {
			return e
		}
		if e := i.groups.SetDiscussion(ctx, channelID, id); e != nil {
			return e
		}
		gid = id
		return nil
	})
	if err != nil {
		return 0, err
	}
	return gid, nil
}

// LinkDiscussion attaches an existing group as the channel's discussion group
// (Telegram channels.setDiscussionGroup). The actor must hold RightChangeInfo on
// the channel AND be creator/admin of the group. The group must be a plain
// 'group' (not a forum) and not already linked as some channel's discussion
// group. Returns the linked group id.
func (i *Interactor) LinkDiscussion(ctx context.Context, channelID, groupID, actorID int64) (int64, error) {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil {
		return 0, err
	}
	card, err := i.groups.Card(ctx, groupID, actorID)
	if err != nil {
		return 0, err
	}
	if card.Type != "group" {
		return 0, domain.ErrForbidden
	}
	if card.MyRole != domain.RoleCreator && card.MyRole != domain.RoleAdmin {
		return 0, domain.ErrForbidden
	}
	if forum, e := i.groups.IsForum(ctx, groupID); e != nil {
		return 0, e
	} else if forum {
		return 0, domain.ErrForbidden
	}
	if linked, e := i.groups.IsDiscussionGroup(ctx, groupID); e != nil {
		return 0, e
	} else if linked {
		return 0, domain.ErrForbidden
	}
	if err := i.groups.SetDiscussion(ctx, channelID, groupID); err != nil {
		return 0, err
	}
	return groupID, nil
}

// UnlinkDiscussion detaches the channel's discussion group. Requires
// RightChangeInfo on the channel.
func (i *Interactor) UnlinkDiscussion(ctx context.Context, channelID, actorID int64) error {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.groups.SetDiscussion(ctx, channelID, 0)
}

// DiscussionCandidates lists the groups the actor may link as a discussion group
// (non-forum 'group' chats they own/administer that aren't already linked).
func (i *Interactor) DiscussionCandidates(ctx context.Context, actorID int64) ([]domain.ChatCard, error) {
	return i.groups.DiscussionCandidates(ctx, actorID)
}

// PostComment posts a comment on a channel post. Тред живёт не на самом посте, а
// на его зеркале в группе обсуждения (комментарии — обычные сообщения группы),
// поэтому ThreadRootID — id зеркала, а не id поста. Returns domain.ErrNotFound,
// если обсуждения выключены ЛИБО постId не резолвится в реальный пост этого
// канала (тредить действительно некуда). The commenter is auto-joined to the
// discussion group (idempotent) before posting.
func (i *Interactor) PostComment(ctx context.Context, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error) {
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return domain.Message{}, domain.ErrNotFound
	}
	root, err := i.msgs.MirrorByPost(ctx, channelID, postID)
	if err != nil {
		return domain.Message{}, err
	}
	if root == 0 {
		// Зеркала может не быть не потому, что поста нет, а потому, что пост
		// опубликовали ДО EnableDiscussion/LinkDiscussion: на вставке
		// mirrorChannelPost — no-op без привязанного обсуждения (GetDiscussion
		// тогда возвращал 0), и взяться зеркалу больше неоткуда. Комментировать
		// такие старые посты Telegram позволяет, поэтому дозаводим зеркало по
		// требованию первого комментария, а не хороним тред навсегда (см.
		// lazyMirrorPost — тот же путь использует ResolveThreadRootForSend
		// для generic-записи, чтобы не плодить вторую копию этой логики).
		root, err = i.lazyMirrorPost(ctx, channelID, postID)
		if err != nil {
			return domain.Message{}, err
		}
		if root == 0 {
			return domain.Message{}, domain.ErrNotFound
		}
	}
	_ = i.groups.AddMember(ctx, disc, userID, domain.RoleMember, 0) // auto-join (idempotent)
	return i.Send(ctx, SendInput{
		ChatID: disc, SenderID: userID, Type: "text", Text: text,
		ClientMsgID: clientMsgID, ThreadRootID: &root,
	})
}

// lazyMirrorPost дозаводит зеркало поста, опубликованного ДО
// EnableDiscussion/LinkDiscussion (на вставке mirrorChannelPost был no-op
// без привязанного обсуждения, взяться зеркалу больше неоткуда). Общий путь
// для PostComment (комментарий через штатный эндпоинт) И
// ResolveThreadRootForSend (generic-запись в тред с thread_root_id = id
// такого домиграционного поста, см. её комментарий про блокер с sentinel
// 0) — вынесен именно затем, чтобы у ленивой дозаводки было ровно одно
// место, а не по копии на каждого потребителя.
//
// Возвращает id корня треда (зеркала) или 0, если дозавести действительно
// нечего (поста нет / чужой канал / удалён) либо гонка проиграна без
// зацепившегося корня — в этом случае err может быть nil (пост не найден,
// не ошибка) или содержать реальный сбой создания зеркала; вызывающий сам
// решает, во что это мапить (PostComment и ResolveThreadRootForSend — оба в
// domain.ErrNotFound, но с разной семантикой снаружи).
func (i *Interactor) lazyMirrorPost(ctx context.Context, channelID, postID int64) (int64, error) {
	post, e := i.msgs.GetByID(ctx, postID)
	if e != nil || post.ChatID != channelID || post.Deleted {
		return 0, nil
	}
	// Если пост — элемент альбома (grouped_id), дозеркалировать нужно ВЕСЬ
	// альбом, а не только элемент, на который комментирует клиент: корень
	// треда — зеркало ПЕРВОГО элемента группы (см. MirrorByPost / правило
	// «один тред на альбом», Task 7), а MirrorByPost для ЛЮБОГО элемента
	// резолвит именно его. Если бы здесь зеркалился только переданный
	// postID, MirrorByPost(postID) после этого продолжил бы искать зеркало
	// ДРУГОГО (первого) элемента, которого нет, — root остался бы 0, а в
	// группе повисла бы осиротевшая строка-зеркало без единого потребителя.
	// Зеркалируем все элементы best-effort (ошибка на одном — не повод
	// обрывать остальные, см. про гонку ниже).
	var createErr error
	// Зовём здесь БЕЗ окружающей транзакции (в отличие от PostToChannel/
	// Send/ForwardMessages/publishApprovedPost) — каждый вызов
	// mirrorChannelPost уже сам довозит зеркало до pts-лога/unread внутри
	// СВОЕЙ отдельной транзакции (WithinTx внутри репозиториев по одному
	// insert/update — автокоммит per-statement вне явной tx), так что
	// публикация (кадры/кэш) идёт СРАЗУ по возврату, а не после какого-то
	// внешнего коммита, которого тут нет.
	if post.GroupedID != nil {
		album, e := i.msgs.AlbumMessages(ctx, channelID, *post.GroupedID)
		if e != nil {
			return 0, e
		}
		for _, m := range album {
			md, e := i.mirrorChannelPost(ctx, m)
			if e != nil && createErr == nil {
				createErr = e
			}
			if md != nil {
				i.publishMessageDelivery(ctx, md.msg, nil, md.msg.SenderID, md.recipients, md.ptsByUser, md.unreadByUser)
			}
		}
	} else {
		md, e := i.mirrorChannelPost(ctx, post)
		createErr = e
		if md != nil {
			i.publishMessageDelivery(ctx, md.msg, nil, md.msg.SenderID, md.recipients, md.ptsByUser, md.unreadByUser)
		}
	}
	// Гонка: два параллельных первых обращения к одному немигрированному
	// посту (или альбому) оба увидят, что зеркала нет, и оба попробуют его
	// создать. Проигравший падает на уникальном индексе
	// uq_messages_discussion_mirror по каждому элементу, где его обогнали —
	// createErr тут не «поста нет», а «кто-то уже создал зеркало
	// параллельно». Резолвим ещё раз и берём то, что уже есть в базе;
	// createErr отдаём наружу, только если корня и правда нет (значит,
	// ошибка реальная, а не проигрыш гонки) — не глушим её молча.
	root, err := i.msgs.MirrorByPost(ctx, channelID, postID)
	if err != nil {
		return 0, err
	}
	if root == 0 && createErr != nil {
		return 0, createErr
	}
	return root, nil
}

// ListComments returns the comment thread (ascending) for a channel post plus the
// total comment count. Читает по id зеркала поста (см. PostComment), внешне
// вызывающий по-прежнему адресует пост парой (канал, postID). domain.ErrNotFound
// если обсуждения выключены; без зеркала — пустой тред без ошибки (тред у поста
// ещё не появился, это не сбой).
func (i *Interactor) ListComments(ctx context.Context, channelID, postID, userID int64, offset, limit int) ([]domain.Message, int, error) {
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return nil, 0, domain.ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	root, err := i.msgs.MirrorByPost(ctx, channelID, postID)
	if err != nil {
		return nil, 0, err
	}
	if root == 0 {
		return nil, 0, nil
	}
	msgs, err := i.msgs.ListThread(ctx, disc, root, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	cnt, err := i.msgs.CountThread(ctx, disc, root)
	return msgs, cnt, err
}

// RecentRepliersLimit — сколько аватаров показывает футер «N комментариев»
// (Telegram рисует стек последних комментаторов).
const RecentRepliersLimit = 3

// CommentCounts returns a postID -> comment count map for the given posts plus
// the authors of each thread's latest comments (newest first, up to
// RecentRepliersLimit distinct). Тред живёт на зеркале поста (см. PostComment),
// поэтому счёт и авторов читаем по id зеркал — но ключи обоих результатов
// остаются id ПОСТОВ: внешний HTTP-контракт про пару (канал, пост) не меняется,
// зеркало — деталь реализации треда. Посты без зеркала просто не набирают
// комментариев (out[postID] остаётся нулевым значением карты). When discussions
// aren't enabled it returns empty maps (no error).
func (i *Interactor) CommentCounts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]int, map[int64][]domain.UserCard, error) {
	out := map[int64]int{}
	empty := map[int64][]domain.UserCard{}
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return out, empty, nil
	}
	// один батч-запрос на все посты вместо резолва зеркала по одному
	mirrors, err := i.msgs.MirrorsByPosts(ctx, channelID, postIDs)
	if err != nil {
		return out, empty, err
	}
	// обратная карта — вернуть найденное по root к id поста для ключей результата
	postByRoot := make(map[int64]int64, len(mirrors))
	roots := make([]int64, 0, len(mirrors))
	for postID, root := range mirrors {
		postByRoot[root] = postID
		roots = append(roots, root)
	}
	for postID, root := range mirrors {
		c, _ := i.msgs.CountThread(ctx, disc, root)
		out[postID] = c
	}
	recent, err := i.msgs.RecentThreadRepliers(ctx, disc, roots, RecentRepliersLimit)
	if err != nil {
		return out, empty, err
	}
	// Карточки комментаторов тянем одним запросом: клиенту нужны имя и аватар,
	// а не голые id (иначе стек аватаров пришлось бы дорезолвливать по одному).
	seen := map[int64]bool{}
	ids := make([]int64, 0, len(recent)*RecentRepliersLimit)
	for _, users := range recent {
		for _, u := range users {
			if !seen[u] {
				seen[u] = true
				ids = append(ids, u)
			}
		}
	}
	cards, err := i.groups.UsersByIDs(ctx, ids)
	if err != nil {
		return out, empty, err
	}
	byID := make(map[int64]domain.UserCard, len(cards))
	for _, c := range cards {
		byID[c.ID] = c
	}
	res := make(map[int64][]domain.UserCard, len(recent))
	for root, users := range recent {
		postID := postByRoot[root]
		for _, u := range users {
			// та же деградация, что и у userCard() (group.go): не нашли карточку —
			// отдаём голый id, а не молча теряем комментатора из стека.
			c, ok := byID[u]
			if !ok {
				c = domain.UserCard{ID: u}
			}
			res[postID] = append(res[postID], c)
		}
	}
	return out, res, nil
}

// ViewCounts returns the current view count for each of the given channel post
// ids (Telegram's "9.2K 👁"). Non-channel messages report 0. Mirrors the
// commentCounts read path — the client fetches these per open to stay fresh.
func (i *Interactor) ViewCounts(ctx context.Context, postIDs []int64) (map[int64]int64, error) {
	return i.msgs.ViewCounts(ctx, postIDs)
}
