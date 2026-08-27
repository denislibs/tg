package chat

import (
	"context"
	"slices"

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
		id, e := i.groups.CreateMultiMember(ctx, domain.ChatTypeGroup, "Discussion", "", "", false, actorID)
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
	if card.Type != domain.ChatTypeGroup {
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
func (i *Interactor) DiscussionCandidates(ctx context.Context, actorID int64) ([]domain.ChatRecord, error) {
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
				i.publishMessageDelivery(ctx, md.msg, md.msg.SenderID, md.recipients, md.ptsByUser)
			}
		}
	} else {
		md, e := i.mirrorChannelPost(ctx, post)
		createErr = e
		if md != nil {
			i.publishMessageDelivery(ctx, md.msg, md.msg.SenderID, md.recipients, md.ptsByUser)
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

// publishPostReplies — счётчик комментариев поста канала изменился: кадр
// updateChannelMessageReplies в топик канала.
//
// Зовут её оба конца жизни комментария — приход (Send) и снятие
// (DeleteMessage), — и оба отдают ей САМ комментарий: «а был ли это вообще
// комментарий» решает она, по корню треда, а не место вызова. У оригинала
// ровно так же: одна updateMessageRepliesIfNeeded с признаком add на оба
// случая (tweb appMessagesManager.ts:8658-8680).
//
// Счётчик едет АБСОЛЮТНЫЙ (пересчитанный), а не «плюс один»: кадр в топик
// канала доставляется без курсора и без догона разрыва, поэтому дифф,
// потерянный подписчиком, разошёлся бы с истиной навсегда. У оригинала дифф
// допустим потому, что клиенту видна вся группа обсуждения целиком.
//
// Best-effort и после коммита: счётчик комментариев не имеет права ни уронить
// отправку, ни уехать раньше, чем сам комментарий доступен на чтение.
func (i *Interactor) publishPostReplies(ctx context.Context, comment domain.Message) {
	if i.chPub == nil || i.msgs == nil || comment.ThreadRootID == nil {
		return
	}
	// Корень треда — ЗЕРКАЛО поста в группе обсуждения (см. PostComment).
	// Тред форум-топика сюда не долетает: у его корня зеркальных полей нет.
	root, err := i.msgs.GetByID(ctx, *comment.ThreadRootID)
	if err != nil || !root.IsDiscussionMirror || root.FwdFromChatID == nil || root.FwdFromMsgID == nil {
		return
	}
	channelID, postID := *root.FwdFromChatID, *root.FwdFromMsgID
	counts, err := i.msgs.ThreadReplyCounts(ctx, comment.ChatID, []int64{root.ID})
	if err != nil {
		return
	}
	// Пост адресуется НОМЕРОМ в канале — тем же, что и во всех остальных
	// кадрах; ключ строки наружу не выходит.
	seqByID, err := i.msgs.SeqsByIDs(ctx, []int64{postID})
	if err != nil {
		return
	}
	seq, ok := seqByID[postID]
	if !ok {
		return // пост удалили — комментировать больше нечего
	}
	_ = i.chPub.PublishToChannel(ctx, channelID,
		frame("replies_update", domain.NewUpdateChannelMessageReplies(channelID, seq, int64(counts[root.ID]))))
}

// RecentRepliersLimit — сколько аватаров показывает футер «N комментариев»
// (Telegram рисует стек последних комментаторов).
const RecentRepliersLimit = 3

// CommentCounts — тред комментариев каждого поста конструктором
// messageReplies плюс ОБЩИЙ вектор карточек авторов последних комментариев.
//
// Прежде это была одиннадцатая проводная форма сообщения: {counts, recent_repliers},
// где карточка пользователя ехала ВКЛЕЕННОЙ в каждый пост — тот же дубликат, что
// чинил контейнер диалогов. В схеме messageReplies.recent_repliers это
// Vector<Peer>, то есть ССЫЛКИ, а тела пиров едут своим вектором users один раз.
//
// Тред живёт на зеркале поста (см. PostComment), поэтому счёт и авторов читаем
// по id зеркал — но ключи результата остаются НОМЕРАМИ ПОСТОВ: внешний контракт
// про пару (канал, пост) не меняется, зеркало — деталь реализации треда. Посты
// без зеркала комментариев не набирают. Обсуждение не включено — пустой
// результат без ошибки.
func (i *Interactor) CommentCounts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]domain.MessageReplies, []domain.UserReal, error) {
	out := map[int64]domain.MessageReplies{}
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return out, nil, nil
	}
	// один батч-запрос на все посты вместо резолва зеркала по одному
	mirrors, err := i.msgs.MirrorsByPosts(ctx, channelID, postIDs)
	if err != nil {
		return out, nil, err
	}
	roots := make([]int64, 0, len(mirrors))
	for _, root := range mirrors {
		roots = append(roots, root)
	}
	recent, err := i.msgs.RecentThreadRepliers(ctx, disc, roots, RecentRepliersLimit)
	if err != nil {
		return out, nil, err
	}
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
	// Карточки комментаторов — ОДНИМ вектором на весь ответ.
	cards, err := i.groups.UsersByIDs(ctx, ids)
	if err != nil {
		return out, nil, err
	}
	byID := make(map[int64]bool, len(cards))
	for _, c := range cards {
		byID[c.ID] = true
	}
	for _, u := range ids {
		if !byID[u] {
			// та же деградация, что и у userCard() (group.go): карточки нет —
			// отдаём голую, а не молча теряем комментатора из стека.
			cards = append(cards, domain.NewUser(u, domain.UserFlags{}))
		}
	}
	// Счёт — ОДНИМ запросом на все треды пачки: поштучный CountThread в этом
	// цикле давал запрос на каждый пост страницы.
	counts, err := i.msgs.ThreadReplyCounts(ctx, disc, roots)
	if err != nil {
		return out, nil, err
	}
	for postID, root := range mirrors {
		c := counts[root]
		peers := make([]domain.Peer, 0, RecentRepliersLimit)
		for _, u := range recent[root] {
			peers = append(peers, domain.NewPeerUser(u))
		}
		out[postID] = domain.NewMessageReplies(c, disc, peers)
	}
	return out, cards, nil
}

// ViewCounts returns the current view count for each of the given channel post
// ids (Telegram's "9.2K 👁"). Non-channel messages report 0. Mirrors the
// commentCounts read path — the client fetches these per open to stay fresh.
func (i *Interactor) ViewCounts(ctx context.Context, postIDs []int64) (map[int64]int64, error) {
	return i.msgs.ViewCounts(ctx, postIDs)
}

// RegisterViews — РЕГИСТРАЦИЯ просмотра перечисленных постов зрителем, а не
// чтение счётчика: считанные посты уезжают в message_views, счётчик поста
// растёт (один раз на пару «пост + зритель»), а тем, у кого канал открыт,
// уезжает кадр updateChannelMessageViews.
//
// Почему СПИСКОМ, а не горизонтом прочтения (RegisterChannelViews на
// MarkRead). Лента знает ровно то, какие посты ПОКАЗАЛИСЬ на экране, — их
// собирает интерсектор; горизонта у канала при этом может не быть вовсе
// (подписчик пролистал ленту, ничего не «прочитав»). Это же деление делает
// оригинал: прочтение — messages.readHistory, а регистрация просмотра —
// messages.getMessagesViews с increment:true по списку видимых номеров
// (tweb appMessagesManager.ts:9136-9156, сбор списка — bubbles.ts:2129-2147,
// дебаунс 1 с).
//
// Отдаёт СВЕЖИЕ счётчики всех запрошенных постов, а не только выросших:
// вызывающий получил их за тот же поход, и второй запрос на чтение ему не
// нужен — ровно как у оригинала, где ответ метода и есть новые значения.
//
// Кадр уезжает ТОЛЬКО про выросшие: повторный просмотр того же поста тем же
// зрителем ничего не меняет, и рассылать про него нечего.
func (i *Interactor) RegisterViews(ctx context.Context, channelID, viewerID int64, postIDs []int64) (map[int64]int64, error) {
	grown, err := i.msgs.RegisterPostViews(ctx, channelID, viewerID, postIDs)
	if err != nil {
		return nil, err
	}
	counts, err := i.msgs.ViewCounts(ctx, postIDs)
	if err != nil {
		return nil, err
	}
	i.publishViewCounts(ctx, channelID, grown)
	return counts, nil
}

// publishViewCounts — кадры о выросших счётчиках в ТОПИК канала (одна
// публикация на всех подписчиков, как у самого поста), best-effort: просмотры
// приближённы и не имеют права уронить их регистрацию.
//
// Номер поста, а не ключ строки: кадр адресует пост тем же числом, что и все
// остальные кадры (см. ExternalizeThreadRoots про пространства номеров).
func (i *Interactor) publishViewCounts(ctx context.Context, channelID int64, grown map[int64]int64) {
	if i.chPub == nil || len(grown) == 0 {
		return
	}
	ids := make([]int64, 0, len(grown))
	for id := range grown {
		ids = append(ids, id)
	}
	slices.Sort(ids) // порядок кадров детерминирован, а не по обходу карты
	seqByID, err := i.msgs.SeqsByIDs(ctx, ids)
	if err != nil {
		return
	}
	for _, id := range ids {
		seq, ok := seqByID[id]
		if !ok {
			continue // пост удалили между инкрементом и публикацией
		}
		_ = i.chPub.PublishToChannel(ctx, channelID,
			frame("views_update", domain.NewUpdateChannelMessageViews(channelID, seq, grown[id])))
	}
}
