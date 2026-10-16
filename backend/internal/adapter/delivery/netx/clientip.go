// Package netx — сетевые мелочи, общие для http- и ws-витрин.
package netx

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP — реальный IP клиента за доверенным обратным прокси (nginx). Клиент
// НЕ должен уметь его подделать: иначе смена заголовка обходит rate-limit/анти-
// брутфорс и подделывает IP/гео в login-alert.
//   - X-Real-IP nginx ставит в $remote_addr (реальный peer) и ПЕРЕЗАПИСЫВАЕТ
//     присланное клиентом — берём его в первую очередь.
//   - X-Forwarded-For клиент-контролируем в ЛЕВОЙ части; nginx добавляет реальный
//     peer в КОНЕЦ ($proxy_add_x_forwarded_for), поэтому fallback — ПРАВАЯ запись.
//   - Иначе (без прокси, тесты) — RemoteAddr.
func ClientIP(r *http.Request) string {
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" && net.ParseIP(xr) != nil {
		return xr
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
			return last
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
