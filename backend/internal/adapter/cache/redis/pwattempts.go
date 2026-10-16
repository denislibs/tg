package redis

import (
	"context"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// PasswordAttemptStore — счётчик неверных облачных паролей и блокировка (Б-4,
// М1-5) в Redis, общий для всех экземпляров сервера: счётчик под
// "pwfail:{userID}:{deviceID}", блокировка под "pwlock:{userID}:{deviceID}".
// Реализует порт PasswordAttemptStore usecase/auth.
type PasswordAttemptStore struct{ rdb *goredis.Client }

var _ usecaseauth.PasswordAttemptStore = (*PasswordAttemptStore)(nil)

func NewPasswordAttemptStore(rdb *goredis.Client) *PasswordAttemptStore {
	return &PasswordAttemptStore{rdb: rdb}
}

func pwPair(userID, deviceID int64) string {
	return strconv.FormatInt(userID, 10) + ":" + strconv.FormatInt(deviceID, 10)
}

func pwFailKey(userID, deviceID int64) string { return "pwfail:" + pwPair(userID, deviceID) }
func pwLockKey(userID, deviceID int64) string { return "pwlock:" + pwPair(userID, deviceID) }

// pwFailScript засчитывает неудачу одной атомарной командой: INCR счётчика,
// срок — 24 ч от последней неудачи, при f ≥ 5 — блокировка
// min(60 с × 2^(f−5), 24 ч) (формула usecase passwordLockFor, решение В-S2;
// показатель ограничен 11 — 2^11 минут уже больше суток). KEYS: счётчик,
// блокировка. Возвращает f.
var pwFailScript = goredis.NewScript(`
local f = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 86400)
if f >= 5 then
  local ms = 60000 * 2 ^ math.min(f - 5, 11)
  if ms > 86400000 then ms = 86400000 end
  redis.call('SET', KEYS[2], f, 'PX', math.floor(ms))
end
return f`)

func (s *PasswordAttemptStore) Locked(ctx context.Context, userID, deviceID int64) (time.Duration, error) {
	left, err := s.rdb.PTTL(ctx, pwLockKey(userID, deviceID)).Result()
	if err != nil {
		return 0, err
	}
	// -2 — ключа нет, -1 — без срока (скрипт всегда ставит PX): свободно.
	return max(left, 0), nil
}

func (s *PasswordAttemptStore) Fail(ctx context.Context, userID, deviceID int64) (int, error) {
	return pwFailScript.Run(ctx, s.rdb, []string{pwFailKey(userID, deviceID), pwLockKey(userID, deviceID)}).Int()
}

func (s *PasswordAttemptStore) Reset(ctx context.Context, userID, deviceID int64) error {
	return s.rdb.Del(ctx, pwFailKey(userID, deviceID), pwLockKey(userID, deviceID)).Err()
}
