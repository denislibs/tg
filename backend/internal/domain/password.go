package domain

import (
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// ErrBadPassword — неверный облачный пароль (2FA) или его отсутствие там, где
// он обязателен.
var ErrBadPassword = errors.New("invalid password")

// HashPassword хеширует облачный пароль (bcrypt, дефолтная стоимость).
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPasswordHash сверяет пароль с bcrypt-хешем.
func CheckPasswordHash(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// MaskEmail прячет локальную часть почты для показа в настройках/логине
// (Telegram login_email_pattern): den…@gmail.com → «de•••@gmail.com».
func MaskEmail(email string) string {
	at := strings.LastIndexByte(email, '@')
	if at <= 0 {
		return email
	}
	local := email[:at]
	keep := 2
	if len(local) < keep {
		keep = len(local)
	}
	return local[:keep] + "•••" + email[at:]
}
