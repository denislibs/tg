// Package linkpreview — адаптер серверных превью ссылок: качает страницу
// SSRF-безопасным клиентом (общая фабрика с adapter/iv) и вынимает og-теги
// (+ twitter:*-фолбэк) для карточки web page под сообщением.
package linkpreview

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"

	ivadapter "github.com/messenger-denis/backend/internal/adapter/iv"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

const (
	fetchTimeout = 5 * time.Second
	maxBody      = 1 << 20 // 1 МБ HTML: og-теги живут в <head>, больше не нужно
	// UA обычного браузера: многие сайты отдают ботам обрезанную вёрстку.
	userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

// Client реализует порт chat.LinkPreviewer.
type Client struct{ http *http.Client }

var _ usecasechat.LinkPreviewer = (*Client)(nil)

// New строит превьюер на общем SSRF-безопасном клиенте.
func New() *Client {
	return &Client{http: ivadapter.NewSafeHTTPClient(fetchTimeout)}
}

// Preview загружает страницу и собирает превью из og/twitter-мета и <title>.
// Страница без пригодного заголовка превью не даёт (ошибка).
func (c *Client) Preview(ctx context.Context, rawURL string) (*domain.WebPagePreview, error) {
	u, err := usecaseiv.ParseTargetURL(rawURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, usecaseiv.ErrBadURL
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("link preview fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("link preview %s: status %d", u.Hostname(), resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") {
		return nil, fmt.Errorf("link preview %s: not html (%s)", u.Hostname(), ct)
	}
	// База для относительных ссылок — финальный URL после редиректов.
	wp, err := Parse(io.LimitReader(resp.Body, maxBody), resp.Request.URL)
	if err != nil {
		return nil, err
	}
	wp.URL = u.String()
	return wp, nil
}

// Parse вынимает превью из HTML: og:* приоритетнее twitter:*, <title> —
// последний фолбэк заголовка, hostname — фолбэк имени сайта. Без заголовка
// превью нет (ошибка).
func Parse(r io.Reader, base *url.URL) (*domain.WebPagePreview, error) {
	root, err := html.Parse(r)
	if err != nil {
		return nil, fmt.Errorf("link preview parse: %w", err)
	}
	meta := map[string]string{}
	var pageTitle string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "meta":
				var key, content string
				for _, a := range n.Attr {
					switch a.Key {
					case "property", "name":
						key = strings.ToLower(strings.TrimSpace(a.Val))
					case "content":
						content = strings.TrimSpace(a.Val)
					}
				}
				if key != "" && content != "" {
					if _, seen := meta[key]; !seen {
						meta[key] = content
					}
				}
			case "title":
				if pageTitle == "" && n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
					pageTitle = strings.Join(strings.Fields(n.FirstChild.Data), " ")
				}
			case "body":
				return // og-теги живут в <head> — в тело не спускаемся
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)

	pick := func(keys ...string) string {
		for _, k := range keys {
			if v := meta[k]; v != "" {
				return v
			}
		}
		return ""
	}
	title := pick("og:title", "twitter:title")
	if title == "" {
		title = pageTitle
	}
	if title == "" {
		return nil, fmt.Errorf("link preview: no title")
	}
	siteName := pick("og:site_name")
	if siteName == "" {
		siteName = base.Hostname()
	}
	return &domain.WebPagePreview{
		SiteName:    siteName,
		Title:       title,
		Description: pick("og:description", "twitter:description"),
		ImageURL:    imageURL(pick("og:image", "og:image:url", "twitter:image", "twitter:image:src"), base),
	}, nil
}

// imageURL — абсолютный http/https-адрес картинки превью (относительные —
// через base); непригодное значение отбрасывается.
func imageURL(src string, base *url.URL) string {
	if src == "" {
		return ""
	}
	u, err := url.Parse(src)
	if err != nil {
		return ""
	}
	abs := base.ResolveReference(u)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return ""
	}
	return abs.String()
}
