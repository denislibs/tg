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

	// Кадр: ключ пира и pFlags.out приклеиваются на выходе, глазами ТОГО ЖЕ
	// получателя (b). Оба пер-зрительные, поэтому и там и там их ставит не
	// общее тело, а развёртка по получателю.
	payload := withPeer(in.messageUpdatePayload(ctx, msg), domain.PeerID(a), msg.SenderID == b)
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

// `pFlags.out` — ПЕР-ЗРИТЕЛЬ, и в группе это ловушка: ключ пира там один на
// всех, а тело кадра мемоизируется. Мемоизация по одному лишь ключу пира
// раздала бы всем участникам флаг того, кого обслужили первым, — то есть чужое
// сообщение выглядело бы своим (или наоборот) у всех, кроме одного.
//
// Флаг производит СЕРВЕР (отмена решения Р7): после порта у сообщения от лица
// канала автором на проводе становится сам канал, и прежней формулы клиента
// «автор это я» стало не из чего вывести.
func TestNewMessageFrame_OutIsPerViewer(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()

	const author, other, third int64 = 1, 2, 3
	const chatID int64 = 70
	s.seedChat(chatID, "group", author, other, third)

	if _, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: author, Text: "привет", ClientMsgID: "c1",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	outByUser := map[int64]bool{}
	seen := map[int64]bool{}
	for _, f := range pub.frames {
		var env struct {
			T string `json:"t"`
			D struct {
				Message struct {
					PFlags map[string]bool `json:"pFlags"`
				} `json:"message"`
			} `json:"d"`
		}
		if err := json.Unmarshal(f.frame, &env); err != nil || env.T != "new_message" {
			continue
		}
		seen[f.userID] = true
		outByUser[f.userID] = env.D.Message.PFlags["out"]
	}

	for _, uid := range []int64{author, other, third} {
		if !seen[uid] {
			t.Fatalf("участник %d не получил кадр new_message", uid)
		}
	}
	if !outByUser[author] {
		t.Errorf("у автора out отсутствует — своё сообщение выглядит чужим")
	}
	if outByUser[other] || outByUser[third] {
		t.Errorf("out утёк получателям: other=%v third=%v — чужое сообщение выглядит своим",
			outByUser[other], outByUser[third])
	}
}

// Тот же пер-зрительский `out`, но в ЖУРНАЛЕ, а не в живом кадре. Это разные
// пути, и проверять надо оба: живой кадр строится по получателю, а журнальное
// тело пишется БАТЧАМИ. Батч, ключованный одним лишь пиром, взял бы тело
// первого в группе и раздал остальным — и клиент, догоняющий разрыв через
// /sync, увидел бы своё сообщение чужим (или чужое своим).
//
// Первая версия теста выше (по живым кадрам) на этой мутации НЕ краснела —
// потому и добавлен отдельный пин.
func TestNewMessageJournal_OutIsPerViewer(t *testing.T) {
	in, s := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()

	const author, other, third int64 = 1, 2, 3
	const chatID int64 = 71
	s.seedChat(chatID, "group", author, other, third)

	if _, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: author, Text: "привет", ClientMsgID: "j1",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	outOf := func(uid int64) bool {
		t.Helper()
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, u := range s.updates[uid] {
			if u.Type != "new_message" {
				continue
			}
			var body struct {
				Message struct {
					PFlags map[string]bool `json:"pFlags"`
				} `json:"message"`
			}
			if err := json.Unmarshal(u.Payload, &body); err != nil {
				t.Fatalf("журнал пользователя %d не разбирается: %v", uid, err)
			}
			return body.Message.PFlags["out"]
		}
		t.Fatalf("в журнале пользователя %d нет new_message", uid)
		return false
	}

	if !outOf(author) {
		t.Errorf("в журнале автора out отсутствует — при догоне через /sync своё сообщение станет чужим")
	}
	if outOf(other) || outOf(third) {
		t.Errorf("out утёк в журналы получателей — при догоне чужое сообщение станет своим")
	}
}
