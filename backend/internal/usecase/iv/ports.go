package iv

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Fetcher загружает страницу по URL и извлекает reader-mode статью
// (адаптер поверх go-readability, с анти-SSRF-гардом на дозвоне).
type Fetcher interface {
	Fetch(ctx context.Context, url string) (domain.IVArticle, error)
}

// Cache — опциональный кэш статей (Redis). Интерактор nil-safe: без кэша
// каждая загрузка идёт в Fetcher (мягкая деградация при недоступном Redis).
type Cache interface {
	Get(ctx context.Context, key string) (domain.IVArticle, bool)
	Set(ctx context.Context, key string, art domain.IVArticle, ttl time.Duration)
}
