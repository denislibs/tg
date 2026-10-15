package push

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestWorker_SendsPrunes410AndAcks(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7, ChatID: 3, PeerID: 9, Seq: 5, SenderID: 9, Text: "hi", Preview: true})

	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{
		7: {
			{Endpoint: "good", P256dh: "p1", Auth: "a1"},
			{Endpoint: "gone", P256dh: "p2", Auth: "a2"},
		},
	}}
	sender := &fakeSender{
		status:    http.StatusCreated,
		statusFor: map[string]int{"gone": http.StatusGone},
	}
	enrich := &fakeEnricher{names: map[int64]string{9: "Alice"}}
	w := NewWorker(q, subs, sender, enrich)

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}

	if len(sender.sent) != 2 {
		t.Fatalf("expected 2 sends, got %d", len(sender.sent))
	}
	// 410 endpoint pruned.
	if len(subs.deleted) != 1 || subs.deleted[0] != "gone" {
		t.Fatalf("expected 'gone' pruned, got %v", subs.deleted)
	}
	// Acked => queue empty.
	if len(q.jobs) != 0 {
		t.Fatalf("expected queue empty after ack, got %d", len(q.jobs))
	}
}

// pushBody — тело пуша одного задания, разобранное в карту.
func pushBody(t *testing.T, job Job, names map[int64]string) map[string]any {
	t.Helper()
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), job)
	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{job.RecipientID: {{Endpoint: "e", P256dh: "p", Auth: "a"}}}}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{names: names})
	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 1 {
		t.Fatalf("sends = %d, want 1", len(sender.sent))
	}
	var got map[string]any
	if err := json.Unmarshal(sender.sent[0].payload, &got); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	return got
}

// Тело пуша — PushNotificationObject tweb (lib/serviceWorker/push.ts:30-54):
// личка несёт custom.from_id, номер — custom.msg_id строкой; ключей прошлой формы
// (badge, peer_id, id, sender, text) нет.
func TestBuildPayload_PrivateChatIsTwebPushObject(t *testing.T) {
	got := pushBody(t, Job{RecipientID: 7, ChatID: 3, PeerID: 9, Seq: 5, SenderID: 9, Text: "hi", Preview: true},
		map[int64]string{9: "Alice"})

	if got["loc_key"] != "MESSAGE_TEXT" {
		t.Fatalf("loc_key = %v, want MESSAGE_TEXT", got["loc_key"])
	}
	args, _ := got["loc_args"].([]any)
	if len(args) != 2 || args[0] != "Alice" || args[1] != "hi" {
		t.Fatalf("loc_args = %v, want [Alice hi]", got["loc_args"])
	}
	if got["title"] != "Alice" || got["description"] != "hi" {
		t.Fatalf("title/description = %v / %v", got["title"], got["description"])
	}
	custom, _ := got["custom"].(map[string]any)
	if custom["from_id"] != "9" || custom["msg_id"] != "5" {
		t.Fatalf("custom = %v, want from_id=9 msg_id=5", custom)
	}
	if _, ok := custom["channel_id"]; ok {
		t.Fatalf("у лички нет channel_id: %v", custom)
	}
	for _, gone := range []string{"badge", "peer_id", "id", "sender", "text", "user_id", "silent"} {
		if _, ok := got[gone]; ok {
			t.Fatalf("в теле пуша остался ключ %q: %v", gone, got)
		}
	}
}

// Группа и канал — megagroup-каналы: ключ пира custom.channel_id (положительный
// id, знак tweb вернёт сам: push.ts:403-418 берёт -channel_id).
func TestBuildPayload_GroupUsesChannelID(t *testing.T) {
	got := pushBody(t, Job{RecipientID: 7, ChatID: 3, PeerID: -3, Seq: 5, SenderID: 9, Text: "hi", Preview: true},
		map[int64]string{9: "Alice"})
	custom, _ := got["custom"].(map[string]any)
	if custom["channel_id"] != "3" || custom["msg_id"] != "5" {
		t.Fatalf("custom = %v, want channel_id=3 msg_id=5", custom)
	}
	if _, ok := custom["from_id"]; ok {
		t.Fatalf("у группы нет from_id: %v", custom)
	}
}

// Фото без подписи: превью есть, текста нет — MESSAGE_NOTEXT (tweb различает
// только наличие loc_key, push.ts:439-443).
func TestBuildPayload_NoTextIsMessageNoText(t *testing.T) {
	got := pushBody(t, Job{RecipientID: 7, ChatID: 3, PeerID: 9, Seq: 5, SenderID: 9, Text: "", Preview: true},
		map[int64]string{9: "Alice"})
	if got["loc_key"] != "MESSAGE_NOTEXT" {
		t.Fatalf("loc_key = %v, want MESSAGE_NOTEXT", got["loc_key"])
	}
	if got["title"] != "Alice" {
		t.Fatalf("title = %v", got["title"])
	}
}

// Message Preview выключен: ни loc_key, ни loc_args, ни description — клиент по
// отсутствию loc_key покажет «Telegram» и общий текст (push.ts:439-443). Имя
// автора в title остаётся: его в SW заменит клиент.
func TestBuildPayload_NoPreviewHasNoLocKeyNorText(t *testing.T) {
	got := pushBody(t, Job{RecipientID: 7, ChatID: 3, PeerID: 9, Seq: 5, SenderID: 9, Text: "секрет", Preview: false},
		map[int64]string{9: "Alice"})
	for _, k := range []string{"loc_key", "loc_args", "description"} {
		if _, ok := got[k]; ok {
			t.Fatalf("без превью в теле остался %q: %v", k, got)
		}
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "секрет") {
		t.Fatalf("текст сообщения утёк в пуш без превью: %s", b)
	}
	custom, _ := got["custom"].(map[string]any)
	if custom["from_id"] != "9" || custom["msg_id"] != "5" {
		t.Fatalf("адрес должен остаться: %v", custom)
	}
}

// Задание из очереди прошлой версии без PeerID: custom без ключа пира (tweb:
// peerId ”, тег 'peer', push.ts:403-429), а не "from_id":"0" — клик не уведёт
// в чужой чат.
func TestBuildPayload_NoPeerKeyOmitsPeer(t *testing.T) {
	got := pushBody(t, Job{RecipientID: 7, Seq: 5, SenderID: 9, Text: "hi", Preview: true},
		map[int64]string{9: "Alice"})
	custom, _ := got["custom"].(map[string]any)
	if _, ok := custom["from_id"]; ok {
		t.Fatalf("custom = %v, ключа пира быть не должно", custom)
	}
	if _, ok := custom["channel_id"]; ok {
		t.Fatalf("custom = %v, ключа пира быть не должно", custom)
	}
	if custom["msg_id"] != "5" {
		t.Fatalf("msg_id = %v", custom["msg_id"])
	}
}

func TestWorker_TransientSubLoadErrorNotAcked(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7})

	subs := &fakeSubs{forErr: errors.New("db down")}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{})

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("expected no sends on sub-load error, got %d", len(sender.sent))
	}
	// handle returned false => Ack must NOT have been called (the real Queue
	// then keeps the message pending for redelivery; at-least-once).
	if len(q.acked) != 0 {
		t.Fatalf("expected no ack on transient error, got %v", q.acked)
	}
}

// Транзиентная ошибка ОТПРАВКИ (сеть/5xx push-сервиса) не должна ACK-ать джоб —
// уведомление уходит на redelivery, а не теряется.
func TestWorker_TransientSendErrorNotAcked(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7, Text: "hi"})

	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{
		7: {{Endpoint: "good", P256dh: "p", Auth: "a"}},
	}}
	sender := &fakeSender{err: errors.New("push service 503")}
	w := NewWorker(q, subs, sender, &fakeEnricher{})

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 1 {
		t.Fatalf("expected 1 send attempt, got %d", len(sender.sent))
	}
	if len(q.acked) != 0 {
		t.Fatalf("expected NO ack on transient send error (redelivery), got %v", q.acked)
	}
}

func TestWorker_NoSubscriptionsAcks(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7})

	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{}}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{})

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("expected no sends, got %d", len(sender.sent))
	}
	if len(q.jobs) != 0 {
		t.Fatalf("expected ack (empty queue), got %d", len(q.jobs))
	}
}

// Заголовок пуша поста канала — название канала, имя автора не спрашивается.
func TestWorker_TitleOverridesSenderName(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7, ChatID: 3, PeerID: -3, Seq: 5, SenderID: 9, Title: "Новости", Text: "пост", Preview: true})
	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{7: {{Endpoint: "e", P256dh: "p", Auth: "a"}}}}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{names: map[int64]string{9: "Алиса"}})
	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	var got map[string]any
	_ = json.Unmarshal(sender.sent[0].payload, &got)
	if got["title"] != "Новости" {
		t.Fatalf("заголовок пуша = %v, want название канала", got["title"])
	}
	custom, _ := got["custom"].(map[string]any)
	if custom["channel_id"] != "3" {
		t.Fatalf("custom = %v, want channel_id=3", custom)
	}
}

// Имя автора запрашивается один раз на пачку: сообщение в группу даёт задание
// каждому офлайн-участнику, а имя у них одно.
func TestWorker_SenderNameOncePerBatch(t *testing.T) {
	q := &fakeQueue{}
	for uid := int64(1); uid <= 3; uid++ {
		_ = q.Enqueue(context.Background(), Job{RecipientID: uid, ChatID: 3, PeerID: -3, Seq: 5, SenderID: 9, Text: "п", Preview: true})
	}
	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{
		1: {{Endpoint: "e1", P256dh: "p", Auth: "a"}}, 2: {{Endpoint: "e2", P256dh: "p", Auth: "a"}}, 3: {{Endpoint: "e3", P256dh: "p", Auth: "a"}},
	}}
	enrich := &fakeEnricher{names: map[int64]string{9: "Алиса"}}
	w := NewWorker(q, subs, &fakeSender{status: http.StatusCreated}, enrich)
	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if enrich.nameCalls != 1 {
		t.Fatalf("имя автора запрошено %d раз на три задания", enrich.nameCalls)
	}
}

// Приватность: пуш о сообщении send-as / анонимного админа / поста канала несёт
// заголовок чата-автора (Job.Title), а имя живого отправителя не запрашивается и в
// тело не попадает; в группе у custom нет from_id (только channel_id).
func TestBuildPayload_HiddenAuthorLeaksNeitherNameNorID(t *testing.T) {
	enrich := &fakeEnricher{names: map[int64]string{9: "Админ Секретов"}}
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7, ChatID: 3, PeerID: -3, Seq: 5, SenderID: 9, Title: "Новости", Text: "пост", Preview: true})
	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{7: {{Endpoint: "e", P256dh: "p", Auth: "a"}}}}
	sender := &fakeSender{status: http.StatusCreated}
	if err := NewWorker(q, subs, sender, enrich).ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	body := string(sender.sent[0].payload)
	if strings.Contains(body, "Секретов") || strings.Contains(body, "from_id") {
		t.Fatalf("в теле пуша виден скрытый автор: %s", body)
	}
	if enrich.nameCalls != 0 {
		t.Fatalf("имя скрытого автора запрашивалось %d раз", enrich.nameCalls)
	}
}

// Notifier кладёт заголовок чата-автора в задание.
func TestNotifier_TitlePassedToJob(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeNotify{muted: map[int64]bool{}}, q)
	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0, "Команда")
	n.NotifyGuest(context.Background(), 8, 3, 6, 9, "hi", -3, 11, "Команда")
	if len(q.jobs) != 2 || q.jobs[0].Job.Title != "Команда" || q.jobs[1].Job.Title != "Команда" {
		t.Fatalf("задания = %+v, want Title=Команда у обоих", q.jobs)
	}
}
