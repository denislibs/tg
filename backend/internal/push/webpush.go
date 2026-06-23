package push

import (
	"context"
	"io"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// WebPushSender sends notifications via the Web Push protocol (VAPID).
type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
}

func NewWebPushSender(publicKey, privateKey, subject string) *WebPushSender {
	return &WebPushSender{publicKey: publicKey, privateKey: privateKey, subject: subject}
}

func (s *WebPushSender) Send(ctx context.Context, sub Subscription, payload []byte) (int, error) {
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
