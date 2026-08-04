package http

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"

	"github.com/messenger-denis/backend/internal/domain"
)

// RouterRPC реплеит rpc-запрос канала через реальный chi-роутер.
type RouterRPC struct{ router http.Handler }

func NewRouterRPC(router http.Handler) *RouterRPC { return &RouterRPC{router: router} }

// Dispatch строит синтетический http.Request с пред-инжектённым юзером канала и
// прогоняет его через роутер, возвращая статус и тело ответа. AuthMiddleware
// пропускает ре-аутентификацию (юзер уже в ctx); хендлеры читают UserFromContext.
func (d *RouterRPC) Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte) {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req = req.WithContext(WithUser(ctx, user, deviceID))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	d.router.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}
