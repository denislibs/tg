package domain

import "time"

// SecretChatState — стадия E2E-handshake.
const (
	SecretRequested = "requested"
	SecretAccepted  = "accepted"
	SecretRejected  = "rejected"
	SecretDiscarded = "discarded"
)

// SecretChat хранит handshake секретного чата: сервер видит ТОЛЬКО публичные
// ключи участников и статус, но никогда не приватные ключи и не plaintext.
type SecretChat struct {
	ChatID       int64
	InitiatorID  int64
	ResponderID  int64
	InitiatorPub []byte
	ResponderPub []byte // nil до accept
	State        string
	CreatedAt    time.Time
}
