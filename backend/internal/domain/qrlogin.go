package domain

import "time"

// Состояния записи QR-входа.
const (
	// QRPending — код выпущен и ждёт подтверждения со второго устройства.
	QRPending = "pending"
	// QRConfirmed — подтверждён: в записи выпущенная сессия, её заберёт экспортёр.
	QRConfirmed = "confirmed"
	// QRPasswordNeeded — подтверждён аккаунтом с облачным паролем: сессии нет,
	// экспортёр получит шаг пароля.
	QRPasswordNeeded = "password_needed"
)

// QRClient — реквизиты экспортирующего устройства: по ним строится строка
// сессии (подтверждает вход другое устройство, но сессия принадлежит этому).
type QRClient struct {
	Browser    string `json:"browser,omitempty"`
	OS         string `json:"os,omitempty"`
	IP         string `json:"ip,omitempty"`
	Location   string `json:"location,omitempty"`
	AppVersion string `json:"app_version,omitempty"`
}

// QRLogin — запись QR-входа (Redis, короткий TTL). Ключ записи — хеш ключа
// входа (auth.exportLoginToken у экспортёра, заголовок X-Login-Key): сессию
// забирает только тот, кто знает ключ, а не тот, кто увидел QR.
type QRLogin struct {
	Token     string    `json:"token"` // сырой hex: он и так нарисован в QR
	ExpiresAt time.Time `json:"expires_at"`
	Status    string    `json:"status"`
	// ExceptIDs — аккаунты, уже вошедшие на экспортирующем устройстве: ими
	// код подтвердить нельзя (tweb SignQRCard.tsx:137).
	ExceptIDs    []int64    `json:"except_ids,omitempty"`
	Platform     string     `json:"platform"`
	Client       QRClient   `json:"client"`
	UserID       int64      `json:"user_id,omitempty"` // при QRPasswordNeeded
	SessionToken string     `json:"session_token,omitempty"`
	User         UserRecord `json:"user"`
}
