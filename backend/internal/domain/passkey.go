package domain

import "time"

// Passkey — ключ доступа (WebAuthn discoverable credential). Credential —
// сериализованные данные библиотеки (публичный ключ, счётчик подписи и т.д.),
// домен хранит их непрозрачно.
type Passkey struct {
	ID         int64
	UserID     int64
	Name       string
	CredID     string // base64url credential id
	Credential []byte // json
	CreatedAt  time.Time
	LastUsedAt *time.Time
}
