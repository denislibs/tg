package chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// rcCounts считает обращения ReadMessageContents к репозиториям: общие
// чтения вектора номеров обязаны идти один раз, а не по разу на номер.
type rcCounts struct {
	mu                                          sync.Mutex
	idsBySeqs, getByIDs, readMentions, isMember int
	txs                                         int
}

type rcMsgs struct {
	MessageRepo
	c *rcCounts
}
type rcChats struct {
	ChatRepo
	c *rcCounts
}
type rcTx struct{ c *rcCounts }

func (m rcMsgs) IDsBySeqs(ctx context.Context, chatID int64, seqs []int64) (map[int64]int64, error) {
	m.c.mu.Lock()
	m.c.idsBySeqs++
	m.c.mu.Unlock()
	return m.MessageRepo.IDsBySeqs(ctx, chatID, seqs)
}

func (m rcMsgs) GetByIDs(ctx context.Context, ids []int64) ([]domain.Message, error) {
	m.c.mu.Lock()
	m.c.getByIDs++
	m.c.mu.Unlock()
	return m.MessageRepo.GetByIDs(ctx, ids)
}

func (c rcChats) IsMember(ctx context.Context, chatID, userID int64) (bool, error) {
	c.c.mu.Lock()
	c.c.isMember++
	c.c.mu.Unlock()
	return c.ChatRepo.IsMember(ctx, chatID, userID)
}

func (c rcChats) ReadMentions(ctx context.Context, chatID, userID int64, msgIDs []int64) ([]int64, error) {
	c.c.mu.Lock()
	c.c.readMentions++
	c.c.mu.Unlock()
	return c.ChatRepo.ReadMentions(ctx, chatID, userID, msgIDs)
}

func (t rcTx) WithinTx(ctx context.Context, fn func(ctx context.Context) error) error {
	t.c.mu.Lock()
	t.c.txs++
	t.c.mu.Unlock()
	return fn(ctx)
}

// Вектор readMessageContents (TL messages.readMessageContents{id: Vector<int>},
// tweb appMessagesManager.ts:9519-9600): за один вызов снимается media_unread и
// упоминание у каждого названного сообщения, неизвестный номер пропускается,
// общие чтения идут один раз.
func TestReadMessageContents_Vector(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	s1, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Type: "voice", Text: "@bob_petrov"})
	if err != nil {
		t.Fatalf("Send 1: %v", err)
	}
	s2, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Type: "voice", Text: "@bob_petrov"})
	if err != nil {
		t.Fatalf("Send 2: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 2 {
		t.Fatalf("упоминаний у Боба до чтения = %d, want 2", n)
	}
	pub.reset()

	c := &rcCounts{}
	in.msgs, in.chats, in.tx = rcMsgs{in.msgs, c}, rcChats{in.chats, c}, rcTx{c}

	if err := in.ReadMessageContents(ctx, chatID, mBob, []int64{s1.Seq, s2.Seq, 999}); err != nil {
		t.Fatalf("ReadMessageContents: %v", err)
	}
	for _, m := range []domain.Message{s1, s2} {
		got, _ := in.msgs.GetByID(ctx, m.ID)
		if got.MediaUnread {
			t.Fatalf("media_unread у seq=%d не снят", m.Seq)
		}
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 0 {
		t.Fatalf("упоминаний у Боба после чтения = %d, want 0", n)
	}
	// Автору — по кадру media_read на сообщение; сам Боб получает свои кадры
	// упоминаний (по одному на сообщение) плюс общий веер media_read.
	if got := pub.countFor(mAlice); got != 2 {
		t.Fatalf("кадров media_read автору = %d, want 2", got)
	}
	if c.isMember != 1 || c.idsBySeqs != 1 || c.getByIDs != 1 || c.readMentions != 1 {
		t.Fatalf("общие чтения: isMember=%d idsBySeqs=%d getByIDs=%d readMentions=%d; want по одному",
			c.isMember, c.idsBySeqs, c.getByIDs, c.readMentions)
	}
	// Одна транзакция на упоминания кадра + по транзакции на снятое сообщение.
	if c.txs != 3 {
		t.Fatalf("транзакций = %d, want 3 (упоминания + 2 сообщения)", c.txs)
	}

	// Повтор — no-op.
	pub.reset()
	if err := in.ReadMessageContents(ctx, chatID, mBob, []int64{s1.Seq, s2.Seq}); err != nil {
		t.Fatalf("повтор: %v", err)
	}
	if pub.countFor(mAlice) != 0 || pub.countFor(mBob) != 0 {
		t.Fatalf("повтор дал кадры: alice=%d bob=%d", pub.countFor(mAlice), pub.countFor(mBob))
	}

	// Не участник — ErrNotFound, ничего не снято.
	s3, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Type: "voice"})
	if err := in.ReadMessageContents(ctx, chatID, 4242, []int64{s3.Seq}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не участник: err=%v; want ErrNotFound", err)
	}
	if got, _ := in.msgs.GetByID(ctx, s3.ID); !got.MediaUnread {
		t.Fatalf("не участник снял media_unread")
	}
	// Своё сообщение: ничего не делает.
	if err := in.ReadMessageContents(ctx, chatID, mAlice, []int64{s3.Seq}); err != nil {
		t.Fatalf("своё: %v", err)
	}
	if got, _ := in.msgs.GetByID(ctx, s3.ID); !got.MediaUnread {
		t.Fatalf("автор снял media_unread со своего сообщения")
	}
}
