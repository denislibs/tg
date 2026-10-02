package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

// PhoneCallStore — состояние идущих 1:1 звонков: JSON звонка под
// phonecall:{id} и отметка ответа под phonecall:{id}:accepted (unix ms).
// Отметка — отдельный ключ, чтобы ответ ставился SET NX без чтения-записи
// звонка. TTL страхует от звонков, которые никто не кончил (обе стороны
// пропали без кадра): такой звонок исчезает без лога.
type PhoneCallStore struct {
	client *goredis.Client
}

func NewPhoneCallStore(client *goredis.Client) *PhoneCallStore {
	return &PhoneCallStore{client: client}
}

// phoneCallTTL — потолок жизни звонка; разговор дольше суток лога не получит.
const phoneCallTTL = 24 * time.Hour

func phoneCallKey(id string) string         { return "phonecall:" + id }
func phoneCallAcceptedKey(id string) string { return "phonecall:" + id + ":accepted" }

type phoneCallRecord struct {
	CallerID int64 `json:"caller_id"`
	CalleeID int64 `json:"callee_id"`
	Video    bool  `json:"video"`
}

func (s *PhoneCallStore) Create(ctx context.Context, c domain.PhoneCall) (bool, error) {
	b, err := json.Marshal(phoneCallRecord{CallerID: c.CallerID, CalleeID: c.CalleeID, Video: c.Video})
	if err != nil {
		return false, err
	}
	return s.client.SetNX(ctx, phoneCallKey(c.ID), b, phoneCallTTL).Result()
}

func (s *PhoneCallStore) Get(ctx context.Context, id string) (domain.PhoneCall, error) {
	pipe := s.client.Pipeline()
	rec := pipe.Get(ctx, phoneCallKey(id))
	acc := pipe.Get(ctx, phoneCallAcceptedKey(id))
	_, _ = pipe.Exec(ctx)
	return decodePhoneCall(id, rec, acc)
}

func (s *PhoneCallStore) Accept(ctx context.Context, id string, at time.Time) error {
	return s.client.SetNX(ctx, phoneCallAcceptedKey(id), at.UnixMilli(), phoneCallTTL).Err()
}

// Finish читает и удаляет оба ключа в одной транзакции MULTI/EXEC: из двух
// конкурентов звонок достаётся тому, чья транзакция прошла первой, второй
// видит пустоту.
func (s *PhoneCallStore) Finish(ctx context.Context, id string) (domain.PhoneCall, error) {
	var rec, acc *goredis.StringCmd
	_, _ = s.client.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		rec = p.Get(ctx, phoneCallKey(id))
		acc = p.Get(ctx, phoneCallAcceptedKey(id))
		p.Del(ctx, phoneCallKey(id), phoneCallAcceptedKey(id))
		return nil
	})
	return decodePhoneCall(id, rec, acc)
}

func decodePhoneCall(id string, rec, acc *goredis.StringCmd) (domain.PhoneCall, error) {
	raw, err := rec.Bytes()
	if errors.Is(err, goredis.Nil) {
		return domain.PhoneCall{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.PhoneCall{}, err
	}
	var r phoneCallRecord
	if err := json.Unmarshal(raw, &r); err != nil {
		return domain.PhoneCall{}, err
	}
	c := domain.PhoneCall{ID: id, CallerID: r.CallerID, CalleeID: r.CalleeID, Video: r.Video}
	switch v, err := acc.Result(); {
	case errors.Is(err, goredis.Nil):
	case err != nil:
		return domain.PhoneCall{}, err
	default:
		ms, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return domain.PhoneCall{}, err
		}
		c.AcceptedAt = time.UnixMilli(ms)
	}
	return c, nil
}
