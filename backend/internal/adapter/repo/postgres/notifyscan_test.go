package postgres

import (
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// mutedAt — «замьючено ли значение на проводе в этот момент» (tweb isMuted:
// silent || mute_until > now); проверка провода, не решение о чате (domain.ChatMuted).
func mutedAt(s domain.PeerNotifySettings, now time.Time) bool {
	return (s.Silent != nil && *s.Silent) || (s.MuteUntil != nil && int64(*s.MuteUntil) > now.Unix())
}
