// Package iv — адаптер Instant View: качает страницу (с анти-SSRF-гардом на
// каждом дозвоне) и превращает её в типизированные блоки через go-readability.
package iv

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"context"

	readability "github.com/go-shiori/go-readability"
	"golang.org/x/net/html"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

const (
	fetchTimeout = 10 * time.Second
	maxBody      = 5 << 20 // 5 МБ HTML достаточно любой статье
	// UA обычного браузера: многие сайты отдают ботам обрезанную вёрстку.
	userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

// Client реализует порт iv.Fetcher.
type Client struct{ http *http.Client }

var _ usecaseiv.Fetcher = (*Client)(nil)

// New строит клиент с SSRF-гардом (см. NewSafeHTTPClient).
func New() *Client {
	return &Client{http: NewSafeHTTPClient(fetchTimeout)}
}

// NewSafeHTTPClient — общий HTTP-клиент с анти-SSRF гардом в DialContext: хост
// резолвится, КАЖДЫЙ адрес проверяется, соединение идёт на конкретный
// проверенный IP. Гард срабатывает и на редиректах (каждый новый хост
// дозванивается заново). Используется Instant View и превью ссылок.
func NewSafeHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if err := usecaseiv.CheckResolved(host, ips); err != nil {
				return nil, err
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
		TLSHandshakeTimeout: 5 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if _, err := usecaseiv.ParseTargetURL(req.URL.String()); err != nil {
				return err // редирект только на http/https
			}
			return nil
		},
	}
}

// Fetch загружает страницу и извлекает reader-mode статью.
func (c *Client) Fetch(ctx context.Context, rawURL string) (domain.IVArticle, error) {
	u, err := usecaseiv.ParseTargetURL(rawURL)
	if err != nil {
		return domain.IVArticle{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return domain.IVArticle{}, usecaseiv.ErrBadURL
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
	resp, err := c.http.Do(req)
	if err != nil {
		return domain.IVArticle{}, fmt.Errorf("iv fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return domain.IVArticle{}, fmt.Errorf("iv fetch %s: status %d: %w", u.Hostname(), resp.StatusCode, usecaseiv.ErrUnparsable)
	}

	// База для относительных ссылок — финальный URL после редиректов.
	base := resp.Request.URL
	art, err := readability.FromReader(io.LimitReader(resp.Body, maxBody), base)
	if err != nil {
		return domain.IVArticle{}, fmt.Errorf("iv parse: %w", usecaseiv.ErrUnparsable)
	}
	root := art.Node
	if root == nil {
		if root, err = html.Parse(strings.NewReader(art.Content)); err != nil {
			return domain.IVArticle{}, fmt.Errorf("iv parse: %w", usecaseiv.ErrUnparsable)
		}
	}
	blocks := collectBlocks(root, base)
	if len(blocks) == 0 {
		return domain.IVArticle{}, fmt.Errorf("iv: empty article: %w", usecaseiv.ErrUnparsable)
	}
	siteName := art.SiteName
	if siteName == "" {
		siteName = base.Hostname()
	}
	return domain.IVArticle{Title: art.Title, Byline: art.Byline, SiteName: siteName, Blocks: blocks}, nil
}

// collectBlocks обходит DOM статьи в порядке документа и собирает блоки.
// Внутрь распознанных блоков (p/h*/blockquote/pre/ul/ol) не спускаемся —
// текст флаттится; картинки внутри абзацев вынимаются отдельными блоками.
func collectBlocks(root *html.Node, base *url.URL) []domain.IVBlock {
	var out []domain.IVBlock
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "noscript", "iframe", "svg":
				return
			case "p":
				if t := flatText(n); t != "" {
					out = append(out, domain.IVBlock{Type: domain.IVBlockP, Text: t})
				}
				out = append(out, imgBlocks(n, base)...)
				return
			case "h1", "h2", "h3": // все заголовки контента → h2 (h1 — заголовок статьи)
				if t := flatText(n); t != "" {
					out = append(out, domain.IVBlock{Type: domain.IVBlockH2, Text: t})
				}
				return
			case "blockquote":
				if t := flatText(n); t != "" {
					out = append(out, domain.IVBlock{Type: domain.IVBlockBlockquote, Text: t})
				}
				return
			case "pre":
				if t := strings.Trim(rawText(n), "\n"); strings.TrimSpace(t) != "" {
					out = append(out, domain.IVBlock{Type: domain.IVBlockPre, Text: t})
				}
				return
			case "ul", "ol":
				var items []string
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.ElementNode && c.Data == "li" {
						if t := flatText(c); t != "" {
							items = append(items, t)
						}
					}
				}
				if len(items) > 0 {
					out = append(out, domain.IVBlock{Type: n.Data, Items: items})
				}
				return
			case "img":
				if src := imgSrc(n, base); src != "" {
					out = append(out, domain.IVBlock{Type: domain.IVBlockImg, Src: src})
				}
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return out
}

// imgBlocks вынимает картинки из поддерева уже обработанного текстового блока.
func imgBlocks(n *html.Node, base *url.URL) []domain.IVBlock {
	var out []domain.IVBlock
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "img" {
			if src := imgSrc(n, base); src != "" {
				out = append(out, domain.IVBlock{Type: domain.IVBlockImg, Src: src})
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return out
}

// imgSrc — абсолютный http/https-адрес картинки (относительные — через base).
func imgSrc(n *html.Node, base *url.URL) string {
	var src string
	for _, a := range n.Attr {
		if a.Key == "src" {
			src = strings.TrimSpace(a.Val)
			break
		}
	}
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

// flatText — плоский текст поддерева со схлопнутыми пробелами; <br> → пробел.
func flatText(n *html.Node) string {
	return strings.Join(strings.Fields(rawText(n)), " ")
}

// rawText — конкатенация текстовых узлов как есть (для pre); <br> → перенос.
func rawText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		switch {
		case n.Type == html.TextNode:
			b.WriteString(n.Data)
		case n.Type == html.ElementNode && n.Data == "br":
			b.WriteString("\n")
		case n.Type == html.ElementNode && (n.Data == "script" || n.Data == "style"):
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}
