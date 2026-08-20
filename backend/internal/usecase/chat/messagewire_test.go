package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Аварийный выход перевода корней треда. Прежде здесь стояло «сбой резолва не
// должен ронять всю выдачу — тогда сообщения уезжают с внутренним id, что лучше
// 500-й». После сведения адресации (шаг B) внутренний ключ строки и номер
// сообщения живут в ОДНОМ пространстве чисел, поэтому утёкший ключ почти
// наверняка попадёт в существующее сообщение другого чата: это уже не
// деградация, а молчаливая подмена.
type brokenSeqsMsgs struct {
	MessageRepo
	err error
}

func (b brokenSeqsMsgs) SeqsByIDs(context.Context, []int64) (map[int64]int64, error) {
	return nil, b.err
}

func TestMessagesWire_ThreadRootResolveFailureIsAnError(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	root := int64(7)
	msgs := []domain.Message{{ID: 1, ChatID: chatID, Seq: 1, SenderID: a, ThreadRootID: &root}}

	boom := errors.New("резолв корня недоступен")
	in.msgs = brokenSeqsMsgs{MessageRepo: fakeMsgs{s}, err: boom}

	out, err := in.MessagesWire(ctx, a, msgs)
	if !errors.Is(err, boom) {
		t.Fatalf("MessagesWire = %v, %v; сбой перевода обязан стать ошибкой, а не тихой подстановкой", out, err)
	}
	if out != nil {
		t.Fatalf("при сбое перевода наружу всё равно уехали сообщения: %v", out)
	}
}

// Корень, которого больше нет в базе: номера у него не существует, и наружу не
// уходит НИЧЕГО — ни внутреннего ключа, ни нуля (ноль в пространстве номеров
// значит «самое новое»).
func TestMessagesWire_MissingThreadRootDropsTheKey(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	gone := int64(999999)
	msgs := []domain.Message{{ID: 1, ChatID: chatID, Seq: 1, SenderID: a, ThreadRootID: &gone}}

	out, err := in.MessagesWire(ctx, a, msgs)
	if err != nil {
		t.Fatalf("MessagesWire: %v", err)
	}
	raw, _ := json.Marshal(out[0])
	var wire map[string]any
	_ = json.Unmarshal(raw, &wire)
	if _, ok := wire["reply_to"]; ok {
		t.Fatalf("снесённый корень уехал наружу: %s", raw)
	}
}

// Витрина и кадр отдают ОДИН конструктор. Тест держит именно это: разойтись они
// могут только если у сообщения снова заведётся второй сериализатор.
func TestMessagesWire_MatchesFramePayload(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "привет", ClientMsgID: "c1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	wire, err := in.MessagesWire(ctx, b, []domain.Message{msg})
	if err != nil {
		t.Fatalf("MessagesWire: %v", err)
	}
	fromShowcase, _ := json.Marshal(wire[0])

	// Кадр: ключ пира приклеивается на выходе, глазами ТОГО ЖЕ получателя.
	payload := withPeer(in.messageUpdatePayload(ctx, msg), domain.PeerID(a))
	fromFrame, _ := json.Marshal(payload["message"])

	if !jsonEqual(t, fromShowcase, fromFrame) {
		t.Fatalf("витрина и кадр разошлись:\nвитрина %s\nкадр    %s", fromShowcase, fromFrame)
	}
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("разбор витрины: %v", err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("разбор кадра: %v", err)
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return string(ja) == string(jb)
}

// Производитель messageEmpty: на номер, у которого сообщения нет, уезжает ДЫРА,
// а не молчание — иначе клиент не отличает «ещё не загружено» от «больше не
// существует».
func TestEmptyMessages_ProducesHoles(t *testing.T) {
	out := EmptyMessages(domain.PeerID(-9), []int64{4, 5})
	if len(out) != 2 {
		t.Fatalf("дыр = %d, ждали 2", len(out))
	}
	raw, _ := json.Marshal(out[0])
	var wire map[string]any
	_ = json.Unmarshal(raw, &wire)
	if wire["_"] != domain.MessageEmptyTag || wire["id"] != float64(4) {
		t.Fatalf("дыра = %s", raw)
	}
	peer, _ := wire["peer_id"].(map[string]any)
	if peer["_"] != domain.PeerChannelTag {
		t.Fatalf("у дыры нет адреса пира: %s", raw)
	}
}
