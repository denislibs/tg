package domain

import "time"

// Livestream — состояние RTMP-трансляции чата (Telegram livestream). Одна на
// чат. StreamKey — секрет для OBS, отдаётся только админам; Active/StartedAt
// описывают, идёт ли эфир. Число зрителей не хранится здесь — это участники
// группового звонка (эфемерный Redis-сет).
type Livestream struct {
	ChatID    int64
	StreamKey string
	Active    bool
	StartedAt *time.Time
}
