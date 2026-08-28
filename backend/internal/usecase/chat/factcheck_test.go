package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// newFactCheckInteractor wires an interactor over a channel-typed chat repo
// (groupMembershipChats always reports "channel") sharing membership with the
// group repo, plus a real in-memory updates + message store.
func newFactCheckInteractor() (*Interactor, *fakeGroupRepo, *store) {
	s := newStore()
	fg := newFakeGroupRepo()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupMembershipChats{fg, s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, nil, nil, nil, nil)
	return in, fg, s
}

func TestSetFactCheck_PermissionAndSerialization(t *testing.T) {
	in, fg, s := newFactCheckInteractor()
	ctx := context.Background()
	const creator, subscriber int64 = 7, 8

	chatID, err := in.CreateChannel(ctx, creator, "News", "", "", true)
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	_ = fg.AddMember(ctx, chatID, subscriber, domain.RoleSubscriber, 0)

	// a channel post to attach the fact check to
	// Номер в чате задан явно и заведомо НЕ равен ключу строки: на равных
	// числах подмена адреса не видна вовсе.
	post, err := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: chatID, Seq: 5, SenderID: creator, Type: "text", Text: "post"})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	// subscriber may NOT set a fact check
	if _, err := in.SetFactCheck(ctx, chatID, post.ID, subscriber, "clarify", nil, "de"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber set = %v; want ErrForbidden", err)
	}

	// empty text rejected
	if _, err := in.SetFactCheck(ctx, chatID, post.ID, creator, "  ", nil, ""); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("empty text = %v; want ErrInvalid", err)
	}

	// creator sets it → stored with sanitized country (upper-cased ISO2)
	ents := domain.MessageEntities{domain.NewMessageEntityBold(0, 4)}
	msg, err := in.SetFactCheck(ctx, chatID, post.ID, creator, "fact", ents, "de")
	if err != nil {
		t.Fatalf("creator set: %v", err)
	}
	if msg.FactCheck == nil || msg.FactCheck.Text != "fact" || msg.FactCheck.Country != "DE" {
		t.Fatalf("factcheck = %+v", msg.FactCheck)
	}
	if len(msg.FactCheck.Entities) != 1 {
		t.Fatalf("entities = %+v", msg.FactCheck.Entities)
	}

	// serialization: frame payload carries the factcheck block
	p := factCheckUpdatePayload(domain.PeerID(7), msg)
	if p["_"] != domain.UpdateMessageFactCheckTag {
		t.Fatalf("кадр = %v", p["_"])
	}
	fc, ok := p["factcheck"].(map[string]any)
	if !ok || fc["text"] != "fact" || fc["country"] != "DE" {
		t.Fatalf("payload factcheck = %v", p["factcheck"])
	}
	// Адрес сообщения в кадре ОДИН — номер в чате (внутренний ключ строки
	// наружу не выходит; здесь они заведомо разные, см. фикстуру), и имя ему
	// даёт схема: msg_id.
	if msg.ID == msg.Seq {
		t.Fatalf("фикстура вырождена: ключ строки %d совпал с номером %d", msg.ID, msg.Seq)
	}
	if p["msg_id"] != msg.Seq {
		t.Fatalf("адрес в кадре = %v, ждали номер %d (ключ строки %d)", p["msg_id"], msg.Seq, msg.ID)
	}
	for _, banned := range []string{"id", "seq"} {
		if _, ok := p[banned]; ok {
			t.Fatalf("в кадре осталось второе число %q: %v", banned, p)
		}
	}

	// creator removes it → factcheck cleared, payload null
	if err := in.RemoveFactCheck(ctx, chatID, post.ID, creator); err != nil {
		t.Fatalf("remove: %v", err)
	}
	got, _ := in.msgs.GetByID(ctx, post.ID)
	if got.FactCheck != nil {
		t.Fatalf("factcheck not cleared: %+v", got.FactCheck)
	}
	// «Проверку сняли» — ОТСУТСТВИЕ параметра, а не null под тем же ключом: то
	// же правило, по которому «черновика нет» стало вторым конструктором.
	cleared := factCheckUpdatePayload(domain.PeerID(7), got)
	if _, present := cleared["factcheck"]; present {
		b, _ := json.Marshal(cleared)
		t.Fatalf("после снятия параметр обязан отсутствовать, а не быть null; got %s", b)
	}
}
