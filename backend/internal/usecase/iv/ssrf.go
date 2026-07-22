package iv

import (
	"fmt"
	"net"
	"net/url"
	"strings"
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
