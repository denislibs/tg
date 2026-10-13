package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// QRStore хранит записи QR-входа в Redis: запись — под "qrlogin:key:{keyHash}"
// (хеш ключа входа), указатель кода — под "qrlogin:tok:{tokenHash}" со значением
// keyHash. Реализует порт QRStore usecase/auth.
type QRStore struct{ rdb *goredis.Client }

var _ usecaseauth.QRStore = (*QRStore)(nil)

func NewQRStore(rdb *goredis.Client) *QRStore { return &QRStore{rdb: rdb} }

func qrKeyKey(keyHash string) string   { return "qrlogin:key:" + keyHash }
func qrTokKey(tokenHash string) string { return "qrlogin:tok:" + tokenHash }

// Create ставит запись ключа командой SET NX и, только если она поставлена,
// указатель кода: два первых опроса одного ключа получают один код.
func (s *QRStore) Create(ctx context.Context, keyHash, tokenHash string, rec domain.QRLogin, ttl time.Duration) (bool, error) {
	b, err := json.Marshal(rec)
	if err != nil {
		return false, err
	}
	ok, err := s.rdb.SetNX(ctx, qrKeyKey(keyHash), b, ttl).Result()
	if err != nil || !ok {
		return false, err
	}
	// Токен случайный и свой у каждого победителя: NX указателю не нужен.
	if err := s.rdb.Set(ctx, qrTokKey(tokenHash), keyHash, ttl).Err(); err != nil {
		_ = s.rdb.Del(ctx, qrKeyKey(keyHash)).Err() // без указателя запись бесполезна
		return false, err
	}
	return true, nil
}

func (s *QRStore) GetByKey(ctx context.Context, keyHash string) (domain.QRLogin, error) {
	b, err := s.rdb.Get(ctx, qrKeyKey(keyHash)).Bytes()
	if errors.Is(err, goredis.Nil) {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.QRLogin{}, err
	}
	var rec domain.QRLogin
	if err := json.Unmarshal(b, &rec); err != nil {
		return domain.QRLogin{}, err
	}
	return rec, nil
}

func (s *QRStore) PeekToken(ctx context.Context, tokenHash string) (string, error) {
	return s.tokenResult(s.rdb.Get(ctx, qrTokKey(tokenHash)).Result())
}

// ClaimToken снимает указатель атомарно (GETDEL, Redis ≥ 6.2): из двух
// одновременных подтверждений ключ получит ровно одно.
func (s *QRStore) ClaimToken(ctx context.Context, tokenHash string) (string, error) {
	return s.tokenResult(s.rdb.GetDel(ctx, qrTokKey(tokenHash)).Result())
}

func (s *QRStore) tokenResult(v string, err error) (string, error) {
	if errors.Is(err, goredis.Nil) {
		return "", domain.ErrNotFound
	}
	return v, err
}

func (s *QRStore) PutByKey(ctx context.Context, keyHash string, rec domain.QRLogin, ttl time.Duration) error {
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, qrKeyKey(keyHash), b, ttl).Err()
}

func (s *QRStore) DeleteByKey(ctx context.Context, keyHash string) error {
	return s.rdb.Del(ctx, qrKeyKey(keyHash)).Err()
}
