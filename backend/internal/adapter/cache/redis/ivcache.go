package redis

import (
	"context"
	"encoding/json"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

// IVCache хранит распарсенные Instant View статьи под ключом iv:<sha1(url)>
// (ключ формирует usecase). Ошибки Redis глотаются: кэш — best effort,
// промах просто ведёт к повторному парсингу.
type IVCache struct{ rdb *goredis.Client }

var _ usecaseiv.Cache = (*IVCache)(nil)

func NewIVCache(rdb *goredis.Client) *IVCache { return &IVCache{rdb: rdb} }

func (c *IVCache) Get(ctx context.Context, key string) (domain.IVArticle, bool) {
	b, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		return domain.IVArticle{}, false
	}
	var art domain.IVArticle
	if err := json.Unmarshal(b, &art); err != nil {
		return domain.IVArticle{}, false
	}
	return art, true
}

func (c *IVCache) Set(ctx context.Context, key string, art domain.IVArticle, ttl time.Duration) {
	b, err := json.Marshal(art)
	if err != nil {
		return
	}
	c.rdb.Set(ctx, key, b, ttl)
}
