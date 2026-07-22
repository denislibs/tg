// Package iv — usecase Instant View: reader-mode парсинг статьи по URL
// с часовым кэшем и жёсткими лимитами на размер результата.
package iv

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

var (
	// ErrBadURL — кривой/не-http(s) URL (HTTP 400).
	ErrBadURL = errors.New("invalid url")
	// ErrUnparsable — страница загрузилась, но читаемой статьи в ней нет (HTTP 422).
	ErrUnparsable = errors.New("article not parsable")
)

const (
	cacheTTL      = time.Hour
	maxBlocks     = 500
	maxBlockRunes = 10000
)

// Interactor отдаёт reader-mode статью по URL: кэш → Fetcher → лимиты → кэш.
type Interactor struct {
	fetcher Fetcher
	cache   Cache // nil при недоступном Redis — работаем без кэша
}

func New(fetcher Fetcher, cache Cache) *Interactor {
	return &Interactor{fetcher: fetcher, cache: cache}
}

func cacheKey(url string) string {
	sum := sha1.Sum([]byte(url))
	return "iv:" + hex.EncodeToString(sum[:])
}

// Article возвращает статью для Instant View по пользовательскому URL.
func (i *Interactor) Article(ctx context.Context, rawURL string) (domain.IVArticle, error) {
	u, err := ParseTargetURL(rawURL)
	if err != nil {
		return domain.IVArticle{}, err
	}
	key := cacheKey(u.String())
	if i.cache != nil {
		if art, ok := i.cache.Get(ctx, key); ok {
			return art, nil
		}
	}
	art, err := i.fetcher.Fetch(ctx, u.String())
	if err != nil {
		return domain.IVArticle{}, err
	}
	art.Blocks = clampBlocks(art.Blocks)
	if art.Title == "" && len(art.Blocks) == 0 {
		return domain.IVArticle{}, ErrUnparsable
	}
	if i.cache != nil {
		i.cache.Set(ctx, key, art, cacheTTL)
	}
	return art, nil
}

// clampBlocks применяет лимиты: ≤maxBlocks блоков, текст ≤maxBlockRunes рун,
// пустые блоки и неизвестные типы отбрасываются; img — только http/https.
func clampBlocks(in []domain.IVBlock) []domain.IVBlock {
	out := make([]domain.IVBlock, 0, min(len(in), maxBlocks))
	for _, b := range in {
		if len(out) == maxBlocks {
			break
		}
		switch b.Type {
		case domain.IVBlockP, domain.IVBlockH1, domain.IVBlockH2, domain.IVBlockBlockquote, domain.IVBlockPre:
			b.Text = clampRunes(strings.TrimSpace(b.Text), maxBlockRunes)
			b.Src, b.Items = "", nil
			if b.Text == "" {
				continue
			}
		case domain.IVBlockImg:
			b.Text, b.Items = "", nil
			if !httpURL(b.Src) {
				continue
			}
		case domain.IVBlockUL, domain.IVBlockOL:
			b.Text, b.Src = "", ""
			items := make([]string, 0, len(b.Items))
			for _, it := range b.Items {
				it = clampRunes(strings.TrimSpace(it), maxBlockRunes)
				if it != "" {
					items = append(items, it)
				}
			}
			if len(items) == 0 {
				continue
			}
			b.Items = items
		default:
			continue
		}
		out = append(out, b)
	}
	return out
}

func clampRunes(s string, max int) string {
	if len(s) <= max { // байтовая длина ≥ рунной — быстрый путь
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func httpURL(s string) bool {
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}
