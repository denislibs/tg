package redis

import (
	"context"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/usecase/presence"
)

// PresenceStore implements the presence usecase's PresenceStore port over Redis.
type PresenceStore struct{ rdb *goredis.Client }

func NewPresenceStore(rdb *goredis.Client) *PresenceStore { return &PresenceStore{rdb: rdb} }

// presKey/lastSeenKey ключуются id ПОЛЬЗОВАТЕЛЯ, а у пользователя peerId
// совпадает с id (isUser: peerId >= 0) — переход на знаковый ключ их не меняет
// ни по имени, ни по значению.
func presKey(userID int64) string     { return "presence:" + strconv.FormatInt(userID, 10) }
func lastSeenKey(userID int64) string { return "lastseen:" + strconv.FormatInt(userID, 10) }

// announcedKey — дедлайн онлайна, объявленный партнёрам последним кадром.
func announcedKey(userID int64) string { return "presexp:" + strconv.FormatInt(userID, 10) }

// SetOnlineNX sets the presence key only if absent, returning true on the
// offline→online transition.
func (s *PresenceStore) SetOnlineNX(ctx context.Context, userID int64, ttl time.Duration) (bool, error) {
	return s.rdb.SetNX(ctx, presKey(userID), "1", ttl).Result()
}

// Refresh extends the presence TTL, returning false if the key had expired.
func (s *PresenceStore) Refresh(ctx context.Context, userID int64, ttl time.Duration) (bool, error) {
	return s.rdb.Expire(ctx, presKey(userID), ttl).Result()
}

// SetOffline clears the presence key and records last-seen.
func (s *PresenceStore) SetOffline(ctx context.Context, userID int64, lastSeen int64) error {
	s.rdb.Del(ctx, presKey(userID), announcedKey(userID))
	s.rdb.Set(ctx, lastSeenKey(userID), lastSeen, 0)
	return nil
}

// Announce запоминает объявленный дедлайн онлайна (unix ms); ключ живёт ровно до него.
func (s *PresenceStore) Announce(ctx context.Context, userID int64, deadline time.Time) error {
	return s.rdb.SetArgs(ctx, announcedKey(userID), deadline.UnixMilli(), goredis.SetArgs{ExpireAt: deadline}).Err()
}

// AnnouncedExpires — последний объявленный дедлайн онлайна; нулевое время —
// не объявлялся или истёк (ключ исчез вместе с дедлайном).
func (s *PresenceStore) AnnouncedExpires(ctx context.Context, userID int64) (time.Time, error) {
	ms, err := s.rdb.Get(ctx, announcedKey(userID)).Int64()
	if err == goredis.Nil {
		return time.Time{}, nil
	}
	if err != nil || ms <= 0 {
		return time.Time{}, err
	}
	return time.UnixMilli(ms), nil
}

// OnlineExpires — момент, когда ключ присутствия истечёт: ровно то, что схема
// зовёт userStatusOnline.expires. Информация была у нас всегда (TTL ключа), но
// наружу не выпускалась — из-за чего потерянный кадр оставлял человека онлайн
// навсегда. Нулевое время — ключа нет либо он бессрочный (у presence такого не
// бывает: TTL ставится и SetNX, и Expire).
func (s *PresenceStore) OnlineExpires(ctx context.Context, userID int64) (time.Time, error) {
	ttl, err := s.rdb.PTTL(ctx, presKey(userID)).Result()
	if err != nil || ttl <= 0 {
		return time.Time{}, err
	}
	return time.Now().Add(ttl), nil
}

// IsOnline reports whether the presence key exists.
func (s *PresenceStore) IsOnline(ctx context.Context, userID int64) (bool, error) {
	n, err := s.rdb.Exists(ctx, presKey(userID)).Result()
	return n > 0, err
}

// LastSeen returns the recorded last-seen (ms), or 0 if none.
func (s *PresenceStore) LastSeen(ctx context.Context, userID int64) (int64, error) {
	return s.rdb.Get(ctx, lastSeenKey(userID)).Int64()
}

// CountOnline — сколько из userIDs держат ключ присутствия: EXISTS по многим
// ключам отвечает числом существующих, пачками по 1000 ключей.
func (s *PresenceStore) CountOnline(ctx context.Context, userIDs []int64) (int, error) {
	const batch = 1000
	total := 0
	for start := 0; start < len(userIDs); start += batch {
		end := min(start+batch, len(userIDs))
		keys := make([]string, 0, end-start)
		for _, id := range userIDs[start:end] {
			keys = append(keys, presKey(id))
		}
		n, err := s.rdb.Exists(ctx, keys...).Result()
		if err != nil {
			return 0, err
		}
		total += int(n)
	}
	return total, nil
}

// Snapshots — присутствие пачки пользователей одним конвейером: PTTL ключа
// присутствия, объявленный дедлайн и last seen на каждого.
func (s *PresenceStore) Snapshots(ctx context.Context, userIDs []int64) (map[int64]presence.Snapshot, error) {
	out := make(map[int64]presence.Snapshot, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	pipe := s.rdb.Pipeline()
	ttls := make([]*goredis.DurationCmd, len(userIDs))
	announced := make([]*goredis.StringCmd, len(userIDs))
	seen := make([]*goredis.StringCmd, len(userIDs))
	for k, id := range userIDs {
		ttls[k] = pipe.PTTL(ctx, presKey(id))
		announced[k] = pipe.Get(ctx, announcedKey(id))
		seen[k] = pipe.Get(ctx, lastSeenKey(id))
	}
	if _, err := pipe.Exec(ctx); err != nil && err != goredis.Nil {
		return nil, err
	}
	now := time.Now()
	for k, id := range userIDs {
		var sn presence.Snapshot
		if ttl, err := ttls[k].Result(); err == nil && ttl > 0 {
			sn.Online, sn.Expires = true, now.Add(ttl)
		}
		if ms, err := announced[k].Int64(); err == nil && ms > 0 {
			sn.Announced = time.UnixMilli(ms)
		}
		if ms, err := seen[k].Int64(); err == nil {
			sn.LastSeen = ms
		}
		out[id] = sn
	}
	return out, nil
}
