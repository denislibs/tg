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

// CodeMatches reports whether the supplied code equals the expected code.
func CodeMatches(expected, supplied string) bool {
	if expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(supplied)) == 1
}
