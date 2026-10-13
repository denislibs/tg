package chat

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// journalCount — число строк журнала пользователя с типом typ.
func (s *store) journalCount(uid int64, typ string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, u := range s.updates[uid] {
		if u.Type == typ {
			n++
		}
	}
	return n
}

// F6 (9.1): повтор «удалить у всех» не трогает счётчики и журнал. Раньше
// SoftDelete на повторе молча отдавал nil, а fanOutDelete снова вычитал
// непрочитанное у собеседника и снова писал delete_message.
func TestDeleteMessage_RepeatRevokeIsNoop(t *testing.T) {
	in, st := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	one, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "one"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "two"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "three"})
	if got := st.members[chatID][b].unread; got != 3 {
		t.Fatalf("до удаления unread(b) = %d; want 3", got)
	}
	for k := 0; k < 3; k++ {
		if err := in.DeleteMessage(ctx, chatID, one.ID, a, true); err != nil {
			t.Fatal(err)
		}
	}
	if got := st.members[chatID][b].unread; got != 2 {
		t.Errorf("unread(b) = %d; want 2 (повтор вычел ещё раз)", got)
	}
	for _, uid := range []int64{a, b} {
		if n := st.journalCount(uid, "delete_message"); n != 1 {
			t.Errorf("строк delete_message у %d: %d; want 1", uid, n)
		}
	}
}

// Две встречные «удалить у всех» одного сообщения: строка журнала одна.
func TestDeleteMessage_ConcurrentRevokeOneRow(t *testing.T) {
	in, st := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "y"})

	var wg sync.WaitGroup
	for _, actor := range []int64{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := in.DeleteMessage(ctx, chatID, msg.ID, actor, true); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := st.journalCount(b, "delete_message"); n != 1 {
		t.Errorf("строк delete_message у собеседника: %d; want 1", n)
	}
	if got := st.members[chatID][b].unread; got != 1 {
		t.Errorf("unread(b) = %d; want 1", got)
	}
}

// «Удалить у себя» дважды — одна строка журнала.
func TestDeleteMessage_RepeatForMeIsNoop(t *testing.T) {
	in, st := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	for k := 0; k < 3; k++ {
		if err := in.DeleteMessage(ctx, chatID, msg.ID, b, false); err != nil {
			t.Fatal(err)
		}
	}
	if n := st.journalCount(b, "delete_message"); n != 1 {
		t.Errorf("строк delete_message: %d; want 1", n)
	}
	if got := st.members[chatID][b].unread; got != 0 {
		t.Errorf("unread(b) = %d; want 0", got)
	}
}

// Канал: повтор «удалить у всех» не пишет в журнал канала и не шлёт кадр.
func TestDeleteMessage_ChannelRepeatIsNoop(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	for k := 0; k < 3; k++ {
		if err := e.i.DeleteMessage(ctx, e.ch, post.ID, 7, true); err != nil {
			t.Fatal(err)
		}
	}
	n := 0
	for _, u := range e.channelLog() {
		if u.Type == "delete_message" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("delete_message в журнале канала: %d; want 1", n)
	}
	frames := 0
	for _, typ := range e.topicTypes() {
		if typ == "delete_message" {
			frames++
		}
	}
	if frames != 1 {
		t.Errorf("кадров delete_message в топик: %d; want 1", frames)
	}
}

// raceMsgs — истёкшие посты из очереди expired; GetByID отдаёт сообщение
// таким, каким оно было до удаления (гонка: выборка прочла строку раньше,
// чем соседний путь её удалил).
type raceMsgs struct {
	fakeMsgs
	expired *[]domain.Message
	stale   map[int64]domain.Message
}

func (r raceMsgs) ExpiredMessages(context.Context, int) ([]domain.Message, error) {
	out := *r.expired
	*r.expired = nil
	return out, nil
}

func (r raceMsgs) GetByID(ctx context.Context, id int64) (domain.Message, error) {
	if m, ok := r.stale[id]; ok {
		return m, nil
	}
	return r.fakeMsgs.GetByID(ctx, id)
}

// Автоудаление не считает и не пишет уже удалённое соседним путём — и в
// канале, и в личке.
func TestPurgeExpired_RaceWithManualDeleteSkips(t *testing.T) {
	var expired []domain.Message
	stale := map[int64]domain.Message{}
	e := newChannelEnv(t, func(s *store) MessageRepo { return raceMsgs{fakeMsgs{s}, &expired, stale} })
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	stale[post.ID] = post
	if err := e.i.DeleteMessage(ctx, e.ch, post.ID, 7, true); err != nil {
		t.Fatal(err)
	}
	frames := len(e.topicTypes())
	expired = []domain.Message{post}
	if n, err := e.i.PurgeExpiredMessages(ctx); err != nil || n != 0 {
		t.Fatalf("Purge канала = %d %v; want 0", n, err)
	}
	cnt := 0
	for _, u := range e.channelLog() {
		if u.Type == "delete_message" {
			cnt++
		}
	}
	if cnt != 1 {
		t.Errorf("delete_message в журнале канала: %d; want 1", cnt)
	}
	if got := len(e.topicTypes()); got != frames {
		t.Errorf("повтор послал кадр в топик: %d -> %d", frames, got)
	}

	// Личка.
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, raceMsgs{fakeMsgs{s}, &expired, stale}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	one, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "one"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "two"})
	stale[one.ID] = one
	if err := in.DeleteMessage(ctx, chatID, one.ID, a, true); err != nil {
		t.Fatal(err)
	}
	expired = []domain.Message{one}
	if n, err := in.PurgeExpiredMessages(ctx); err != nil || n != 0 {
		t.Fatalf("Purge лички = %d %v; want 0", n, err)
	}
	if n := s.journalCount(b, "delete_message"); n != 1 {
		t.Errorf("delete_message у собеседника: %d; want 1", n)
	}
	if got := s.members[chatID][b].unread; got != 1 {
		t.Errorf("unread(b) = %d; want 1", got)
	}
}
