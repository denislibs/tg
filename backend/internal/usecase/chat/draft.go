package chat

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Облачные черновики (Telegram messages.saveDraft/getAllDrafts/clearAllDrafts):
// один на пару (чат, пользователь); пустой текст без reply = удаление;
// изменения рассылаются на устройства владельца фреймом draft_update, чтобы
// вкладки/устройства держали один и тот же черновик (updateDraftMessage).

// SaveDraft сохраняет (или удаляет — при пустом тексте без reply) черновик.
func (i *Interactor) SaveDraft(ctx context.Context, userID, chatID int64, text string, entities []domain.MessageEntity, replyToID *int64) (*domain.Draft, error) {
	if i.drafts == nil {
		return nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return nil, domain.ErrTooLong
	}
	// reply_to_id валидируется мягко: сообщение должно существовать в этом же
	// чате, иначе просто NULL (черновик сохраняется без reply, не ошибка).
	if replyToID != nil {
		m, err := i.msgs.GetByID(ctx, *replyToID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			replyToID = nil
		case err != nil:
			return nil, err
		case m.ChatID != chatID:
			replyToID = nil
		}
	}
	if text == "" && replyToID == nil {
		if err := i.deleteDraft(ctx, userID, chatID); err != nil {
			return nil, err
		}
		return nil, nil
	}
	d, err := i.drafts.Upsert(ctx, userID, domain.Draft{
		ChatID: chatID, Text: text, Entities: sanitizeEntities(entities), ReplyToID: replyToID,
	})
	if err != nil {
		return nil, err
	}
	i.publishDraft(ctx, userID, chatID, &d)
	return &d, nil
}

// MyDrafts — все черновики пользователя (загрузка при старте клиента).
func (i *Interactor) MyDrafts(ctx context.Context, userID int64) ([]domain.Draft, error) {
	if i.drafts == nil {
		return nil, nil
	}
	return i.drafts.ListByUser(ctx, userID)
}

// DeleteDraft удаляет черновик чата.
func (i *Interactor) DeleteDraft(ctx context.Context, userID, chatID int64) error {
	if i.drafts == nil {
		return nil
	}
	return i.deleteDraft(ctx, userID, chatID)
}

// ClearAllDrafts удаляет все черновики пользователя («Удалить все черновики»
// в конфиденциальности, Telegram messages.clearAllDrafts).
func (i *Interactor) ClearAllDrafts(ctx context.Context, userID int64) error {
	if i.drafts == nil {
		return nil
	}
	chatIDs, err := i.drafts.DeleteAllByUser(ctx, userID)
	if err != nil {
		return err
	}
	for _, chatID := range chatIDs {
		i.publishDraft(ctx, userID, chatID, nil)
	}
	return nil
}

// clearDraftAfterSend — отправка сообщения удаляет черновик чата (best-effort,
// после коммита сообщения; так делает сервер Telegram).
func (i *Interactor) clearDraftAfterSend(ctx context.Context, userID, chatID int64) {
	if i.drafts == nil {
		return
	}
	_ = i.deleteDraft(ctx, userID, chatID)
}

func (i *Interactor) deleteDraft(ctx context.Context, userID, chatID int64) error {
	deleted, err := i.drafts.Delete(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if deleted {
		i.publishDraft(ctx, userID, chatID, nil)
	}
	return nil
}

// publishDraft шлёт draft_update на все устройства владельца (d nil — удалён).
func (i *Interactor) publishDraft(ctx context.Context, userID, chatID int64, d *domain.Draft) {
	if i.publisher == nil {
		return
	}
	payload := map[string]any{"chat_id": chatID, "draft": nil}
	if d != nil {
		payload["draft"] = draftJSON(*d)
	}
	_ = i.publisher.PublishToUser(ctx, userID, frame("draft_update", payload))
}

func draftJSON(d domain.Draft) map[string]any {
	return map[string]any{
		"chat_id": d.ChatID, "text": d.Text, "entities": d.Entities,
		"reply_to_id": d.ReplyToID, "updated_at": d.UpdatedAt,
	}
}
