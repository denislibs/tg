package domain

import (
	"crypto/subtle"
	"strings"
)

// NormalizePhone strips spaces, parentheses, and dashes, keeping a leading +.
func NormalizePhone(phone string) string {
	var b strings.Builder
	for i, r := range phone {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == '+': // leading + after trimmed spaces
			if strings.TrimSpace(phone[:i]) == "" {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

// PhoneDigits — только цифры номера (без «+» и разделителей). Пусто — номера
// нет вовсе (Telegram PHONE_NUMBER_INVALID). Ключ лимитера по номеру строится
// из него: «+7999…» и «7999…» — один номер.
func PhoneDigits(phone string) string {
	return strings.TrimPrefix(NormalizePhone(phone), "+")
}

// CodeMatches reports whether the supplied code equals the expected code.
func CodeMatches(expected, supplied string) bool {
	if expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(supplied)) == 1
}
