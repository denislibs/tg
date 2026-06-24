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

// QRStore stores QR-login records in Redis under "qrlogin:{tokenHash}". It
// implements the auth usecase's QRStore port.
type QRStore struct{ rdb *goredis.Client }

var _ usecaseauth.QRStore = (*QRStore)(nil)

func NewQRStore(rdb *goredis.Client) *QRStore { return &QRStore{rdb: rdb} }

func qrKey(tokenHash string) string { return "qrlogin:" + tokenHash }

func (s *QRStore) Put(ctx context.Context, tokenHash string, rec domain.QRLogin, ttl time.Duration) error {
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, qrKey(tokenHash), b, ttl).Err()
}

func (s *QRStore) Get(ctx context.Context, tokenHash string) (domain.QRLogin, error) {
	b, err := s.rdb.Get(ctx, qrKey(tokenHash)).Bytes()
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

func (s *QRStore) Delete(ctx context.Context, tokenHash string) error {
	return s.rdb.Del(ctx, qrKey(tokenHash)).Err()
}
