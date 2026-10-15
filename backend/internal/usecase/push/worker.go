package push

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Worker consumes the push queue, enriches each job, sends to a recipient's
// subscriptions, and prunes expired ones (404/410).
type Worker struct {
	queue  Queue
	subs   SubRepo
	sender Sender
	enrich Enricher
}

func NewWorker(queue Queue, subs SubRepo, sender Sender, enrich Enricher) *Worker {
	return &Worker{queue: queue, subs: subs, sender: sender, enrich: enrich}
}

// Run consumes the queue until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := w.ProcessBatch(ctx); err != nil && ctx.Err() == nil {
			time.Sleep(time.Second) // back off on transient errors
		}
	}
}

// ProcessBatch reads and handles up to a few pending jobs. Exposed for tests.
func (w *Worker) ProcessBatch(ctx context.Context) error {
	jobs, err := w.queue.Consume(ctx, 10, 5000)
	if err != nil {
		return err
	}
	for _, qj := range jobs {
		// Ack only when the job is handled or is a poison pill; a transient
		// failure leaves it pending for redelivery (at-least-once).
		if w.handle(ctx, qj.Job) {
			_ = w.queue.Ack(ctx, qj.ID)
		}
	}
	return nil
}

// handle processes one job. Returns true if the message should be ACKed
// (delivered or no subscriptions) and false on a transient error that warrants
// redelivery.
func (w *Worker) handle(ctx context.Context, job Job) bool {
	subs, err := w.subs.ForUser(ctx, job.RecipientID)
	if err != nil {
		return false // transient DB error — retry later
	}
	if len(subs) == 0 {
		return true // nobody to push to
	}
	payload, _ := json.Marshal(w.buildPayload(ctx, job))
	retry := false
	for _, sub := range subs {
		status, err := w.sender.Send(ctx, sub, payload)
		switch {
		case err != nil:
			// Транзиентная ошибка доставки (сеть/5xx push-сервиса) — джоб на
			// redelivery, чтобы уведомление не потерялось (мёртвый endpoint
			// вернул бы 404/410 — см. ниже; повтор для него не сработает).
			retry = true
		case status == http.StatusNotFound || status == http.StatusGone:
			_ = w.subs.DeleteByEndpoint(ctx, sub.Endpoint)
		}
	}
	return !retry
}

// Значения loc_key тела пуша. tweb читает только НАЛИЧИЕ ключа (push.ts:439-443:
// без него — заголовок «Telegram» и общий текст), поэтому других ключей, как у
// настоящего Telegram (MESSAGE_PHOTO, CHAT_MESSAGE_TEXT …), не вводим.
const (
	locKeyText   = "MESSAGE_TEXT"
	locKeyNoText = "MESSAGE_NOTEXT"
)

// buildPayload собирает тело Web Push в форме PushNotificationObject tweb
// (lib/serviceWorker/push.ts:30-54): title, description, loc_key/loc_args и
// custom{msg_id, from_id | channel_id}. С выключенным Message Preview нет ни
// loc_key, ни loc_args, ни description — клиент покажет общий текст.
//
// Конструктором `message` этот payload НЕ становится, и основание одно —
// предмет ДРУГОЙ: это тело Web Push-уведомления, которое читает service worker
// у выключенного приложения. Кэша пиров у него нет вовсе, поэтому имя
// отправителя здесь ДОЛЖНО быть склеено сервером — единственное оставшееся
// место, где это законно, и ровно то же исключение, что у публичной страницы
// /u/{username}. Ровно так устроен и оригинал: push-payload у него свой
// (title/body/custom), а не Message.
//
// Отличия от оригинала (объявлены): `user_id` (мультиаккаунт) и `silent` не
// производятся; заголовок группы — имя автора без названия чата.
func (w *Worker) buildPayload(ctx context.Context, job Job) map[string]any {
	title := job.Title
	if title == "" {
		title, _ = w.enrich.SenderName(ctx, job.SenderID)
	}
	custom := map[string]any{"msg_id": strconv.FormatInt(job.Seq, 10)}
	// Ключ пира кладём, только когда он есть: у задания, застрявшего в очереди с
	// прошлой версии, поля нет, и "from_id": "0" отправил бы клиента в НЕ ТОТ чат.
	// Отсутствие ключа tweb трактует как «уведомление без адреса» (peerId '').
	// Группы и каналы у нас — megagroup-каналы, ключ пира peerChannel: положительный
	// id, минус добавит fillPushObject (push.ts:403-418).
	switch {
	case job.PeerID == domain.NullPeerID:
	case job.PeerID.IsAnyChat():
		custom["channel_id"] = strconv.FormatInt(job.PeerID.ToChatID(), 10)
	default:
		custom["from_id"] = strconv.FormatInt(job.PeerID.ToUserID(), 10)
	}
	p := map[string]any{"title": title, "custom": custom}
	if job.Preview {
		locKey := locKeyText
		if job.Text == "" {
			locKey = locKeyNoText
		}
		p["loc_key"] = locKey
		p["loc_args"] = []string{title, job.Text}
		p["description"] = job.Text
	}
	return p
}
