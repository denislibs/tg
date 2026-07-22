package chat

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Чек-листы (Telegram todo list): SendChecklist создаёт чек-лист + сообщение
// типа 'checklist'; отметки/добавление пунктов рассылаются участникам фреймом
// checklist_update.

const (
	maxChecklistTitle = 255
	maxChecklistItem  = 255
	maxChecklistItems = 30
)

type SendChecklistInput struct {
	ChatID, SenderID int64
	Title            string
	Items            []string
	OthersCanAdd     bool
	OthersCanMark    bool
	ClientMsgID      string
}

// SendChecklist валидирует и отправляет чек-лист: создаёт checklist, затем
// сообщение через обычный Send (все проверки прав/приватности/slowmode — там же).
func (i *Interactor) SendChecklist(ctx context.Context, in SendChecklistInput) (domain.Message, error) {
	if i.checklists == nil {
		return domain.Message{}, domain.ErrNotFound
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || utf8.RuneCountInString(title) > maxChecklistTitle {
		return domain.Message{}, domain.ErrTooLong
	}
	items := make([]domain.ChecklistItem, 0, len(in.Items))
	for _, t := range in.Items {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if utf8.RuneCountInString(t) > maxChecklistItem {
			return domain.Message{}, domain.ErrTooLong
		}
		// id последовательные с 1 (Telegram todoItem: ids must be consecutive).
		items = append(items, domain.ChecklistItem{ID: len(items) + 1, Text: t})
	}
	if len(items) == 0 || len(items) > maxChecklistItems {
		return domain.Message{}, domain.ErrTooLong
	}
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	c, err := i.checklists.Create(ctx, domain.Checklist{
		ChatID: in.ChatID, Title: title, Items: items,
		OthersCanAdd: in.OthersCanAdd, OthersCanMark: in.OthersCanMark,
	})
	if err != nil {
		return domain.Message{}, err
	}
	msg, err := i.Send(ctx, SendInput{
		ChatID: in.ChatID, SenderID: in.SenderID, Type: "checklist",
		ClientMsgID: in.ClientMsgID, ChecklistID: &c.ID,
	})
	if err != nil {
		return domain.Message{}, err
	}
	if msg.ChecklistID != nil {
		if info, e := i.checklists.Info(ctx, *msg.ChecklistID); e == nil {
			msg.Checklist = &info
		}
	}
	return msg, nil
}

// ToggleChecklistItem переключает отметку «выполнено» на пункте. Отмечать может
// автор всегда; другие участники — только если others_can_mark. Возвращает
// обновлённое представление и рассылает участникам checklist_update.
func (i *Interactor) ToggleChecklistItem(ctx context.Context, checklistID int64, itemID int, userID int64) (domain.ChecklistInfo, error) {
	if i.checklists == nil {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	c, err := i.checklists.ByID(ctx, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	ok, err := i.chats.IsMember(ctx, c.ChatID, userID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	if !ok {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	if !itemExists(c.Items, itemID) {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	if !c.OthersCanMark {
		author, e := i.checklistAuthor(ctx, checklistID)
		if e != nil || author != userID {
			return domain.ChecklistInfo{}, domain.ErrForbidden
		}
	}
	if _, err := i.checklists.ToggleMark(ctx, checklistID, itemID, userID); err != nil {
		return domain.ChecklistInfo{}, err
	}
	info, err := i.checklists.Info(ctx, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	i.publishChecklistUpdate(ctx, c.ChatID, checklistID)
	return info, nil
}

// AddChecklistItems добавляет пункты. Добавлять может автор всегда; другие
// участники — только если others_can_add. Новым пунктам присваиваются id,
// продолжающие максимальный существующий.
func (i *Interactor) AddChecklistItems(ctx context.Context, checklistID, userID int64, texts []string) (domain.ChecklistInfo, error) {
	if i.checklists == nil {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	c, err := i.checklists.ByID(ctx, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	ok, err := i.chats.IsMember(ctx, c.ChatID, userID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	if !ok {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	if !c.OthersCanAdd {
		author, e := i.checklistAuthor(ctx, checklistID)
		if e != nil || author != userID {
			return domain.ChecklistInfo{}, domain.ErrForbidden
		}
	}
	maxID := 0
	for _, it := range c.Items {
		if it.ID > maxID {
			maxID = it.ID
		}
	}
	added := 0
	for _, t := range texts {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if utf8.RuneCountInString(t) > maxChecklistItem {
			return domain.ChecklistInfo{}, domain.ErrTooLong
		}
		maxID++
		c.Items = append(c.Items, domain.ChecklistItem{ID: maxID, Text: t})
		added++
	}
	if added == 0 {
		return domain.ChecklistInfo{}, domain.ErrTooLong
	}
	if len(c.Items) > maxChecklistItems {
		return domain.ChecklistInfo{}, domain.ErrTooLong
	}
	if err := i.checklists.SetItems(ctx, checklistID, c.Items); err != nil {
		return domain.ChecklistInfo{}, err
	}
	info, err := i.checklists.Info(ctx, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	i.publishChecklistUpdate(ctx, c.ChatID, checklistID)
	return info, nil
}

func itemExists(items []domain.ChecklistItem, id int) bool {
	for _, it := range items {
		if it.ID == id {
			return true
		}
	}
	return false
}

// checklistAuthor — отправитель сообщения с этим чек-листом.
func (i *Interactor) checklistAuthor(ctx context.Context, checklistID int64) (int64, error) {
	msgs, err := i.msgs.ByChecklistID(ctx, checklistID)
	if err != nil {
		return 0, err
	}
	if len(msgs) == 0 {
		return 0, domain.ErrNotFound
	}
	return msgs[0].SenderID, nil
}

// hydrateChecklists наполняет Message.Checklist для сообщений типа 'checklist'.
func (i *Interactor) hydrateChecklists(ctx context.Context, msgs []domain.Message) {
	if i.checklists == nil {
		return
	}
	for idx := range msgs {
		if msgs[idx].ChecklistID == nil {
			continue
		}
		info, err := i.checklists.Info(ctx, *msgs[idx].ChecklistID)
		if err != nil {
			continue // чек-лист мог быть удалён — сообщение остаётся без него
		}
		msgs[idx].Checklist = &info
	}
}

// publishChecklistUpdate рассылает участникам чата обновлённый чек-лист.
func (i *Interactor) publishChecklistUpdate(ctx context.Context, chatID, checklistID int64) {
	if i.publisher == nil {
		return
	}
	info, err := i.checklists.Info(ctx, checklistID)
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("checklist_update", map[string]any{"chat_id": chatID, "checklist": info})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
