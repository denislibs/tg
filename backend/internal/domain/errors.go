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
	// ErrFreshAuthorization: текущая сессия моложе FreshAuthorizationPeriod и
	// не вправе распоряжаться другими (tweb FRESH_RESET_AUTHORISATION_FORBIDDEN).
	ErrFreshAuthorization = errors.New("fresh authorization")
	// ErrNoCurrentSession: строки ТЕКУЩЕЙ сессии запроса уже нет (отозвана, а кэш
	// сессий ещё пропускает токен). Отличается от ErrNotFound, которым могут
	// отвечать выборки по цели: ручки отвечают на неё 401, а не 404.
	ErrNoCurrentSession = errors.New("no current session")
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
	// ErrGroupCallFull: в видеочате уже GroupCallMaxParticipants участников (mesh,
	// К3). У tweb такого отказа нет — видеочат ходит через SFU без предела.
	ErrGroupCallFull = errors.New("group call full")
)

// ErrAllowPaymentRequired: сообщение в платную группу отвергнуто, потому что
// подтверждённая отправителем сумма (allow_paid_stars) меньше цены запроса.
// Stars — требуемая сумма всего запроса (цена × число сообщений); на проводе
// ALLOW_PAYMENT_REQUIRED_<Stars> (tweb repayRequestHandler.ts:12).
type ErrAllowPaymentRequired struct{ Stars int64 }

func (e ErrAllowPaymentRequired) Error() string {
	return fmt.Sprintf("ALLOW_PAYMENT_REQUIRED_%d", e.Stars)
}

// ErrSlowmodeWait — отказ медленного режима с остатком ожидания. Seconds —
// целые секунды (≥ 1) до конца окна; на проводе SLOWMODE_WAIT_<N> (tweb
// appImManager.ts:551-565 берёт N из `error.type`). errors.Is(err, ErrSlowmode)
// остаётся истинным: прежние проверки по сентинелу продолжают работать.
type ErrSlowmodeWait struct{ Seconds int }

func (e ErrSlowmodeWait) Error() string { return fmt.Sprintf("SLOWMODE_WAIT_%d", e.Seconds) }

func (e ErrSlowmodeWait) Is(target error) bool { return target == ErrSlowmode }
