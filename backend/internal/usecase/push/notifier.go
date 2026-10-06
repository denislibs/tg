package push

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Notifier implements chat.PushNotifier: it enqueues a push only for offline,
// non-muted recipients (the WS layer already delivers to online ones).
type Notifier struct {
	online OnlineChecker
	notify NotifyChecker
	queue  Queue
}

func NewNotifier(online OnlineChecker, notify NotifyChecker, queue Queue) *Notifier {
	return &Notifier{online: online, notify: notify, queue: queue}
}

// NotifyNewMessage gates on presence + notify settings, then enqueues a push job.
func (n *Notifier) NotifyNewMessage(ctx context.Context, recipientID, chatID, seq, senderID int64, text string, peer domain.PeerID, mentioned bool, topicRootID int64) {
	// Online (has an active socket)? The WS layer already delivered it live.
	if online, _ := n.online.IsOnline(ctx, recipientID); online {
		return
	}
	// Muted per-chat, by the chat-type settings or per-topic (or lookup error)?
	// Don't push — unless the recipient is mentioned / replied to.
	notify, preview, err := n.notify.ShouldNotify(ctx, chatID, recipientID, topicRootID, mentioned)
	if err != nil || !notify {
		return
	}
	_ = n.queue.Enqueue(ctx, Job{
		RecipientID: recipientID, ChatID: chatID, PeerID: peer,
		Seq: seq, SenderID: senderID, Text: text, Preview: preview,
	})
}
