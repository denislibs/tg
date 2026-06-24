package domain

import "time"

// QR login status values.
const (
	QRPending   = "pending"
	QRConfirmed = "confirmed"
)

// QRLogin is an ephemeral QR-login record (stored in Redis with a short TTL).
// While Status is QRPending only Platform/CreatedAt are set; once a logged-in
// device confirms, Status becomes QRConfirmed and SessionToken+User are filled.
type QRLogin struct {
	Status       string    `json:"status"`
	Platform     string    `json:"platform"`
	SessionToken string    `json:"session_token,omitempty"`
	User         User      `json:"user"`
	CreatedAt    time.Time `json:"created_at"`
}
