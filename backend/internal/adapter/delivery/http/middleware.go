package http

import (
	"context"
	"net/http"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

type ctxKey int

const userKey ctxKey = 0
const deviceKey ctxKey = 1

// Authenticator resolves a bearer token to the authenticated user + device.
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (domain.UserRecord, int64, error)
}

// WithUser пред-инжектит аутентифицированного (доверенным каналом, in-process)
// юзера в ctx — так AuthMiddleware пропускает ре-аутентификацию по заголовку.
// Внешние HTTP-запросы так юзера подсунуть НЕ могут (их ctx строится сервером с нуля).
func WithUser(ctx context.Context, user domain.UserRecord, deviceID int64) context.Context {
	ctx = context.WithValue(ctx, userKey, user)
	return context.WithValue(ctx, deviceKey, deviceID)
}

// AuthMiddleware validates the Bearer token and injects the user into the context.
func AuthMiddleware(a Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := UserFromContext(r.Context()); ok {
				next.ServeHTTP(w, r) // юзер уже пред-инжектён доверенным in-process каналом
				return
			}
			token := bearerToken(r)
			if token == "" {
				writeError(w, http.StatusUnauthorized, "missing token")
				return
			}
			// Версия сборки клиента едет в ctx ДО разрешения токена: на
			// промахе кэша сессий usecase освежит ею строку устройства тем же
			// запросом, что двигает last_active. Иначе экран сессий вечно
			// показывал бы версию, с которой когда-то вошли, — клиент
			// обновляется сам, а строка нет.
			ctx := usecaseauth.WithClientInfo(r.Context(),
				usecaseauth.ClientInfo{AppVersion: clientAppVersion(r)})
			user, deviceID, err := a.Authenticate(ctx, token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ctx = context.WithValue(ctx, userKey, user)
			ctx = context.WithValue(ctx, deviceKey, deviceID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

// UserFromContext returns the authenticated user, if any.
func UserFromContext(ctx context.Context) (domain.UserRecord, bool) {
	u, ok := ctx.Value(userKey).(domain.UserRecord)
	return u, ok
}

// DeviceIDFromContext returns the authenticated device id, if any.
func DeviceIDFromContext(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(deviceKey).(int64)
	return id, ok
}
