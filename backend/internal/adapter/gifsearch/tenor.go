// Package gifsearch реализует порт stickers.GifSearcher через Tenor API v2
// (единственный внешний вызов фичи стикеров/GIF).
package gifsearch

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

const tenorBaseURL = "https://tenor.googleapis.com/v2"

// Tenor — клиент Tenor v2 (search/featured) с ключом из TENOR_API_KEY.
type Tenor struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func NewTenor(apiKey string) *Tenor {
	return &Tenor{
		apiKey:  apiKey,
		baseURL: tenorBaseURL,
		// Внешний сервис не должен подвешивать наш запрос: жёсткий таймаут.
		client: &http.Client{Timeout: 8 * time.Second},
	}
}

// tenorResponse — интересующая нас часть ответа Tenor v2.
type tenorResponse struct {
	Results []struct {
		ID           string `json:"id"`
		MediaFormats map[string]struct {
			URL  string `json:"url"`
			Dims []int  `json:"dims"`
		} `json:"media_formats"`
	} `json:"results"`
	Next string `json:"next"`
}

// SearchGifs ищет GIF по запросу q (пустой q → трендовые, endpoint featured).
// pos — курсор пагинации Tenor.
func (t *Tenor) SearchGifs(ctx context.Context, q, pos string, limit int) (usecasestickers.GifPage, error) {
	endpoint := "/search"
	if q == "" {
		endpoint = "/featured"
	}
	params := url.Values{
		"key":           {t.apiKey},
		"limit":         {strconv.Itoa(limit)},
		"media_filter":  {"mp4,gif,tinygif"},
		"contentfilter": {"medium"},
	}
	if q != "" {
		params.Set("q", q)
	}
	if pos != "" {
		params.Set("pos", pos)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.baseURL+endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return usecasestickers.GifPage{}, err
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return usecasestickers.GifPage{}, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // страница из 30 GIF-мет — заведомо меньше
	if resp.StatusCode != http.StatusOK {
		return usecasestickers.GifPage{}, fmt.Errorf("tenor: status %d", resp.StatusCode)
	}
	var out tenorResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return usecasestickers.GifPage{}, fmt.Errorf("tenor: bad response: %w", err)
	}
	page := usecasestickers.GifPage{Gifs: make([]usecasestickers.Gif, 0, len(out.Results)), Next: out.Next}
	for _, r := range out.Results {
		g := usecasestickers.Gif{ID: r.ID}
		if f, ok := r.MediaFormats["mp4"]; ok {
			g.MP4URL = f.URL
			if len(f.Dims) == 2 {
				g.Width, g.Height = f.Dims[0], f.Dims[1]
			}
		}
		if f, ok := r.MediaFormats["gif"]; ok {
			g.GifURL = f.URL
			if g.Width == 0 && len(f.Dims) == 2 {
				g.Width, g.Height = f.Dims[0], f.Dims[1]
			}
		}
		if f, ok := r.MediaFormats["tinygif"]; ok {
			g.PreviewURL = f.URL
		}
		// Результат без единого воспроизводимого URL бесполезен клиенту.
		if g.MP4URL == "" && g.GifURL == "" {
			continue
		}
		page.Gifs = append(page.Gifs, g)
	}
	return page, nil
}
