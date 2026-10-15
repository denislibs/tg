package chat

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Пределы полей присланной визитки. Поля приходят от клиента и хранятся как
// есть (решение В-10), поэтому длина ограничена здесь, а не схемой: у
// inputMediaContact схемный предел не задан.
const (
	maxContactNameRunes  = 256
	maxContactPhoneRunes = 64
	maxContactVcardRunes = 8192
)

// contactFields — поля визитки в форме колонок сообщения (first_name,
// last_name, phone, vcard); у не-визитки все nil. Пустая строка — значение, а не
// отсутствие, поэтому указатель на неё ставится всегда.
func (in SendInput) contactFields() (first, last, phone, vcard *string) {
	c := in.Contact
	if c == nil {
		return nil, nil, nil, nil
	}
	return &c.FirstName, &c.LastName, &c.PhoneNumber, &c.Vcard
}

// checkContact проверяет поля inputMediaContact и выводит аккаунт визитки по
// номеру (messageMediaContact.user_id). Имена, телефон и vcard не правятся и не
// заполняются: что прислал отправитель, то и уходит (В-10, tweb
// appMessagesManager.ts:4035-4045). user_id клиент не присылает вовсе, его
// выводит сервер тем же поиском и правилом, что «добавить контакт по номеру»
// (PhoneResolver); не найден или скрыт правилом — nil (на проводе 0).
func (i *Interactor) checkContact(ctx context.Context, senderID int64, c domain.InputMediaContact) (*int64, error) {
	for _, f := range []struct {
		v   string
		max int
	}{
		{c.FirstName, maxContactNameRunes}, {c.LastName, maxContactNameRunes},
		{c.PhoneNumber, maxContactPhoneRunes}, {c.Vcard, maxContactVcardRunes},
	} {
		// NUL Postgres в text не принимает, а битый UTF-8 клиентам не показать.
		if !utf8.ValidString(f.v) || strings.ContainsRune(f.v, 0) {
			return nil, domain.ErrInvalid
		}
		if utf8.RuneCountInString(f.v) > f.max {
			return nil, domain.ErrTooLong
		}
	}
	if i.phones == nil || strings.TrimSpace(c.PhoneNumber) == "" {
		return nil, nil
	}
	id, ok, err := i.phones.ResolvePhone(ctx, senderID, c.PhoneNumber)
	if err != nil {
		return nil, err
	}
	if !ok || id == 0 {
		return nil, nil
	}
	return &id, nil
}
