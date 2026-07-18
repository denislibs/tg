package chat

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Опросы (Telegram Poll): SendPoll создаёт опрос + сообщение типа 'poll';
// голоса/закрытие рассылаются участникам фреймом poll_update (updateMessagePoll).

const (
	maxPollQuestion = 255
	maxPollOption   = 100
	maxPollOptions  = 10
)

type SendPollInput struct {
	ChatID, SenderID int64
	Question         string
	Options          []string
	Anonymous        bool
	Multiple         bool
	Quiz             bool
	CorrectOption    *int
	ClientMsgID      string
}

// SendPoll валидирует и отправляет опрос: создаёт poll, затем сообщение через
// обычный Send (все проверки прав/приватности/slowmode — там же).
func (i *Interactor) SendPoll(ctx context.Context, in SendPollInput) (domain.Message, error) {
	if i.polls == nil {
		return domain.Message{}, domain.ErrNotFound
	}
	q := strings.TrimSpace(in.Question)
	if q == "" || utf8.RuneCountInString(q) > maxPollQuestion {
		return domain.Message{}, domain.ErrTooLong
	}
	opts := make([]string, 0, len(in.Options))
	for _, o := range in.Options {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if utf8.RuneCountInString(o) > maxPollOption {
			return domain.Message{}, domain.ErrTooLong
		}
		opts = append(opts, o)
	}
	if len(opts) < 2 || len(opts) > maxPollOptions {
		return domain.Message{}, domain.ErrTooLong
	}
	// Викторина: ровно один правильный вариант, мультивыбор исключён.
	if in.Quiz {
		if in.CorrectOption == nil || *in.CorrectOption < 0 || *in.CorrectOption >= len(opts) {
			return domain.Message{}, domain.ErrTooLong
		}
		in.Multiple = false
	} else {
		in.CorrectOption = nil
	}
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	p, err := i.polls.Create(ctx, domain.Poll{
		ChatID: in.ChatID, Question: q, Options: opts,
		Anonymous: in.Anonymous, Multiple: in.Multiple, Quiz: in.Quiz, CorrectOption: in.CorrectOption,
	})
	if err != nil {
		return domain.Message{}, err
	}
	msg, err := i.Send(ctx, SendInput{
		ChatID: in.ChatID, SenderID: in.SenderID, Type: "poll",
		ClientMsgID: in.ClientMsgID, PollID: &p.ID,
	})
	if err != nil {
		return domain.Message{}, err
	}
	if e := i.hydratePolls(ctx, in.SenderID, []domain.Message{msg}); e == nil && msg.PollID != nil {
		// hydratePolls работает по слайсу-копии — перечитываем для ответа
		if info, e2 := i.pollInfoFor(ctx, *msg.PollID, in.SenderID); e2 == nil {
			msg.Poll = &info
		}
	}
	return msg, nil
}

// VotePoll заменяет голос пользователя (пустой список = отзыв, не для викторин).
// Возвращает представление опроса для голосующего и рассылает участникам
// poll_update с агрегатами.
func (i *Interactor) VotePoll(ctx context.Context, pollID, userID int64, optionIdxs []int) (domain.PollInfo, error) {
	if i.polls == nil {
		return domain.PollInfo{}, domain.ErrNotFound
	}
	p, err := i.polls.ByID(ctx, pollID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	ok, err := i.chats.IsMember(ctx, p.ChatID, userID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	if !ok {
		return domain.PollInfo{}, domain.ErrNotFound
	}
	if p.Closed {
		return domain.PollInfo{}, domain.ErrForbidden
	}
	// валидация индексов
	seen := map[int]bool{}
	for _, idx := range optionIdxs {
		if idx < 0 || idx >= len(p.Options) || seen[idx] {
			return domain.PollInfo{}, domain.ErrForbidden
		}
		seen[idx] = true
	}
	if !p.Multiple && len(optionIdxs) > 1 {
		return domain.PollInfo{}, domain.ErrForbidden
	}
	if p.Quiz {
		// ответ в викторине финален: ни отзыва, ни переголосования
		if len(optionIdxs) != 1 {
			return domain.PollInfo{}, domain.ErrForbidden
		}
		voted, e := i.polls.HasVoted(ctx, pollID, userID)
		if e != nil {
			return domain.PollInfo{}, e
		}
		if voted {
			return domain.PollInfo{}, domain.ErrForbidden
		}
	}
	if err := i.polls.SetVotes(ctx, pollID, userID, optionIdxs); err != nil {
		return domain.PollInfo{}, err
	}
	info, err := i.pollInfoFor(ctx, pollID, userID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	i.publishPollUpdate(ctx, p.ChatID, pollID)
	return info, nil
}

// ClosePoll останавливает опрос (только автор сообщения-опроса или админ с
// правом удаления). После закрытия голосовать нельзя, викторина раскрывает ответ.
func (i *Interactor) ClosePoll(ctx context.Context, pollID, userID int64) error {
	if i.polls == nil {
		return domain.ErrNotFound
	}
	p, err := i.polls.ByID(ctx, pollID)
	if err != nil {
		return err
	}
	member, err := i.groups.GetMember(ctx, p.ChatID, userID)
	if err != nil {
		return domain.ErrNotFound
	}
	isAdmin := member.Role == "creator" || member.Role == "admin"
	if !isAdmin {
		// не админ — допускаем только автора опроса: ищем его сообщение
		// (опрос создаётся вместе с сообщением, sender там зафиксирован)
		author, e := i.pollAuthor(ctx, pollID)
		if e != nil || author != userID {
			return domain.ErrForbidden
		}
	}
	if err := i.polls.Close(ctx, pollID); err != nil {
		return err
	}
	i.publishPollUpdate(ctx, p.ChatID, pollID)
	return nil
}

// pollAuthor — отправитель сообщения с этим опросом.
func (i *Interactor) pollAuthor(ctx context.Context, pollID int64) (int64, error) {
	msgs, err := i.msgs.ByPollID(ctx, pollID)
	if err != nil {
		return 0, err
	}
	if len(msgs) == 0 {
		return 0, domain.ErrNotFound
	}
	return msgs[0].SenderID, nil
}

// pollInfoFor — представление опроса для зрителя; правильный ответ викторины
// скрыт, пока зритель не ответил и опрос не закрыт.
func (i *Interactor) pollInfoFor(ctx context.Context, pollID, viewerID int64) (domain.PollInfo, error) {
	info, err := i.polls.Info(ctx, pollID, viewerID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	if info.Quiz && !info.Closed && len(info.MyVotes) == 0 {
		info.CorrectOption = nil
	}
	return info, nil
}

// hydratePolls наполняет Message.Poll для сообщений типа 'poll' (per-viewer).
func (i *Interactor) hydratePolls(ctx context.Context, viewerID int64, msgs []domain.Message) error {
	if i.polls == nil {
		return nil
	}
	for idx := range msgs {
		if msgs[idx].PollID == nil {
			continue
		}
		info, err := i.pollInfoFor(ctx, *msgs[idx].PollID, viewerID)
		if err != nil {
			continue // опрос мог быть удалён — сообщение остаётся без него
		}
		msgs[idx].Poll = &info
	}
	return nil
}

// publishPollUpdate рассылает участникам чата агрегаты опроса (без MyVotes —
// свой выбор каждый клиент знает сам; correct_option скрыт как для
// непроголосовавшего зрителя).
func (i *Interactor) publishPollUpdate(ctx context.Context, chatID, pollID int64) {
	if i.publisher == nil {
		return
	}
	info, err := i.pollInfoFor(ctx, pollID, 0) // viewer 0 — «никто»: MyVotes пуст
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("poll_update", map[string]any{"chat_id": chatID, "poll": info})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
