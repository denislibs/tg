package domain

import "errors"

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
)
