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
func (n *Notifier) NotifyNewMessage(ctx context.Context, recipientID, chatID, seq, senderID int64, text string, peer domain.PeerID, mentioned bool, topicRootID int64, title string) {
	// Online (has an active socket)? The WS layer already delivered it live.
	if online, _ := n.online.IsOnline(ctx, recipientID); online {
		return
	}
	n.enqueue(ctx, recipientID, chatID, seq, senderID, text, peer, mentioned, topicRootID, title)
}

// NotifyGuest — пуш гостю обсуждения (комментирует, не вступая) об ответе на
// его комментарий или упоминании. Гейта присутствия нет: живого кадра гостю
// не уходит (группы у него нет), и сокет ничего ему не доставил. У Telegram
// такое сообщение приходит в чат «Ответы» (tweb REPLIES_PEER_ID,
// bubbles.ts:3757-3766) и уведомляет и онлайн; этого чата у нас нет, пуш —
// замена (решение пользователя к В-2). Мьюты — как у упоминания.
func (n *Notifier) NotifyGuest(ctx context.Context, recipientID, chatID, seq, senderID int64, text string, peer domain.PeerID, topicRootID int64, title string) {
	n.enqueue(ctx, recipientID, chatID, seq, senderID, text, peer, true, topicRootID, title)
}

// enqueue — гейт настроек уведомлений и постановка пуша в очередь.
func (n *Notifier) enqueue(ctx context.Context, recipientID, chatID, seq, senderID int64, text string, peer domain.PeerID, mentioned bool, topicRootID int64, title string) {
	// Muted per-chat, by the chat-type settings or per-topic (or lookup error)?
	// Don't push — unless the recipient is mentioned / replied to.
	notify, preview, err := n.notify.ShouldNotify(ctx, chatID, recipientID, topicRootID, mentioned)
	if err != nil || !notify {
		return
	}
	_ = n.queue.Enqueue(ctx, Job{
		RecipientID: recipientID, ChatID: chatID, PeerID: peer,
		Seq: seq, SenderID: senderID, Title: title, Text: text, Preview: preview,
	})
}

// NotifyChannelPost — пуш о посте broadcast-канала подписчикам одним батчем:
// онлайн отсекается одним проходом по присутствию, мьют канала и настройки
// «каналы» — одним запросом на всех оставшихся, а не парой запросов на
// подписчика (у канала их тысячи). Заголовок пуша — название канала.
func (n *Notifier) NotifyChannelPost(ctx context.Context, chatID int64, recipients []int64, seq int64, title, text string, peer domain.PeerID) {
	online, err := n.online.OnlineMany(ctx, recipients)
	if err != nil {
		return
	}
	offline := make([]int64, 0, len(recipients))
	for _, uid := range recipients {
		if !online[uid] {
			offline = append(offline, uid)
		}
	}
	if len(offline) == 0 {
		return
	}
	targets, err := n.notify.NotifyTargets(ctx, chatID, offline)
	if err != nil {
		return
	}
	jobs := make([]Job, 0, len(targets))
	for _, uid := range offline {
		preview, ok := targets[uid]
		if !ok {
			continue
		}
		jobs = append(jobs, Job{
			RecipientID: uid, ChatID: chatID, PeerID: peer,
			Seq: seq, Title: title, Text: text, Preview: preview,
		})
	}
	if len(jobs) > 0 {
		_ = n.queue.EnqueueMany(ctx, jobs)
	}
}
