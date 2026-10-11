package chat

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Форум-топики (Telegram forum topics): темы поверх тредовой механики
// thread_root_id. Корень темы — сервисное сообщение о создании; сообщения
// темы несут thread_root_id = root_msg_id и идут обычным Send (фан-аут штатный).
//
// Снаружи тема адресуется ОДНИМ числом — номером служебки создания в чате, у
// General — 1 (domain.ForumTopicRecord.Number; tweb appMessagesManager.ts:
// 10067, 10218 — `topic_id: getServerMessageId(topicId)`). Перевод номера в
// тему — одна функция, topicByNumber; внутренний ключ строки наружу не выходит.

const maxTopicTitle = 128

// SetForum включает/выключает темы у группы — только владелец (tweb hasRights
// 'toggle_forum': у не-создателя false).
func (i *Interactor) SetForum(ctx context.Context, chatID, actorID int64, enabled bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	if err := i.requireCreator(ctx, chatID, actorID); err != nil {
		return err
	}
	if err := i.groups.SetForum(ctx, chatID, enabled); err != nil {
		return err
	}
	if enabled {
		// При включении тем гарантируем системную тему «General» (как в tweb).
		if _, err := i.topics.EnsureGeneralTopic(ctx, chatID, actorID); err != nil {
			return err
		}
	}
	// Участники узнают о смене вида чата снимком канала — у оригинала это
	// updateChannel → перечитать канал → событие chat_toggle_forum
	// (tweb appChatsManager.ts:304-306, dialogs.ts:186-192).
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// CreateTopic создаёт тему: сервисное сообщение-корень + строка forum_topics.
// Возвращает и саму служебку: ответ messages.createForumTopic — Updates с ней,
// и номер темы клиент берёт из её id (tweb appMessagesManager.ts:10100-10101).
func (i *Interactor) CreateTopic(ctx context.Context, chatID, userID int64, title, iconEmoji string, iconColor int) (domain.ForumTopicRecord, domain.Message, error) {
	if i.topics == nil {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrNotFound
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTopicTitle {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrTooLong
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.ForumTopicRecord{}, domain.Message{}, err
	}
	if !ok {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrNotFound
	}
	// Тема бывает только у форума (channels.createForumTopic у не-форума —
	// CHANNEL_FORUM_MISSING), и создать её вправе тот, кому hasRights
	// 'manage_topics': админ — по своему биту, участник — если тема не
	// запрещена правами чата. Отдельного запрета тем у участника у нас нет,
	// поэтому участника гейтит отправка (userAction ниже: запрет писать,
	// личное ограничение, медленный режим).
	if i.groups == nil {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrNotFound
	}
	if forum, e := i.groups.IsForum(ctx, chatID); e != nil {
		return domain.ForumTopicRecord{}, domain.Message{}, e
	} else if !forum {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrForbidden
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ForumTopicRecord{}, domain.Message{}, err
	}
	if (m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin) &&
		!domain.HasRight(m.Role, m.Rights, domain.RightManageTopics) {
		return domain.ForumTopicRecord{}, domain.Message{}, domain.ErrForbidden
	}
	if iconColor < 0 {
		iconColor = 0
	}
	// Корень темы — messageActionTopicCreate. Прежде это было ЕДИНСТВЕННОЕ
	// служебное сообщение, чей текст даже не JSON, а готовая русская фраза с
	// уже вклеенным именем автора («%s создал(а) тему «%s»») — склейка имени в
	// самом чистом виде. Имя теперь собирает клиент из from_id, название темы
	// едет параметром title.
	iconEmoji = sanitizeTopicEmoji(iconEmoji)
	root, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: userID,
		Action:     domain.NewMessageActionTopicCreate(title, iconColor, iconEmoji),
		userAction: true,
		prepare: func(ctx context.Context, _ *SendInput) error {
			return i.reserveGeneralNumber(ctx, chatID)
		},
	})
	if err != nil {
		return domain.ForumTopicRecord{}, domain.Message{}, err
	}
	t, err := i.topics.Create(ctx, domain.ForumTopicRecord{
		ChatID: chatID, RootMsgID: root.ID, RootMsgSeq: root.Seq, Title: title, IconColor: iconColor,
		IconEmoji: iconEmoji, CreatedBy: userID,
	})
	if err != nil {
		return domain.ForumTopicRecord{}, domain.Message{}, err
	}
	return t, root, nil
}

// reserveGeneralNumber — номер 1 в форуме занят General
// (domain.GeneralTopicID): у TG сообщение №1 — служебка создания канала, и
// служебка темы получить его не может. У нас служебка создания чата не
// гарантирована (её запись best-effort, у старых чатов её может не быть), и в
// чате без единого сообщения служебка темы стала бы №1 — неотличимой от
// General. Тогда номер 1 пропускается: дыра в нумерации — то же, что удалённое
// сообщение. Зовётся в транзакции Send до выдачи номера.
func (i *Interactor) reserveGeneralNumber(ctx context.Context, chatID int64) error {
	last, err := i.chats.MaxSeq(ctx, chatID)
	if err != nil || last >= domain.GeneralTopicID {
		return err
	}
	_, err = i.msgs.NextSeq(ctx, chatID)
	return err
}

// pushTopicRoot — ключ корня темы сообщения для пуш-гейта (мьют темы):
// корень его треда, а у служебки создания темы — она сама: служебка
// принадлежит своей теме, не General (tweb getMessageThreadId.ts:20-21).
func pushTopicRoot(msg domain.Message) int64 {
	if _, ok := msg.Action.(domain.MessageActionTopicCreate); ok {
		return msg.ID
	}
	if msg.ThreadRootID != nil {
		return *msg.ThreadRootID
	}
	return 0
}

// sanitizeTopicEmoji ограничивает иконку темы коротким unicode-emoji (без custom-emoji
// инфраструктуры): режем по рунам, чтобы не хранить произвольный текст.
func sanitizeTopicEmoji(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 8 {
		return ""
	}
	return s
}

// ListTopics — темы чата тому, кто его читает (RequireChatRead: публичный
// форум читается и без вступления), свежие сверху.
func (i *Interactor) ListTopics(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error) {
	if i.topics == nil {
		return nil, nil
	}
	if err := i.RequireChatRead(ctx, chatID, userID); err != nil {
		return nil, err
	}
	return i.topics.ListByChat(ctx, chatID, userID)
}

// topicByNumber — тема по номеру снаружи (domain.ForumTopicRecord.Number):
// номер служебки создания в чате, у General — 1. Единственный перевод
// «номер → тема» для ручек тем; ключом строки темы клиент не адресует ничего.
func (i *Interactor) topicByNumber(ctx context.Context, chatID, number int64) (domain.ForumTopicRecord, error) {
	if i.topics == nil {
		return domain.ForumTopicRecord{}, domain.ErrNotFound
	}
	return i.topics.ByNumber(ctx, chatID, number)
}

// ReadDiscussion — порт messages.readDiscussion (tweb readHistory с threadId,
// appMessagesManager.ts:9186-9210): тред number прочитан до readMaxID. Тред —
// тема форума (General — 1), тред комментариев (номер зеркала) или тред
// сообщения в обычной группе. Двигается горизонт ТРЕДА, горизонт чата — нет.
//
// Эффект как у tweb onUpdateReadHistory (:10795-10990): гаснет непрочитанное
// этой темы (горизонт треда), снимаются упоминания треда до readMaxID — и в
// счётчике «@» чата (:10969-10980). У форума unread_count чата — сумма по
// темам (В-8 спецификации; tweb бейдж форума считает по темам сам,
// :14233-14249, серверный нужен пуш-бейджу) — пересчитывается.
//
// Кадры: своим устройствам — updateReadChannelDiscussionInbox; остальным, у
// кого вырос горизонт ✓✓ треда (MAX горизонтов остальных), —
// updateReadChannelDiscussionOutbox. Горизонт не вырос — ни записи, ни кадров.
//
// Читать тред может участник; не участник — только тред комментариев
// обсуждения, которое он читает (у него своя строка состояния треда).
func (i *Interactor) ReadDiscussion(ctx context.Context, chatID, number, userID, readMaxID int64) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	th, err := i.discussionThread(ctx, chatID, number, userID)
	if err != nil {
		return err
	}
	if last, e := i.chats.MaxSeq(ctx, chatID); e != nil {
		return e
	} else if readMaxID > last {
		readMaxID = last
	}
	var outbox []int64
	advanced := false
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		old, e := i.topics.ThreadHorizon(ctx, chatID, th.stateRoot, userID)
		if e != nil || readMaxID <= old {
			return e
		}
		advanced = true
		before, e := i.topics.ThreadHorizons(ctx, chatID, th.stateRoot)
		if e != nil {
			return e
		}
		outbox = outboxRaised(before, userID, readMaxID)
		if e := i.topics.SetTopicRead(ctx, chatID, th.stateRoot, userID, readMaxID); e != nil {
			return e
		}
		if _, e := i.topics.ClearThreadMentions(ctx, chatID, userID, th.filterRoot, readMaxID); e != nil {
			return e
		}
		if th.forum {
			if _, e := i.topics.RecountForumUnread(ctx, chatID, userID); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil || !advanced {
		return err
	}
	i.invalidateDialogs(ctx, userID)
	// best-effort: прочтение закоммичено — сбой лога/публикации не возвращаем.
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "read_discussion",
		func(peer domain.PeerID) map[string]any {
			return structPayload(domain.NewUpdateReadChannelDiscussionInbox(peer.ToChatID(), number, readMaxID))
		})
	_ = i.logAndPublishPerPeer(ctx, chatID, outbox, "read_discussion",
		func(peer domain.PeerID) map[string]any {
			return structPayload(domain.NewUpdateReadChannelDiscussionOutbox(peer.ToChatID(), number, readMaxID))
		})
	return nil
}

// countUnread — непрочитанное участника при горизонте чата readSeq для
// chat_members.unread_count. У форума — сумма по темам (у каждой свой горизонт
// треда, В-8 спецификации), иначе — сообщения выше горизонта чата; без
// лишнего запроса «форум ли» (CountChatUnread решает в одном SQL).
func (i *Interactor) countUnread(ctx context.Context, chatID, userID, readSeq int64) (int, error) {
	if i.topics != nil {
		return i.topics.CountChatUnread(ctx, chatID, userID, readSeq)
	}
	return i.msgs.CountUnread(ctx, chatID, userID, readSeq)
}

// outboxRaised — кому прочтение читателя reader до h подняло горизонт ✓✓
// треда: у получателя x это MAX горизонтов всех, кроме x. Читатель и так
// продвинулся (h > его прежнего), значит у x горизонт вырос ровно тогда, когда
// h выше горизонтов всех, кроме x и читателя. Возвращается по возрастанию.
func outboxRaised(horizons map[int64]int64, reader, h int64) []int64 {
	var top1, top2 int64 // два наибольших горизонта среди всех, кроме читателя
	var top1User int64
	for u, v := range horizons {
		if u == reader {
			continue
		}
		switch {
		case v > top1:
			top2, top1, top1User = top1, v, u
		case v > top2:
			top2 = v
		}
	}
	var out []int64
	for u := range horizons {
		if u == reader {
			continue
		}
		others := top1
		if u == top1User {
			others = top2
		}
		if h > others {
			out = append(out, u)
		}
	}
	slices.Sort(out)
	return out
}

// discussionThreadRef — тред прочтения: ключ строки состояния (у General — 0,
// как в topic_user_state) и корень для выборок (у General — страж).
type discussionThreadRef struct {
	stateRoot  int64
	filterRoot int64
	forum      bool
}

// discussionThread переводит номер треда в ключи и проверяет доступ: в
// форуме — тема, General или зеркало поста (requireForumThread, иначе
// TOPIC_ID_INVALID); вне форума — любое сообщение чата. Не участнику —
// только зеркало поста в группе обсуждения, которую он читает.
func (i *Interactor) discussionThread(ctx context.Context, chatID, number, userID int64) (discussionThreadRef, error) {
	member, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return discussionThreadRef{}, err
	}
	forum := i.groups != nil && i.isForum(ctx, chatID)
	if forum && number == domain.GeneralTopicID {
		if !member {
			return discussionThreadRef{}, domain.ErrNotFound
		}
		return discussionThreadRef{stateRoot: 0, filterRoot: domain.GeneralThreadRoot, forum: true}, nil
	}
	rootID, err := i.msgs.IDBySeq(ctx, chatID, number)
	if err != nil {
		return discussionThreadRef{}, err
	}
	if forum {
		if err := i.requireForumThread(ctx, chatID, rootID); err != nil {
			return discussionThreadRef{}, err
		}
	}
	if !member {
		if err := i.requireCommentsReader(ctx, chatID, rootID, userID); err != nil {
			return discussionThreadRef{}, err
		}
	}
	return discussionThreadRef{stateRoot: rootID, filterRoot: rootID, forum: forum}, nil
}

// requireCommentsReader — не участник читает тред rootID группы chatID только
// как тред комментариев: группа — обсуждение канала, он её читает
// (RequireDiscussionRead), корень — зеркало поста.
func (i *Interactor) requireCommentsReader(ctx context.Context, chatID, rootID, userID int64) error {
	if i.groups == nil {
		return domain.ErrNotFound
	}
	disc, err := i.groups.IsDiscussionGroup(ctx, chatID)
	if err != nil {
		return err
	}
	if !disc {
		return domain.ErrNotFound
	}
	if err := i.RequireDiscussionRead(ctx, chatID, userID); err != nil {
		return err
	}
	msgs, err := i.msgs.GetByIDs(ctx, []int64{rootID})
	if err != nil {
		return err
	}
	if len(msgs) != 1 || !msgs[0].IsDiscussionMirror {
		return domain.ErrNotFound
	}
	return nil
}

// SetTopicMuteUntil пишет настройку уведомлений темы пользователя — срок
// muteUntil (unix-секунды, как peerNotifySettings.mute_until). Порт
// account.updateNotifySettings с inputNotifyForumTopic (tweb mutePeer,
// appMessagesManager.ts:11962-11983): togglePeerMute шлёт 0 или MUTE_UNTIL
// (:11985-11991), меню «на срок» — срок.
//
// Запись ЯВНАЯ в обоих направлениях: 0 (и срок в прошлом) — «уведомлять»,
// даже если заглушён чат; после записи тема мьют чата больше не наследует
// (tweb appNotificationsManager.ts:398-405). Вернуть «наследовать» нечем —
// у tweb такого вызова нет.
//
// Своим устройствам уходит updateNotifySettings с адресом notifyForumTopic
// (tweb :11751-11770) — мьют личный, остальным участникам кадра нет.
func (i *Interactor) SetTopicMuteUntil(ctx context.Context, chatID, number, userID int64, muteUntil int64) error {
	t, err := i.memberTopic(ctx, chatID, number, userID)
	if err != nil {
		return err
	}
	now := time.Now()
	until := time.Unix(domain.MuteUntilNever, 0)
	if at := time.Unix(muteUntil, 0); at.After(now) {
		until = at
	}
	if err := i.topics.SetTopicMuteUntil(ctx, chatID, t.RootMsgID, userID, until); err != nil {
		return err
	}
	settings := domain.TopicNotifySettings(&until, now)
	topicID := t.Number()
	// best-effort: мутация закоммичена — сбой лога/публикации не возвращаем.
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "topic_mute",
		func(peer domain.PeerID) map[string]any {
			return structPayload(domain.NewUpdateTopicNotifySettings(domain.NewPeer(peer), topicID, settings))
		})
	return nil
}

// memberTopic — тема по номеру для участника чата (личное состояние темы —
// прочтение, мьют — ведётся только участнику).
func (i *Interactor) memberTopic(ctx context.Context, chatID, number, userID int64) (domain.ForumTopicRecord, error) {
	if i.topics == nil {
		return domain.ForumTopicRecord{}, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.ForumTopicRecord{}, err
	}
	if !ok {
		return domain.ForumTopicRecord{}, domain.ErrNotFound
	}
	return i.topicByNumber(ctx, chatID, number)
}

// canManageTopic — порт tweb dialogsStorage.canManageTopic (dialogs.ts:
// 2263-2283): своя тема (pFlags.my, domain.TopicMine) или право manage_topics
// (у владельца — всегда). Управлять темами чата можно только из чата:
// вышедший автор свою тему больше не правит.
func (i *Interactor) canManageTopic(ctx context.Context, t domain.ForumTopicRecord, userID int64) bool {
	if i.groups == nil {
		return false
	}
	m, err := i.groups.GetMember(ctx, t.ChatID, userID)
	if err != nil {
		return false
	}
	return domain.TopicMine(t, userID) || domain.HasRight(m.Role, m.Rights, domain.RightManageTopics)
}

// checkTopicOpen — в закрытую тему пишет только тот, кто ей управляет (tweb
// canSendToPeer: closed ∧ ¬canManageTopic → нельзя). Служебные сообщения
// сервера (in.Action) не гейтятся. Без треда в форуме — General: её тоже
// закрывают (tweb dialogsContextMenu.ts:403-415 не исключает General).
// maybeForum — чат может быть форумом (группа): только тогда General
// спрашивается у хранилища, личка и канал лишнего запроса не платят.
func (i *Interactor) checkTopicOpen(ctx context.Context, in SendInput, maybeForum bool) error {
	if in.Action != nil || i.topics == nil {
		return nil
	}
	var t domain.ForumTopicRecord
	var err error
	if in.ThreadRootID == nil {
		if !maybeForum || !i.isGeneralNumber(ctx, in.ChatID, domain.GeneralTopicID) {
			return nil // не форум — General нет
		}
		t, err = i.topics.ByNumber(ctx, in.ChatID, domain.GeneralTopicID)
	} else {
		t, err = i.topics.ByRoot(ctx, in.ChatID, *in.ThreadRootID)
	}
	if errors.Is(err, domain.ErrNotFound) {
		return nil // тред — не тема форума
	}
	if err != nil {
		return err
	}
	if t.Closed && !i.canManageTopic(ctx, t, in.SenderID) {
		return domain.ErrForbidden
	}
	return nil
}

// TopicEdit — правка темы (messages.editForumTopic): каждое поле
// необязательно, nil — не менять. IconEmoji "" — снять значок.
type TopicEdit struct {
	Title     *string
	IconEmoji *string
	Closed    *bool
	Hidden    *bool
}

// EditTopic — порт messages.editForumTopic (tweb appMessagesManager.ts:
// 10057-10075): одна служебка messageActionTopicEdit со ВСЕМИ изменёнными
// полями ложится в саму тему (у General — без треда), строка темы правится в
// той же транзакции (prepare), участники получают служебку обычным веером —
// и правят строку темы по ней (tweb :10342-10365).
//
// Ничего не изменилось — служебки нет, ответ nil. Права — canManageTopic
// (tweb dialogs.ts:2263-2283). General — как в tweb: закрыть можно
// (dialogsContextMenu.ts:403-415), скрыть можно ТОЛЬКО её (:396-401), значка у
// неё нет — правка General шлёт пустой (editTopic.tsx:187-191), и только он
// принимается.
//
// Строка темы правится только по изменённым полям (Update с указателями
// служебки): параллельная правка другого поля не затирается снимком,
// прочитанным до транзакции.
func (i *Interactor) EditTopic(ctx context.Context, chatID, number, userID int64, in TopicEdit) (*domain.Message, error) {
	t, err := i.topicByNumber(ctx, chatID, number)
	if err != nil {
		return nil, err
	}
	if !i.canManageTopic(ctx, t, userID) {
		return nil, domain.ErrForbidden
	}
	if in.Hidden != nil && !t.IsGeneral {
		return nil, domain.ErrForbidden
	}
	action := domain.NewMessageActionTopicEdit()
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" || utf8.RuneCountInString(title) > maxTopicTitle {
			return nil, domain.ErrTooLong
		}
		if title != t.Title {
			action.Title = &title
		}
	}
	if in.IconEmoji != nil {
		emoji := sanitizeTopicEmoji(*in.IconEmoji)
		if t.IsGeneral && emoji != "" {
			return nil, domain.ErrForbidden
		}
		if emoji != t.IconEmoji {
			action.IconEmojiEmoticon = &emoji
		}
	}
	if in.Closed != nil && *in.Closed != t.Closed {
		closed := *in.Closed
		action.Closed = &closed
	}
	if in.Hidden != nil && *in.Hidden != t.Hidden {
		hidden := *in.Hidden
		action.Hidden = &hidden
	}
	if action.Empty() {
		return nil, nil
	}
	var root *int64
	if !t.IsGeneral {
		root = &t.RootMsgID
	}
	msg, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: userID,
		Action: action, ThreadRootID: root,
		userAction: true,
		prepare: func(ctx context.Context, _ *SendInput) error {
			return i.topics.Update(ctx, t.ID, action)
		},
	})
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

// SetTopicPinned закрепляет/открепляет тему — порт messages.
// updatePinnedForumTopic (tweb appMessagesManager.ts:10215-10223). Права —
// canManageTopic; General и так всегда первая — её не закрепляют.
//
// Закреп ОБЩИЙ (pFlags.pinned строки видят все), поэтому
// updatePinnedForumTopic уходит всем участникам: иначе у остальных список не
// переложится (tweb dialogs.ts:2480-2490). Служебки у закрепа нет — tweb
// строит её только для TopicCreate и TopicEdit. Возвращает тот же апдейт —
// ответ ручки.
func (i *Interactor) SetTopicPinned(ctx context.Context, chatID, number, userID int64, pinned bool) (domain.UpdatePinnedForumTopic, error) {
	t, err := i.topicByNumber(ctx, chatID, number)
	if err != nil {
		return domain.UpdatePinnedForumTopic{}, err
	}
	if t.IsGeneral || !i.canManageTopic(ctx, t, userID) {
		return domain.UpdatePinnedForumTopic{}, domain.ErrForbidden
	}
	topicID := t.Number()
	peer, err := i.ChatIDToPeer(ctx, userID, chatID)
	if err != nil {
		return domain.UpdatePinnedForumTopic{}, err
	}
	update := domain.NewUpdatePinnedForumTopic(domain.NewPeer(peer), topicID, pinned)
	if t.Pinned == pinned {
		return update, nil // уже так: ни записи, ни кадров
	}
	if err := i.topics.SetPinned(ctx, t.ID, pinned); err != nil {
		return domain.UpdatePinnedForumTopic{}, err
	}
	if members, err := i.chats.MemberIDs(ctx, chatID); err == nil {
		// best-effort: мутация закоммичена.
		_ = i.logAndPublishPerPeer(ctx, chatID, members, "topic_pin",
			func(peer domain.PeerID) map[string]any {
				return structPayload(domain.NewUpdatePinnedForumTopic(domain.NewPeer(peer), topicID, pinned))
			})
	}
	return update, nil
}

// ListThreadMessages — сообщения треда (темы форума, комментариев) по
// возрастанию. rootSeq — НОМЕР корня в чате; в форуме 1 — General
// (resolveThreadRootForQuery), её лента — сообщения без треда.
func (i *Interactor) ListThreadMessages(ctx context.Context, chatID, rootSeq, userID int64, offset, limit int) ([]domain.Message, int, error) {
	if err := i.RequireChatRead(ctx, chatID, userID); err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rootID := *i.resolveThreadRootForQuery(ctx, chatID, &rootSeq)
	if rootID == 0 {
		return nil, 0, domain.ErrNotFound // номера в чате нет
	}
	msgs, err := i.msgs.ListThread(ctx, chatID, userID, rootID, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	count, err := i.msgs.CountThread(ctx, chatID, rootID)
	if err != nil {
		return nil, 0, err
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return nil, 0, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	i.hydrateStarReactions(ctx, userID, msgs)
	return msgs, count, nil
}
