package push

import "context"

// Notifier implements chat.PushNotifier: it enqueues a push only for offline,
// non-muted recipients (the WS layer already delivers to online ones).
type Notifier struct {
	online OnlineChecker
	mute   MuteChecker
	queue  Queue
}

func NewNotifier(online OnlineChecker, mute MuteChecker, queue Queue) *Notifier {
	return &Notifier{online: online, mute: mute, queue: queue}
}

// NotifyNewMessage gates on presence + mute, then enqueues a push job.
func (n *Notifier) NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string) {
	// Online (has an active socket)? The WS layer already delivered it live.
	if online, _ := n.online.IsOnline(ctx, recipientID); online {
		return
	}
	// Muted this chat (or not a member / lookup error)? Don't push.
	if muted, err := n.mute.IsMuted(ctx, chatID, recipientID); err != nil || muted {
		return
	}
	_ = n.queue.Enqueue(ctx, Job{
		RecipientID: recipientID, ChatID: chatID, MsgID: msgID,
		Seq: seq, SenderID: senderID, Text: text,
	})
}
