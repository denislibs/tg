package domain

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrForbidden   = errors.New("forbidden")
	ErrInvalidCode = errors.New("invalid code")
	ErrBadReaction = errors.New("invalid reaction")
	ErrConflict    = errors.New("conflict")          // e.g. username already taken
	ErrTooLong     = errors.New("too long")          // message text / payload exceeds the allowed size
	ErrSlowmode    = errors.New("slowmode")          // медленный режим: подождите перед следующим сообщением
	ErrPinLimit    = errors.New("pin limit reached") // лимит закреплённых диалогов (5)
	// ErrPrivacy: действие запрещено настройками конфиденциальности получателя
	// (кто может писать/звонить/приглашать) или блокировкой (чёрный список).
	ErrPrivacy = errors.New("privacy restricted")
	// ErrUnavailable: опциональная фича выключена (нет провайдера) — например,
	// перевод сообщений без настроенного TRANSLATE_URL.
	ErrUnavailable = errors.New("unavailable")
	ErrInvalid     = errors.New("invalid") // некорректные аргументы запроса (400)
	// ErrBalanceTooLow: у отправителя не хватает звёзд (платное сообщение,
	// звёздная реакция, платное медиа, подарок) — tweb BALANCE_TOO_LOW.
	ErrBalanceTooLow = errors.New("balance too low")
	// ErrScheduleTooMuch: в очереди отложенных чата уже 100 сообщений автора
	// (Telegram SCHEDULE_TOO_MUCH; tweb отдельно не обрабатывает).
	ErrScheduleTooMuch = errors.New("schedule too much")
	// ErrMessageNotModified / ErrMessageEmpty — ошибки правки, которые tweb
	// обрабатывает (appMessagesManager.ts:2226-2240).
	ErrMessageNotModified = errors.New("message not modified")
	ErrMessageEmpty       = errors.New("message empty")
)

// ErrAllowPaymentRequired: сообщение в платную группу отвергнуто, потому что
// подтверждённая отправителем сумма (allow_paid_stars) меньше цены запроса.
// Stars — требуемая сумма всего запроса (цена × число сообщений); на проводе
// ALLOW_PAYMENT_REQUIRED_<Stars> (tweb repayRequestHandler.ts:12).
type ErrAllowPaymentRequired struct{ Stars int64 }

func (e ErrAllowPaymentRequired) Error() string {
	return fmt.Sprintf("ALLOW_PAYMENT_REQUIRED_%d", e.Stars)
}
