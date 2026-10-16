package domain

import (
	"testing"
	"time"
)

// Значения — те, что клиент получает из help.getAppConfig / help.getConfig.
// Тест фиксирует их литералами: сдвиг константы должен быть осознанным (это
// контракт с клиентом, а не только правило сервера).
func TestLimits_Values(t *testing.T) {
	cases := []struct {
		name      string
		got, want any
	}{
		{"EditTimeLimit", EditTimeLimit, 48 * time.Hour},
		{"MaxMessageRunes", MaxMessageRunes, 4096},
		{"MaxPinnedDialogs", MaxPinnedDialogs, 5},
		{"FavedStickersLimit", FavedStickersLimit, 10},
		{"RecentStickersLimit", RecentStickersLimit, 20},
		{"SavedGifsLimit", SavedGifsLimit, 200},
		{"MaxFoldersPerUser", MaxFoldersPerUser, 10},
		{"MaxPasskeys", MaxPasskeys, 10},
		{"StealthPastPeriod", StealthPastPeriod, 5 * time.Minute},
		{"StealthFuturePeriod", StealthFuturePeriod, 25 * time.Minute},
		{"ReactionsUserMaxDefault", ReactionsUserMaxDefault, 1},
		{"ReactionsUserMaxPremium", ReactionsUserMaxPremium, 3},
		{"ChatReadMarkSizeThreshold", ChatReadMarkSizeThreshold, 100},
		{"ChatReadMarkExpirePeriod", ChatReadMarkExpirePeriod, 7 * 24 * time.Hour},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
}
