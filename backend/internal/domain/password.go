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

// MaskEmail прячет почту для показа в настройках и на экране восстановления
// (Telegram login_email_pattern): «denis@example.com» → «d****@e******.com».
//
// Формат ровно как у Telegram: скрытые символы — звёздочки, по одной на каждый
// настоящий символ (длина не скрывается, это часть подсказки пользователю),
// первая буква локальной части и первая буква домена остаются, доменная зона
// видна целиком. Прежняя версия отдавала фиксированные «•••» и **полный
// домен** — и длину теряла, и адрес прятала слабее.
func MaskEmail(email string) string {
	at := strings.LastIndexByte(email, '@')
	if at <= 0 {
		return email
	}
	host := email[at+1:]
	// Зона (последняя точка и всё после) не маскируется — так же у Telegram.
	zone := ""
	if dot := strings.LastIndexByte(host, '.'); dot > 0 {
		zone, host = host[dot:], host[:dot]
	}
	return maskKeepFirst(email[:at]) + "@" + maskKeepFirst(host) + zone
}

// maskKeepFirst оставляет первый символ, остальные заменяет звёздочками.
func maskKeepFirst(s string) string {
	r := []rune(s)
	if len(r) <= 1 {
		return s
	}
	return string(r[0]) + strings.Repeat("*", len(r)-1)
}
