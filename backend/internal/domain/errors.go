package domain

import "errors"

var (
	ErrNotFound    = errors.New("not found")
	ErrForbidden   = errors.New("forbidden")
	ErrInvalidCode = errors.New("invalid code")
	ErrBadReaction = errors.New("invalid reaction")
	ErrConflict    = errors.New("conflict") // e.g. username already taken
)
