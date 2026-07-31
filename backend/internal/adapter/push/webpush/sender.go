// Package webpush sends Web Push notifications via the VAPID protocol.
package webpush

import (
	"context"
	"io"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

// pushTimeout — предел на доставку одного уведомления push-сервису.
const pushTimeout = 10 * time.Second

// WebPushSender implements usecasepush.Sender over the Web Push protocol.
type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
	// SSRF-безопасный клиент: endpoint подписки задаёт клиент, гард в
	// DialContext резолвит хост и запрещает loopback/private/link-local (в т.ч.
	// на DNS-rebind), чтобы push-эндпоинт не заставил сервер сходить во
	// внутреннюю сеть/метадата-сервис.
	client *http.Client
}

func NewSender(publicKey, privateKey, subject string) *WebPushSender {
	return &WebPushSender{
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		client:     usecaseiv.NewSafeHTTPClient(pushTimeout),
	}
}

var _ usecasepush.Sender = (*WebPushSender)(nil)

func (s *WebPushSender) Send(ctx context.Context, sub domain.PushSubscription, payload []byte) (int, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             60,
	})
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}
