package push

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
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
	for _, sub := range subs {
		status, err := w.sender.Send(ctx, sub, payload)
		if err == nil && (status == http.StatusNotFound || status == http.StatusGone) {
			_ = w.subs.DeleteByEndpoint(ctx, sub.Endpoint)
		}
	}
	return true
}

// buildPayload enriches the job with sender name + unread badge for the client.
// С выключенным Message Preview текст в пуш не попадает (tweb: nopreview —
// клиент покажет generic-текст).
func (w *Worker) buildPayload(ctx context.Context, job Job) map[string]any {
	senderName, _ := w.enrich.SenderName(ctx, job.SenderID)
	badge, _ := w.enrich.UnreadBadge(ctx, job.RecipientID)
	text := job.Text
	if !job.Preview {
		text = ""
	}
	return map[string]any{
		"chat_id": job.ChatID, "msg_id": job.MsgID, "seq": job.Seq,
		"sender": map[string]any{"name": senderName},
		"text":   text, "badge": badge,
	}
}
