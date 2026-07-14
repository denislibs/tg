// Package domain holds the core entities, value objects, and errors. It has no
// dependency on any framework or infrastructure.
package domain

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

type User struct {
	ID          int64
	Phone       string
	Username    *string
	FirstName   string
	LastName    string
	DisplayName string // cached "First Last" — what every UserCard/peer reads
	Bio         string
	Birthday    *time.Time // nil when unset; year may be the no-year sentinel
	AvatarURL   string
	// PhoneVisibility controls who may see the phone number: one of
	// PhoneVisibilityNobody / Contacts / Everybody.
	PhoneVisibility string
}

// ServiceUserID is the reserved id of the official "Telegram" service account
// that delivers system notifications (login alerts, etc.). Seeded by migration.
const ServiceUserID int64 = 777000

// Phone visibility settings.
const (
	PhoneVisibilityNobody    = "nobody"
	PhoneVisibilityContacts  = "contacts"
	PhoneVisibilityEverybody = "everybody"
)

// ValidPhoneVisibility reports whether v is a recognised visibility value.
func ValidPhoneVisibility(v string) bool {
	switch v {
	case PhoneVisibilityNobody, PhoneVisibilityContacts, PhoneVisibilityEverybody:
		return true
	}
	return false
}

// BuildDisplayName derives the cached display name from first/last. Falls back to
// an empty string when both are blank (the caller decides on a phone fallback).
func BuildDisplayName(first, last string) string {
	return strings.TrimSpace(strings.TrimSpace(first) + " " + strings.TrimSpace(last))
}

// BirthdayNoYear is the sentinel year stored when a user provides a birthday
// without a year (Telegram allows this). It's a leap year so Feb 29 is valid;
// the API exposes year:null for dates carrying this sentinel.
const BirthdayNoYear = 4

var (
	usernameRe        = regexp.MustCompile(`^[a-z0-9_]{5,32}$`)
	ErrUsernameFormat = errors.New("username must be 5-32 chars of a-z, 0-9, _")
)

// NormalizeUsername lowercases and trims a username for storage/comparison.
func NormalizeUsername(s string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "@")))
}

// ValidateUsername checks a normalized username against the allowed format.
func ValidateUsername(s string) error {
	if !usernameRe.MatchString(s) {
		return ErrUsernameFormat
	}
	return nil
}

type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
	IP         string // sign-in IP (best effort)
	Location   string // human place from GeoIP, when available
}

// Session is a resolved auth context (cached): who, on which device.
type Session struct {
	User     User
	DeviceID int64
}
