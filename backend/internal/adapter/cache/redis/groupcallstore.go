package redis

import (
	"context"
	"fmt"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

// GroupCallStore — участники активных групповых звонков: Redis-set
// groupcall:{chatID}. TTL страхует от «зависших» комнат (все вышли аварийно);
// каждый join продлевает жизнь ключа. Ключ истёк — звонка нет: флаги
// call_active/call_not_empty берутся из EXISTS. Участника, чьё соединение умерло
// без выхода (падение или деплой реплики), набор держит до TTL: пульса участника
// у звонка нет (вне задачи f6-call, см. PR).
//
// Рядом живёт очередь снимков чата при смене состояния звонка (не чаще раза в
// окно на чат; см. usecase/chat/callstate.go):
//
//	groupcall:snap:{chatID}  — ключ-ограничитель окна (SET NX PX);
//	groupcall:dirty          — ZSET отложенных снимков, счёт = срок публикации
//	                           (unix ms), у арендованной записи — конец аренды.
type GroupCallStore struct {
	client *goredis.Client
}

func NewGroupCallStore(client *goredis.Client) *GroupCallStore {
	return &GroupCallStore{client: client}
}

const groupCallTTL = 6 * time.Hour

// groupCallKey — ключ ВНУТРЕННИЙ: список участников звонка живёт по chats.id,
// как строки в chat_members, и наружу не выходит (клиент адресует звонок
// peer_id, разрешение — в usecase/chat/peeraddr.go). Переводить его на знаковый
// ключ значило бы добавить конверсию там, где адреса нет вовсе.
func groupCallKey(chatID int64) string { return fmt.Sprintf("groupcall:%d", chatID) }

// groupCallJoin: атомарно добавить участника и продлить ключ; 1 — переход
// «звонок был пуст → в нём появился участник», -2 — в звонке уже ARGV[3]
// участников, а этот не из них (ничего не записано). Проверка и вход — один
// скрипт: два одновременных входа в звонок на пределе не проходят оба.
var groupCallJoin = goredis.NewScript(`
local before = redis.call('SCARD', KEYS[1])
if before >= tonumber(ARGV[3]) and redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 then return -2 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if before == 0 then return 1 end
return 0`)

// groupCallJoinIfActive: то же, но только в непустой звонок. -1 — звонка нет
// (ничего не записано, ключ не создан), -2 — звонок полон, 0 — вошёл.
var groupCallJoinIfActive = goredis.NewScript(`
local n = redis.call('SCARD', KEYS[1])
if n == 0 then return -1 end
if n >= tonumber(ARGV[3]) and redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 then return -2 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 0`)

// groupCallLeave: атомарно убрать участника; 1 — переход «в звонке был кто-то →
// не осталось никого».
var groupCallLeave = goredis.NewScript(`
local before = redis.call('SCARD', KEYS[1])
redis.call('SREM', KEYS[1], ARGV[1])
local after = redis.call('SCARD', KEYS[1])
if before > 0 and after == 0 then return 1 end
return 0`)

// groupCallMarkDirty: поставить запись с ранним сроком. Запись, уже ждущая с
// не более поздним сроком, не двигается (иначе непрерывный вход/выход
// откладывал бы снимок бесконечно); запись в аренде (счёт — конец аренды, он
// позже любого срока) возвращается к сроку ARGV[2], чтобы арендатор не снял её,
// не учтя новый переход.
var groupCallMarkDirty = goredis.NewScript(`
local s = redis.call('ZSCORE', KEYS[1], ARGV[1])
if (not s) or tonumber(s) > tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
end
return 1`)

// groupCallLease: взять в аренду созревшие записи (счёт <= now, включая
// записи с истёкшей арендой упавшей реплики). Атомарно — каждую запись получит
// одна реплика.
var groupCallLease = goredis.NewScript(`
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
for _, id in ipairs(ids) do
  redis.call('ZADD', KEYS[1], 'XX', 'CH', ARGV[2], id)
end
return ids`)

// groupCallFinish: после публикации занять окно и снять запись, если аренда
// всё ещё наша (счёт не сдвинули повторным MarkDirty).
var groupCallFinish = goredis.NewScript(`
redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
local s = redis.call('ZSCORE', KEYS[1], ARGV[1])
if s and tonumber(s) == tonumber(ARGV[2]) then
  redis.call('ZREM', KEYS[1], ARGV[1])
end
return 1`)

const groupCallDirtyKey = "groupcall:dirty"

func groupCallSnapKey(chatID int64) string { return fmt.Sprintf("groupcall:snap:%d", chatID) }

// groupCallFull — ответ скриптов входа «звонок полон».
const groupCallFull = -2

// Join добавляет участника; first — звонок до этого был пуст. В звонке уже limit
// других участников — domain.ErrGroupCallFull.
func (s *GroupCallStore) Join(ctx context.Context, chatID, userID int64, limit int) (bool, error) {
	n, err := groupCallJoin.Run(ctx, s.client, []string{groupCallKey(chatID)}, userID, int(groupCallTTL.Seconds()), limit).Int()
	if err == nil && n == groupCallFull {
		return false, domain.ErrGroupCallFull
	}
	return n == 1, err
}

// JoinIfActive добавляет участника только в идущий звонок; joined=false — звонка нет.
// Звонок полон — domain.ErrGroupCallFull.
func (s *GroupCallStore) JoinIfActive(ctx context.Context, chatID, userID int64, limit int) (bool, error) {
	n, err := groupCallJoinIfActive.Run(ctx, s.client, []string{groupCallKey(chatID)}, userID, int(groupCallTTL.Seconds()), limit).Int()
	if err == nil && n == groupCallFull {
		return false, domain.ErrGroupCallFull
	}
	return n == 0, err
}

// Leave убирает участника; last — в звонке никого не осталось.
func (s *GroupCallStore) Leave(ctx context.Context, chatID, userID int64) (bool, error) {
	n, err := groupCallLeave.Run(ctx, s.client, []string{groupCallKey(chatID)}, userID).Int()
	return n == 1, err
}

func (s *GroupCallStore) Participants(ctx context.Context, chatID int64) ([]int64, error) {
	vals, err := s.client.SMembers(ctx, groupCallKey(chatID)).Result()
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(vals))
	for _, v := range vals {
		if id, e := strconv.ParseInt(v, 10, 64); e == nil {
			out = append(out, id)
		}
	}
	return out, nil
}

// ActiveAmong — чаты среди chatIDs, где звонок идёт (ключ жив): один pipeline.
// Пустой набор ключ не держит, так что EXISTS и есть «в звонке кто-то есть».
func (s *GroupCallStore) ActiveAmong(ctx context.Context, chatIDs []int64) (map[int64]bool, error) {
	out := make(map[int64]bool, len(chatIDs))
	if len(chatIDs) == 0 {
		return out, nil
	}
	pipe := s.client.Pipeline()
	cmds := make([]*goredis.IntCmd, len(chatIDs))
	for k, id := range chatIDs {
		cmds[k] = pipe.Exists(ctx, groupCallKey(id))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	for k, id := range chatIDs {
		if cmds[k].Val() > 0 {
			out[id] = true
		}
	}
	return out, nil
}

// ClaimSnapshot занимает окно снимков чата; false — окно занято.
func (s *GroupCallStore) ClaimSnapshot(ctx context.Context, chatID int64, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, groupCallSnapKey(chatID), 1, ttl).Result()
}

// MarkSnapshotDirty откладывает снимок чата до due.
func (s *GroupCallStore) MarkSnapshotDirty(ctx context.Context, chatID int64, due time.Time) error {
	return groupCallMarkDirty.Run(ctx, s.client, []string{groupCallDirtyKey}, chatID, due.UnixMilli()).Err()
}

// LeaseDirtySnapshots берёт в аренду до leaseUntil созревшие к now записи.
func (s *GroupCallStore) LeaseDirtySnapshots(ctx context.Context, now, leaseUntil time.Time, limit int) ([]int64, error) {
	raw, err := groupCallLease.Run(ctx, s.client, []string{groupCallDirtyKey}, now.UnixMilli(), leaseUntil.UnixMilli(), limit).StringSlice()
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(raw))
	for _, v := range raw {
		if id, e := strconv.ParseInt(v, 10, 64); e == nil {
			out = append(out, id)
		}
	}
	return out, nil
}

// FinishDirtySnapshot закрывает арендованную запись после публикации.
func (s *GroupCallStore) FinishDirtySnapshot(ctx context.Context, chatID int64, leaseUntil time.Time, ttl time.Duration) error {
	return groupCallFinish.Run(ctx, s.client, []string{groupCallDirtyKey, groupCallSnapKey(chatID)},
		chatID, leaseUntil.UnixMilli(), ttl.Milliseconds()).Err()
}
