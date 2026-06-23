package domain

import "errors"

var (
	ErrNotFound    = errors.New("not found")
	ErrInvalidCode = errors.New("invalid code")
	ErrBadReaction = errors.New("invalid reaction")
)
