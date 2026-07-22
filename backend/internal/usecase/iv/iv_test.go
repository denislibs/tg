package iv

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeFetcher struct {
	art   domain.IVArticle
	err   error
	calls int
}

func (f *fakeFetcher) Fetch(_ context.Context, _ string) (domain.IVArticle, error) {
	f.calls++
	return f.art, f.err
}

type fakeCache struct {
	m    map[string]domain.IVArticle
	sets int
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]domain.IVArticle{}} }

func (c *fakeCache) Get(_ context.Context, key string) (domain.IVArticle, bool) {
	art, ok := c.m[key]
	return art, ok
}

func (c *fakeCache) Set(_ context.Context, key string, art domain.IVArticle, _ time.Duration) {
	c.sets++
	c.m[key] = art
}

func TestArticle_BadURL(t *testing.T) {
	uc := New(&fakeFetcher{}, nil)
	for _, raw := range []string{"", "ftp://x.com", "nope"} {
		if _, err := uc.Article(context.Background(), raw); !errors.Is(err, ErrBadURL) {
			t.Errorf("Article(%q): got %v, want ErrBadURL", raw, err)
		}
	}
}

func TestArticle_MappingAndLimits(t *testing.T) {
	long := strings.Repeat("я", maxBlockRunes+100)
	blocks := []domain.IVBlock{
		{Type: "p", Text: "  привет  "},
		{Type: "p", Text: "   "}, // пустой — скип
		{Type: "h2", Text: long}, // клампится по рунам
		{Type: "img", Src: "https://ex.com/a.png"},
		{Type: "img", Src: "javascript:alert(1)"},          // не http(s) — скип
		{Type: "ul", Items: []string{" один ", "", "два"}}, // пустые items — скип
		{Type: "ol", Items: []string{"", "  "}},            // весь блок пуст — скип
		{Type: "marquee", Text: "мимо"},                    // неизвестный тип — скип
		{Type: "blockquote", Text: "цитата"},
		{Type: "pre", Text: "code()"},
	}
	// добиваем сверх лимита блоков
	for i := 0; i < maxBlocks+50; i++ {
		blocks = append(blocks, domain.IVBlock{Type: "p", Text: "x"})
	}
	f := &fakeFetcher{art: domain.IVArticle{Title: "T", Byline: "B", SiteName: "S", Blocks: blocks}}
	uc := New(f, nil)

	art, err := uc.Article(context.Background(), "https://example.com/article")
	if err != nil {
		t.Fatalf("Article: %v", err)
	}
	if art.Title != "T" || art.Byline != "B" || art.SiteName != "S" {
		t.Errorf("meta not mapped: %+v", art)
	}
	if len(art.Blocks) != maxBlocks {
		t.Fatalf("blocks = %d, want clamp to %d", len(art.Blocks), maxBlocks)
	}
	if art.Blocks[0].Text != "привет" {
		t.Errorf("p not trimmed: %q", art.Blocks[0].Text)
	}
	if got := len([]rune(art.Blocks[1].Text)); got != maxBlockRunes {
		t.Errorf("h2 runes = %d, want %d", got, maxBlockRunes)
	}
	if art.Blocks[2].Type != "img" || art.Blocks[2].Src != "https://ex.com/a.png" {
		t.Errorf("img block wrong: %+v", art.Blocks[2])
	}
	if art.Blocks[3].Type != "ul" || len(art.Blocks[3].Items) != 2 || art.Blocks[3].Items[0] != "один" {
		t.Errorf("ul block wrong: %+v", art.Blocks[3])
	}
	if art.Blocks[4].Type != "blockquote" || art.Blocks[5].Type != "pre" {
		t.Errorf("order wrong: %+v %+v", art.Blocks[4], art.Blocks[5])
	}
}

func TestArticle_EmptyResultUnparsable(t *testing.T) {
	f := &fakeFetcher{art: domain.IVArticle{Blocks: []domain.IVBlock{{Type: "p", Text: "  "}}}}
	uc := New(f, nil)
	if _, err := uc.Article(context.Background(), "https://example.com"); !errors.Is(err, ErrUnparsable) {
		t.Errorf("got %v, want ErrUnparsable", err)
	}
}

func TestArticle_FetcherError(t *testing.T) {
	sentinel := errors.New("boom")
	uc := New(&fakeFetcher{err: sentinel}, newFakeCache())
	if _, err := uc.Article(context.Background(), "https://example.com"); !errors.Is(err, sentinel) {
		t.Errorf("got %v, want fetcher error", err)
	}
}

func TestArticle_CacheHit(t *testing.T) {
	f := &fakeFetcher{art: domain.IVArticle{Title: "T", Blocks: []domain.IVBlock{{Type: "p", Text: "x"}}}}
	cache := newFakeCache()
	uc := New(f, cache)
	ctx := context.Background()

	if _, err := uc.Article(ctx, "https://example.com/a"); err != nil {
		t.Fatalf("first: %v", err)
	}
	if f.calls != 1 || cache.sets != 1 {
		t.Fatalf("after first: calls=%d sets=%d", f.calls, cache.sets)
	}
	art, err := uc.Article(ctx, "https://example.com/a")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if f.calls != 1 {
		t.Errorf("cache hit must not refetch: calls=%d", f.calls)
	}
	if art.Title != "T" {
		t.Errorf("cached article wrong: %+v", art)
	}
	// другой URL — другой ключ, снова Fetch
	if _, err := uc.Article(ctx, "https://example.com/b"); err != nil {
		t.Fatalf("third: %v", err)
	}
	if f.calls != 2 {
		t.Errorf("different url must fetch: calls=%d", f.calls)
	}
}
