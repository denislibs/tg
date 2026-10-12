// Package linkpreview — адаптер серверных превью ссылок: качает страницу
// SSRF-безопасным клиентом (общая фабрика с adapter/iv) и вынимает og-теги
// (+ twitter:*-фолбэк) для карточки web page под сообщением.
package linkpreview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

const (
	// fetchTimeout — потолок одного запроса на случай вызова без дедлайна;
	// обычно раньше срабатывает дедлайн контекста usecase (previewTimeout):
	// тяжёлая страница не должна обрываться на 5 с, пока бюджет этапа не
	// исчерпан.
	fetchTimeout = 30 * time.Second
	maxBody      = 1 << 20 // 1 МБ HTML: og-теги живут в <head>, больше не нужно
	// UA обычного браузера: многие сайты отдают ботам обрезанную вёрстку.
	userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

// Client реализует порт chat.LinkPreviewer.
type Client struct{ http *http.Client }

var _ usecasechat.LinkPreviewer = (*Client)(nil)

// New строит превьюер на общем SSRF-безопасном клиенте.
func New() *Client {
	return &Client{http: usecaseiv.NewSafeHTTPClient(fetchTimeout)}
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
		return nil, fetchError(u.Hostname(), err)
	}
	defer resp.Body.Close()
	if err := statusError(u.Hostname(), resp.StatusCode); err != nil {
		return nil, err
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

// fetchError — ошибка запроса страницы с разбором «временная или нет»
// (usecasechat.ErrPreviewTransient: повтор может пройти). Временные — сеть,
// таймаут, обрыв; нет — кривой адрес, отказ SSRF-гарда, несуществующий хост.
// *url.Error разворачивается: его текст несёт полный адрес с путём и query,
// а ошибка уходит в лог.
func fetchError(host string, err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	var dnsErr *net.DNSError
	if errors.Is(err, usecaseiv.ErrBadURL) || errors.Is(err, usecaseiv.ErrForbiddenTarget) ||
		(errors.As(err, &dnsErr) && dnsErr.IsNotFound) {
		return fmt.Errorf("link preview fetch %s: %w", host, err)
	}
	return fmt.Errorf("link preview fetch %s: %w: %w", host, usecasechat.ErrPreviewTransient, err)
}

// statusError — ответ не 2xx. 5xx — временная; 429 — нет: сайт просит
// снизить частоту, и повтор через секунду почти наверняка снова получит 429.
func statusError(host string, code int) error {
	switch {
	case code >= 200 && code <= 299:
		return nil
	case code >= 500:
		return fmt.Errorf("link preview %s: status %d: %w", host, code, usecasechat.ErrPreviewTransient)
	}
	return fmt.Errorf("link preview %s: status %d", host, code)
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
