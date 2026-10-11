package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxSeqChats — ChatRepo теста с настоящим MaxSeq из store (groupChats
// отвечает нулём, а ReadDiscussion обрезает read_max_id по последнему номеру).
type maxSeqChats struct {
	ChatRepo
	s *store
}

func (c maxSeqChats) MaxSeq(_ context.Context, chatID int64) (int64, error) {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	return c.s.chatSeq[chatID], nil
}

func readDiscussionForum(t *testing.T) (*Interactor, *fakeTopicRepo, *fakePublisher, int64, domain.Message) {
	t.Helper()
	in, _, s, id := gateGroup(t)
	ft := newFakeTopicRepo()
	in.SetTopics(ft)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	if err := in.SetForum(ctx, id, 7, true); err != nil {
		t.Fatal(err)
	}
	_, root, err := in.CreateTopic(ctx, id, 7, "Тема", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	in.chats = maxSeqChats{in.chats, s}
	pub.reset()
	return in, ft, pub, id, root
}

// readDiscussion темы: горизонт ТРЕДА, упоминания треда, пересчёт форума,
// inbox своим, outbox тем, у кого вырос ✓✓ (tweb appMessagesManager.ts:
// 9186-9210, 10795-10990).
func TestReadDiscussion_Topic(t *testing.T) {
	in, ft, pub, id, root := readDiscussionForum(t)
	ctx := context.Background()
	m, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в теме", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}
	// Боб уже прочитал тему до корня — у него есть горизонт треда.
	if err := ft.SetTopicRead(ctx, id, root.ID, 8, root.Seq); err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.ReadDiscussion(ctx, id, root.Seq, 7, m.Seq+100); err != nil {
		t.Fatal(err)
	}
	if got := ft.reads[[3]int64{id, root.ID, 7}]; got != m.Seq {
		t.Fatalf("горизонт треда = %d, ждали %d (обрезан по последнему номеру)", got, m.Seq)
	}
	if len(ft.clearedMentions) != 1 || ft.clearedMentions[0] != [2]int64{root.ID, m.Seq} {
		t.Fatalf("упоминания треда: %v", ft.clearedMentions)
	}
	if ft.forumRecounts != 1 {
		t.Fatalf("пересчётов непрочитанного форума %d, ждали 1", ft.forumRecounts)
	}
	in7 := lastFrameOfType(t, pub, 7, "read_discussion")
	if in7["_"] != domain.UpdateReadChannelDiscussionInboxTag || in7["top_msg_id"] != float64(root.Seq) ||
		in7["read_max_id"] != float64(m.Seq) || in7["channel_id"] != float64(id) {
		t.Fatalf("inbox читателю = %v", in7)
	}
	out8 := lastFrameOfType(t, pub, 8, "read_discussion")
	if out8["_"] != domain.UpdateReadChannelDiscussionOutboxTag || out8["top_msg_id"] != float64(root.Seq) ||
		out8["read_max_id"] != float64(m.Seq) {
		t.Fatalf("outbox Бобу = %v", out8)
	}
	if framesOfType(pub, 7, "read_discussion") != 1 || framesOfType(pub, 8, "read_discussion") != 1 {
		t.Fatal("лишние кадры прочтения")
	}
	// Повтор тем же горизонтом — ни записи, ни кадров.
	pub.reset()
	if err := in.ReadDiscussion(ctx, id, root.Seq, 7, m.Seq); err != nil {
		t.Fatal(err)
	}
	if framesOfType(pub, 7, "read_discussion")+framesOfType(pub, 8, "read_discussion") != 0 || ft.forumRecounts != 1 {
		t.Fatal("повторное прочтение разослало кадры или пересчитало форум")
	}
}

// General — номер 1: ключ состояния 0, выборка по стражу.
func TestReadDiscussion_General(t *testing.T) {
	in, ft, pub, id, _ := readDiscussionForum(t)
	ctx := context.Background()
	m, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "общее"})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.ReadDiscussion(ctx, id, domain.GeneralTopicID, 7, m.Seq); err != nil {
		t.Fatal(err)
	}
	if got := ft.reads[[3]int64{id, 0, 7}]; got != m.Seq {
		t.Fatalf("горизонт General = %d", got)
	}
	if ft.clearedMentions[0][0] != domain.GeneralThreadRoot {
		t.Fatalf("упоминания General сняты не по стражу: %v", ft.clearedMentions)
	}
	if d := lastFrameOfType(t, pub, 7, "read_discussion"); d["top_msg_id"] != float64(domain.GeneralTopicID) {
		t.Fatalf("inbox General = %v", d)
	}
}

// В форуме тред не темы — TOPIC_ID_INVALID; не участник — нет доступа.
func TestReadDiscussion_Errors(t *testing.T) {
	in, _, _, id, root := readDiscussionForum(t)
	ctx := context.Background()
	plain, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в General"})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.ReadDiscussion(ctx, id, plain.Seq, 7, plain.Seq); !errors.Is(err, domain.ErrTopicIDInvalid) {
		t.Fatalf("тред не темы = %v, ждали ErrTopicIDInvalid", err)
	}
	if err := in.ReadDiscussion(ctx, id, root.Seq, 999, root.Seq); err == nil {
		t.Fatal("не участник прочитал тему")
	}
	if err := in.ReadDiscussion(ctx, id, 100500, 7, 1); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("несуществующий номер = %v, ждали ErrNotFound", err)
	}
}

// ✓✓ треда у получателя — MAX горизонтов всех, кроме него.
func TestOutboxRaised(t *testing.T) {
	h := map[int64]int64{1: 10, 2: 5, 3: 8, 4: 0}
	// Читатель 4 дочитал до 9: у 1 «остальные» max(5,8)=8 < 9 — вырос;
	// у 2 и 3 остальные включают 1 (10) — не вырос.
	if got := outboxRaised(h, 4, 9); len(got) != 1 || got[0] != 1 {
		t.Fatalf("outboxRaised = %v, ждали [1]", got)
	}
	if got := outboxRaised(h, 4, 11); len(got) != 3 {
		t.Fatalf("outboxRaised выше всех = %v, ждали [1 2 3]", got)
	}
	if got := outboxRaised(map[int64]int64{4: 0}, 4, 3); len(got) != 0 {
		t.Fatalf("один читатель: %v", got)
	}
}

// Тред вне форума правит и диалог группы (курсор сведён с группой, tweb
// appMessagesManager.ts:10814-10816); тема форума — нет.
func TestReadDiscussion_NonForumThreadTouchesGroup(t *testing.T) {
	in, _, s, id := gateGroup(t)
	ft := newFakeTopicRepo()
	in.SetTopics(ft)
	in.chats = maxSeqChats{in.chats, s}
	ctx := context.Background()
	root, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "корень"})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в треде", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.ReadDiscussion(ctx, id, root.Seq, 7, reply.Seq); err != nil {
		t.Fatal(err)
	}
	if len(ft.groupReads) != 1 || ft.groupReads[0] != [4]int64{root.ID, 0, reply.Seq, reply.Seq} {
		t.Fatalf("правка группы = %v; ждали [root merged=0 read=%d last=%d]", ft.groupReads, reply.Seq, reply.Seq)
	}
	if ft.forumRecounts != 0 {
		t.Fatal("вне форума пересчитан форум")
	}

	// Тема форума группу не трогает.
	fin, fft, _, fid, froot := readDiscussionForum(t)
	m, err := fin.Send(ctx, SendInput{ChatID: fid, SenderID: 8, Text: "в теме", ThreadRootID: &froot.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := fin.ReadDiscussion(ctx, fid, froot.Seq, 7, m.Seq); err != nil {
		t.Fatal(err)
	}
	if len(fft.groupReads) != 0 {
		t.Fatalf("тема форума правит диалог группы: %v", fft.groupReads)
	}
}
