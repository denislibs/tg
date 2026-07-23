package chat

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxFactCheckRunes ограничивает длину текста «проверки фактов» (Telegram
// factcheck_length_limit ≈ 1024). Длиннее — domain.ErrTooLong.
const maxFactCheckRunes = 1024

// SetFactCheck прикрепляет/изменяет «проверку фактов» на сообщении канала
// (Telegram messages.editFactCheck) и рассылает членам апдейт factcheck_update,
// чтобы блок обновился в бабле у всех вживую. Право — автор/админ канала
// (RightPostMessages); только каналы (в группах/приватных — запрещено).
func (i *Interactor) SetFactCheck(ctx context.Context, chatID, msgID, userID int64, text string, entities []domain.MessageEntity, country string) (domain.Message, error) {
	if err := i.requireFactCheckRight(ctx, chatID, userID); err != nil {
		return domain.Message{}, err
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.Message{}, domain.ErrNotFound
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return domain.Message{}, domain.ErrInvalid
	}
	if utf8.RuneCountInString(text) > maxFactCheckRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	fc := &domain.FactCheck{
		Text:     text,
		Entities: sanitizeEntities(entities),
		Country:  sanitizeCountry(country),
	}
	return i.applyFactCheck(ctx, chatID, msgID, fc)
}

// RemoveFactCheck снимает «проверку фактов» с сообщения (Telegram
// messages.deleteFactCheck). Право — как у SetFactCheck.
func (i *Interactor) RemoveFactCheck(ctx context.Context, chatID, msgID, userID int64) error {
	if err := i.requireFactCheckRight(ctx, chatID, userID); err != nil {
		return err
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.ErrNotFound
	}
	_, err = i.applyFactCheck(ctx, chatID, msgID, nil)
	return err
}

// requireFactCheckRight допускает изменение проверки фактов только в каналах и
// только автору/админу канала (право постить). Иначе domain.ErrForbidden.
func (i *Interactor) requireFactCheckRight(ctx context.Context, chatID, userID int64) error {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ != "channel" {
		return domain.ErrForbidden
	}
	return i.requireRight(ctx, chatID, userID, domain.RightPostMessages)
}

// applyFactCheck сохраняет проверку (nil — снимает) и фанит factcheck_update
// всем членам чата: и в журнал апдейтов (catch-up), и вживую через publisher.
func (i *Interactor) applyFactCheck(ctx context.Context, chatID, msgID int64, fc *domain.FactCheck) (domain.Message, error) {
	var msg domain.Message
	var members []int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		m, e := i.msgs.SetFactCheck(ctx, msgID, fc)
		if e != nil {
			return e
		}
		msg = m
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		payload, e := json.Marshal(factCheckUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "factcheck_update", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if i.publisher != nil {
		f := frame("factcheck_update", factCheckUpdatePayload(msg))
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return msg, nil
}

// sanitizeCountry нормализует код страны к ISO-3166 alpha-2 (2 латинские буквы
// в верхнем регистре); всё прочее отбрасывается (страна не задаётся).
func sanitizeCountry(c string) string {
	c = strings.ToUpper(strings.TrimSpace(c))
	if len(c) != 2 {
		return ""
	}
	for _, r := range c {
		if r < 'A' || r > 'Z' {
			return ""
		}
	}
	return c
}
