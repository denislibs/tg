// Package webpush sends Web Push notifications via the VAPID protocol.
package webpush

import (
	"context"
	"io"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

// WebPushSender implements usecasepush.Sender over the Web Push protocol.
type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
}

func NewSender(publicKey, privateKey, subject string) *WebPushSender {
	return &WebPushSender{publicKey: publicKey, privateKey: privateKey, subject: subject}
}

var _ usecasepush.Sender = (*WebPushSender)(nil)

func (s *WebPushSender) Send(ctx context.Context, sub domain.PushSubscription, payload []byte) (int, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
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
