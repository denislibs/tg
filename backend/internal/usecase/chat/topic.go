package chat

import (
	"context"
	"errors"
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

// MarkTopicRead помечает тему прочитанной до upToSeq (Telegram readDiscussion
// с threadId): поднимает персональный last_read_seq темы. Тема — номером
// (General — 1). Кадров и пересчёта чата здесь нет — это волна 2 (БЭК-2).
func (i *Interactor) MarkTopicRead(ctx context.Context, chatID, number, userID, upToSeq int64) error {
	t, err := i.memberTopic(ctx, chatID, number, userID)
	if err != nil {
		return err
	}
	return i.topics.SetTopicRead(ctx, chatID, t.RootMsgID, userID, upToSeq)
}

// SetTopicMuteUntil заглушает тему для пользователя до срока muteUntil
// (unix-секунды, как peerNotifySettings.mute_until: domain.MuteUntilNever или
// прошедшее время — снять, domain.MuteUntilForever — навсегда). Порт
// account.updateNotifySettings с inputNotifyForumTopic (tweb
// appMessagesManager.ts:11962-11981).
//
// Своим устройствам уходит updateNotifySettings с адресом notifyForumTopic
// (tweb :11751-11770) — мьют личный, остальным участникам кадра нет.
func (i *Interactor) SetTopicMuteUntil(ctx context.Context, chatID, number, userID int64, muteUntil int64) error {
	t, err := i.memberTopic(ctx, chatID, number, userID)
	if err != nil {
		return err
	}
	now := time.Now()
	var until *time.Time
	if at := time.Unix(muteUntil, 0); muteUntil > domain.MuteUntilNever && at.After(now) {
		until = &at
	}
	if err := i.topics.SetTopicMuteUntil(ctx, chatID, t.RootMsgID, userID, until); err != nil {
		return err
	}
	settings := domain.TopicNotifySettings(until, now)
	topicID := t.Number()
	// best-effort: мутация закоммичена — сбой лога/публикации не возвращаем.
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "topic_mute",
		func(peer domain.PeerID) map[string]any {
			return map[string]any{
				"_":               domain.UpdateNotifySettingsTag,
				"peer":            domain.NewNotifyForumTopic(domain.NewPeer(peer), topicID),
				"notify_settings": settings,
			}
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

// canManageTopic — порт tweb dialogsStorage.canManageTopic: своя тема
// (pFlags.my) или право manage_topics (у владельца — всегда). Управлять темами
// чата можно только из чата: вышедший автор свою тему больше не правит.
func (i *Interactor) canManageTopic(ctx context.Context, t domain.ForumTopicRecord, userID int64) bool {
	if i.groups == nil {
		return false
	}
	m, err := i.groups.GetMember(ctx, t.ChatID, userID)
	if err != nil {
		return false
	}
	return t.CreatedBy == userID || domain.HasRight(m.Role, m.Rights, domain.RightManageTopics)
}

// checkTopicOpen — в закрытую тему пишет только тот, кто ей управляет (tweb
// canSendToPeer: closed ∧ ¬canManageTopic → нельзя). Служебные сообщения
// сервера (in.Action) не гейтятся.
func (i *Interactor) checkTopicOpen(ctx context.Context, in SendInput) error {
	if in.ThreadRootID == nil || in.Action != nil || i.topics == nil {
		return nil
	}
	t, err := i.topics.ByRoot(ctx, in.ChatID, *in.ThreadRootID)
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
// (tweb dialogs.ts:2270). У General нельзя закрыть и сменить значок (у неё
// системная иконка); название и скрытие — можно.
func (i *Interactor) EditTopic(ctx context.Context, chatID, number, userID int64, in TopicEdit) (*domain.Message, error) {
	t, err := i.topicByNumber(ctx, chatID, number)
	if err != nil {
		return nil, err
	}
	if !i.canManageTopic(ctx, t, userID) {
		return nil, domain.ErrForbidden
	}
	if t.IsGeneral && (in.Closed != nil || in.IconEmoji != nil) {
		return nil, domain.ErrForbidden
	}
	action := domain.NewMessageActionTopicEdit()
	next := t
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" || utf8.RuneCountInString(title) > maxTopicTitle {
			return nil, domain.ErrTooLong
		}
		if title != t.Title {
			next.Title, action.Title = title, &title
		}
	}
	if in.IconEmoji != nil {
		if emoji := sanitizeTopicEmoji(*in.IconEmoji); emoji != t.IconEmoji {
			next.IconEmoji, action.IconEmojiEmoticon = emoji, &emoji
		}
	}
	if in.Closed != nil && *in.Closed != t.Closed {
		closed := *in.Closed
		next.Closed, action.Closed = closed, &closed
	}
	if in.Hidden != nil && *in.Hidden != t.Hidden {
		hidden := *in.Hidden
		next.Hidden, action.Hidden = hidden, &hidden
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
			return i.topics.Update(ctx, next)
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
	if err := i.topics.SetPinned(ctx, t.ID, pinned); err != nil {
		return domain.UpdatePinnedForumTopic{}, err
	}
	topicID := t.Number()
	if members, err := i.chats.MemberIDs(ctx, chatID); err == nil {
		// best-effort: мутация закоммичена.
		_ = i.logAndPublishPerPeer(ctx, chatID, members, "topic_pin",
			func(peer domain.PeerID) map[string]any {
				body := map[string]any{
					"_":        domain.UpdatePinnedForumTopicTag,
					"peer":     domain.NewPeer(peer),
					"topic_id": topicID,
				}
				if pinned {
					body["pFlags"] = map[string]bool{"pinned": true}
				}
				return body
			})
	}
	peer, err := i.ChatIDToPeer(ctx, userID, chatID)
	if err != nil {
		return domain.UpdatePinnedForumTopic{}, err
	}
	return domain.NewUpdatePinnedForumTopic(domain.NewPeer(peer), topicID, pinned), nil
}

// ListThreadMessages — сообщения треда (форум-топика) по возрастанию.
func (i *Interactor) ListThreadMessages(ctx context.Context, chatID, rootID, userID int64, offset, limit int) ([]domain.Message, int, error) {
	if err := i.RequireChatRead(ctx, chatID, userID); err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
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
