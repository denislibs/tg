package iv

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ParseTargetURL валидирует пользовательский URL для Instant View:
// только абсолютные http/https-ссылки с непустым хостом.
func ParseTargetURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return nil, ErrBadURL
	}
	return u, nil
}

// AllowedIP — анти-SSRF: запрещает loopback/private/link-local/unspecified/
// multicast адреса, чтобы через /iv нельзя было заставить бэкенд сходить
// в localhost или внутреннюю сеть.
func AllowedIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return !(ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast())
}

// CheckResolved проверяет КАЖДЫЙ резолвнутый IP хоста: достаточно одного
// запрещённого адреса для отказа (защита от DNS-записей, смешивающих
// публичные и приватные адреса).
func CheckResolved(host string, ips []net.IP) error {
	if len(ips) == 0 {
		return fmt.Errorf("%s: no addresses resolved", host)
	}
	for _, ip := range ips {
		if !AllowedIP(ip) {
			return fmt.Errorf("%s resolves to forbidden address %s", host, ip)
		}
	}
	return nil
}

// NewSafeHTTPClient — общий HTTP-клиент с анти-SSRF гардом в DialContext: хост
// резолвится, КАЖДЫЙ адрес проверяется (CheckResolved), соединение идёт на
// конкретный проверенный IP. Гард срабатывает и на редиректах (каждый новый
// хост дозванивается заново + редирект только на http/https). Резолв в момент
// дозвона закрывает и DNS-rebind. Общий для Instant View, превью ссылок,
// bot-webhook и web-push.
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
			if err := CheckResolved(host, ips); err != nil {
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
			if _, err := ParseTargetURL(req.URL.String()); err != nil {
				return err // редирект только на http/https
			}
			return nil
		},
	}
}
