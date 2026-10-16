package redis

import (
	"context"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// PasswordAttemptStore — счётчик попыток облачного пароля и блокировка (Б-4,
// М1-5) в Redis, общий для всех экземпляров сервера: счётчик под
// "pwfail:{userID}:{deviceID}:{version}", блокировка под
// "pwlock:{userID}:{deviceID}:{version}". Реализует порт PasswordAttemptStore
// usecase/auth.
type PasswordAttemptStore struct{ rdb *goredis.Client }

var _ usecaseauth.PasswordAttemptStore = (*PasswordAttemptStore)(nil)

func NewPasswordAttemptStore(rdb *goredis.Client) *PasswordAttemptStore {
	return &PasswordAttemptStore{rdb: rdb}
}

func pwKeys(userID, deviceID int64, version string) []string {
	pair := strconv.FormatInt(userID, 10) + ":" + strconv.FormatInt(deviceID, 10) + ":" + version
	return []string{"pwfail:" + pair, "pwlock:" + pair}
}

// pwAcquireScript — проверка и счёт одной атомарной командой: иначе запросы,
// пришедшие за время сверки (bcrypt), видели бы пару свободной и сверялись
// мимо счётчика. Блокировка есть — вернуть её остаток в мс, ничего не считая.
// Нет — INCR счётчика; при f ≥ free — блокировка min(base × 2^(f−free), max)
// (показатель ограничен 30: 2^30 × base заведомо больше потолка); срок счётчика —
// window после последней попытки, а при блокировке — window после её конца.
// Вернуть 0. KEYS: счётчик, блокировка. ARGV: free, base_ms, max_ms, window_ms.
var pwAcquireScript = goredis.NewScript(`
local left = redis.call('PTTL', KEYS[2])
if left > 0 then return left end
local free, base, cap, window = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local f = redis.call('INCR', KEYS[1])
local lock = 0
if f >= free then
  lock = base * 2 ^ math.min(f - free, 30)
  if lock > cap then lock = cap end
  lock = math.floor(lock)
  redis.call('SET', KEYS[2], f, 'PX', lock)
end
redis.call('PEXPIRE', KEYS[1], lock + window)
return 0`)

func (s *PasswordAttemptStore) Acquire(ctx context.Context, userID, deviceID int64, version string) (time.Duration, error) {
	ms, err := pwAcquireScript.Run(ctx, s.rdb, pwKeys(userID, deviceID, version),
		usecaseauth.PasswordFreeFails,
		usecaseauth.PasswordLockBase.Milliseconds(),
		usecaseauth.PasswordLockMax.Milliseconds(),
		usecaseauth.PasswordFailWindow.Milliseconds(),
	).Int64()
	return time.Duration(ms) * time.Millisecond, err
}

func (s *PasswordAttemptStore) Reset(ctx context.Context, userID, deviceID int64, version string) error {
	return s.rdb.Del(ctx, pwKeys(userID, deviceID, version)...).Err()
}
