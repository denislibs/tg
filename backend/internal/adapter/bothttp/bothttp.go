// Package bothttp — исходящий HTTP бот-движка (реализация порта chat.BotHTTP):
// доставка апдейтов на webhook и загрузка медиа бота по URL. Все запросы идут
// SSRF-безопасным клиентом (usecaseiv.NewSafeHTTPClient): хост резолвится и
// запрещены loopback/private/link-local (в т.ч. на DNS-rebind). Держит net/http
// вне usecase.
package bothttp

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

const requestTimeout = 20 * time.Second

// Client реализует порт chat.BotHTTP.
type Client struct{ http *http.Client }

var _ usecasechat.BotHTTP = (*Client)(nil)

func New() *Client { return &Client{http: usecaseiv.NewSafeHTTPClient(requestTimeout)} }

// PostWebhook доставляет апдейт боту (fire-and-forget). Невалидный (не
// абсолютный http/https) URL отбрасываем; резолв/анти-SSRF — в safe-клиенте.
func (c *Client) PostWebhook(ctx context.Context, url string, body []byte) {
	if _, err := usecaseiv.ParseTargetURL(url); err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

// FetchURL качает файл по URL с лимитом размера; mime берётся из заголовка ответа
// либо определяется по содержимому. Ошибки — типизированные chat-ошибки.
func (c *Client) FetchURL(ctx context.Context, url string, maxBytes int64) ([]byte, string, error) {
	if _, err := usecaseiv.ParseTargetURL(url); err != nil {
		return nil, "", domain.ErrForbidden
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", domain.ErrNotFound
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", domain.ErrTooLong
	}
	mime := resp.Header.Get("Content-Type")
	if idx := strings.IndexByte(mime, ';'); idx >= 0 {
		mime = strings.TrimSpace(mime[:idx])
	}
	if mime == "" || mime == "application/octet-stream" {
		mime = http.DetectContentType(data)
	}
	return data, mime, nil
}
