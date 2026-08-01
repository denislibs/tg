package http

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger — access-лог без утечки токенов. chi middleware.Logger писал
// полный RequestURI (с query), из-за чего сессионный/медиа-токен в ?token= (media,
// ws), а также bot/QR-токены в пути оседали в stdout-логах. Здесь query не
// логируется вовсе, а токен-сегменты путей маскируются.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		log.Printf("%s %s %d %dB %s", r.Method, redactPath(r.URL.Path), ww.Status(), ww.BytesWritten(), time.Since(start))
	})
}

// redactPath маскирует секреты, живущие В ПУТИ: /bot/{token}/{method} и
// /auth/qr/{token}. Остальные пути — как есть (query отбрасывается в логгере).
func redactPath(p string) string {
	if strings.HasPrefix(p, "/bot/") {
		rest := p[len("/bot/"):]
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			return "/bot/***" + rest[i:] // /bot/***/sendMessage
		}
		return "/bot/***"
	}
	// /auth/qr/new — это POST создания, не токен; /auth/qr/{token} — GET статуса.
	if strings.HasPrefix(p, "/auth/qr/") && p != "/auth/qr/new" {
		return "/auth/qr/***"
	}
	return p
}
