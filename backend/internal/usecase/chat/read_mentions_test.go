package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-6, задача 18 (f6-mentions): messages.readReactions и messages.readMentions
// (tweb appMessagesManager.readMentions :9614-9650) — ответ affectedHistory,
// тема форума через top_msg_id, пачка не больше readBatchLimit.

// mentionsForum — группа 70 (Алиса 1, Боб 2, Кэрол 3), две темы A и B (корни —
// сообщения Кэрол), форум включается ПОСЛЕ отправок: Send в форуме идёт через
// гейты, которые этим тестам не нужны.
type mentionsForum struct {
	in           *Interactor
	s            *store
	ft           *fakeTopicRepo
	fg           *fakeGroupRepo
	pub          *fakePublisher
	rootA, rootB domain.Message
}

const mfChat int64 = 70

func newMentionsForum(t *testing.T) *mentionsForum {
	t.Helper()
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	s.seedChat(mfChat, domain.ChatTypeGroup, mAlice, mBob, mCarol)
	s.seedUsername(mAlice, "alice_ivanova")
	s.seedUsername(mBob, "bob_petrov")
	ctx := context.Background()
	// Сообщение №1 в чате занято создателем: номер 1 — псевдоним General, и
	// корнем темы он быть не может.
	if _, err := in.Send(ctx, SendInput{ChatID: mfChat, SenderID: mCarol, Text: "чат создан"}); err != nil {
		t.Fatal(err)
	}
	rootA, err := in.Send(ctx, SendInput{ChatID: mfChat, SenderID: mCarol, Text: "тема A"})
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := in.Send(ctx, SendInput{ChatID: mfChat, SenderID: mCarol, Text: "тема B"})
	if err != nil {
		t.Fatal(err)
	}
	ft := newFakeTopicRepo()
	for _, r := range []domain.Message{rootA, rootB} {
		if _, err := ft.Create(ctx, domain.ForumTopicRecord{ChatID: mfChat, RootMsgID: r.ID, RootMsgSeq: r.Seq, Title: "t"}); err != nil {
			t.Fatal(err)
		}
	}
	fg := newFakeGroupRepo()
	fg.cards[mfChat] = domain.ChatRecord{}
	return &mentionsForum{in: in, s: s, ft: ft, fg: fg, pub: pub, rootA: rootA, rootB: rootB}
}

// enableForum включает форум (после всех Send).
func (f *mentionsForum) enableForum() {
	f.fg.forum = map[int64]bool{mfChat: true}
	f.in.groups = f.fg
	f.in.SetTopics(f.ft)
}

func (f *mentionsForum) send(t *testing.T, sender int64, text string, root *domain.Message) domain.Message {
	t.Helper()
	in := SendInput{ChatID: mfChat, SenderID: sender, Text: text}
	if root != nil {
		in.ThreadRootID = &root.ID
	}
	m, err := f.in.Send(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func (f *mentionsForum) react(t *testing.T, by int64, m domain.Message) {
	t.Helper()
	if err := f.in.React(context.Background(), mfChat, m.ID, by, "❤", true); err != nil {
		t.Fatal(err)
	}
}

func unreadReactionsIn(s *store, chatID, uid int64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.members[chatID][uid].reactions
}

func ptsOf(s *store, uid int64) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pts[uid]
}

func journalOf(s *store, uid int64, typ string) []domain.UpdateRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.UpdateRecord
	for _, u := range s.updates[uid] {
		if u.Type == typ {
			out = append(out, u)
		}
	}
	return out
}

func TestReadReactions_TopicScope(t *testing.T) {
	f := newMentionsForum(t)
	ctx := context.Background()
	inA := f.send(t, mBob, "в теме A", &f.rootA)
	inB := f.send(t, mBob, "в теме B", &f.rootB)
	inG := f.send(t, mBob, "в General", nil)
	for _, m := range []domain.Message{inA, inB, inG} {
		f.react(t, mAlice, m)
	}
	f.enableForum()
	if got := unreadReactionsIn(f.s, mfChat, mBob); got != 3 {
		t.Fatalf("до чтения ❤ = %d, want 3", got)
	}
	before := ptsOf(f.s, mBob)

	res, err := f.in.ReadReactions(ctx, mfChat, mBob, f.rootA.Seq)
	if err != nil {
		t.Fatal(err)
	}
	if res.Underscore != domain.MessagesAffectedHistoryTag || res.PtsCount != 1 || res.Pts != before+1 || res.Pts != ptsOf(f.s, mBob) || res.Offset != 0 {
		t.Fatalf("ответ темы A = %+v (pts до %d)", res, before)
	}
	if got := unreadReactionsIn(f.s, mfChat, mBob); got != 2 {
		t.Fatalf("после темы A ❤ = %d, want 2 (тема B и General остались)", got)
	}

	// General — номер 1: только сообщения вне тем.
	res, err = f.in.ReadReactions(ctx, mfChat, mBob, domain.GeneralTopicID)
	if err != nil || res.PtsCount != 1 {
		t.Fatalf("General: %+v, %v", res, err)
	}
	if got := unreadReactionsIn(f.s, mfChat, mBob); got != 1 {
		t.Fatalf("после General ❤ = %d, want 1 (тема B)", got)
	}

	// Без top_msg_id — весь чат.
	res, err = f.in.ReadReactions(ctx, mfChat, mBob, 0)
	if err != nil || res.PtsCount != 1 || unreadReactionsIn(f.s, mfChat, mBob) != 0 {
		t.Fatalf("весь чат: %+v, %v, ❤=%d", res, err, unreadReactionsIn(f.s, mfChat, mBob))
	}
}

func TestReadReactions_EmptyAnswersCurrentPts(t *testing.T) {
	f := newMentionsForum(t)
	m := f.send(t, mBob, "x", nil)
	f.react(t, mAlice, m)
	if _, err := f.in.ReadReactions(context.Background(), mfChat, mBob, 0); err != nil {
		t.Fatal(err)
	}
	pts := ptsOf(f.s, mBob)
	rows := len(f.s.updates[mBob])

	res, err := f.in.ReadReactions(context.Background(), mfChat, mBob, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.PtsCount != 0 || res.Pts != pts || res.Offset != 0 || len(f.s.updates[mBob]) != rows {
		t.Fatalf("пустой повтор = %+v (pts %d, строк %d -> %d)", res, pts, rows, len(f.s.updates[mBob]))
	}
}

func TestReadReactions_BatchLimit(t *testing.T) {
	f := newMentionsForum(t)
	ctx := context.Background()
	for n := 0; n < readBatchLimit+50; n++ {
		f.react(t, mAlice, f.send(t, mBob, "m", nil))
	}
	res, err := f.in.ReadReactions(ctx, mfChat, mBob, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.PtsCount != readBatchLimit || res.Offset != 1 {
		t.Fatalf("первая пачка = %+v, want %d строк и offset 1", res, readBatchLimit)
	}
	if got := unreadReactionsIn(f.s, mfChat, mBob); got != 50 {
		t.Fatalf("после первой пачки ❤ = %d, want 50", got)
	}
	res, err = f.in.ReadReactions(ctx, mfChat, mBob, 0)
	if err != nil || res.PtsCount != 50 || res.Offset != 0 {
		t.Fatalf("вторая пачка = %+v, %v", res, err)
	}
	if unreadReactionsIn(f.s, mfChat, mBob) != 0 {
		t.Fatalf("❤ остались")
	}
}

func TestReadReactions_TopicResolution(t *testing.T) {
	f := newMentionsForum(t)
	ctx := context.Background()
	m := f.send(t, mBob, "в теме A", &f.rootA)
	f.react(t, mAlice, m)

	// Не форум: top_msg_id игнорируется, читается весь чат.
	res, err := f.in.ReadReactions(ctx, mfChat, mBob, 9999)
	if err != nil || res.PtsCount != 1 {
		t.Fatalf("не форум, чужой номер: %+v, %v", res, err)
	}

	m2 := f.send(t, mBob, "ещё", &f.rootA)
	f.react(t, mAlice, m2)
	other := f.send(t, mCarol, "обычное", nil)
	f.enableForum()
	// Номер, который не тема, — TOPIC_ID_INVALID, ничего не снято.
	if _, err := f.in.ReadReactions(ctx, mfChat, mBob, other.Seq); !errors.Is(err, domain.ErrTopicIDInvalid) {
		t.Fatalf("не тема: err=%v, want ErrTopicIDInvalid", err)
	}
	if _, err := f.in.ReadReactions(ctx, mfChat, mBob, 9999); !errors.Is(err, domain.ErrTopicIDInvalid) {
		t.Fatalf("нет номера: err=%v, want ErrTopicIDInvalid", err)
	}
	if got := unreadReactionsIn(f.s, mfChat, mBob); got != 1 {
		t.Fatalf("отказ снял ❤: осталось %d, want 1", got)
	}
	// Не участник.
	if _, err := f.in.ReadReactions(ctx, mfChat, 4242, 0); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не участник: err=%v", err)
	}
}

func TestReactionFrame_TopMsgID(t *testing.T) {
	f := newMentionsForum(t)
	inA := f.send(t, mBob, "в теме A", &f.rootA)
	inG := f.send(t, mBob, "в General", nil)
	f.enableForum()

	f.pub.reset()
	f.react(t, mAlice, inA)
	if d := lastFrameOfType(t, f.pub, mBob, "reaction"); d["top_msg_id"] != float64(f.rootA.Seq) {
		t.Fatalf("кадр реакции в теме A: top_msg_id = %v, want %d", d["top_msg_id"], f.rootA.Seq)
	}
	f.pub.reset()
	f.react(t, mAlice, inG)
	if d := lastFrameOfType(t, f.pub, mBob, "reaction"); d["top_msg_id"] != float64(domain.GeneralTopicID) {
		t.Fatalf("кадр реакции в General: top_msg_id = %v, want 1", d["top_msg_id"])
	}
	// Чтение тоже несёт тему: по снятому unread второе устройство гасит ❤ темы.
	f.pub.reset()
	if _, err := f.in.ReadReactions(context.Background(), mfChat, mBob, f.rootA.Seq); err != nil {
		t.Fatal(err)
	}
	if d := lastFrameOfType(t, f.pub, mBob, "reaction"); d["top_msg_id"] != float64(f.rootA.Seq) {
		t.Fatalf("кадр прочтения в теме A: top_msg_id = %v", d["top_msg_id"])
	}

	// Вне форума ключа нет.
	g := newMentionsForum(t)
	m := g.send(t, mBob, "x", nil)
	g.pub.reset()
	g.react(t, mAlice, m)
	if d := lastFrameOfType(t, g.pub, mBob, "reaction"); d["top_msg_id"] != nil {
		t.Fatalf("вне форума top_msg_id = %v", d["top_msg_id"])
	}
}

// mentionFixture — группа Алиса+Боб+Кэрол; Алиса пишет сообщения, из которых
// упоминают Боба те, что в mention.
func mentionSeqs(t *testing.T, f *mentionsForum, root *domain.Message, mention ...bool) []domain.Message {
	t.Helper()
	var out []domain.Message
	for _, mn := range mention {
		text := "просто"
		if mn {
			text = "@bob_petrov привет"
		}
		out = append(out, f.send(t, mAlice, text, root))
	}
	return out
}

func TestReadMentions_OneMediaReadRowWithAllSeqs(t *testing.T) {
	f := newMentionsForum(t)
	ctx := context.Background()
	msgs := mentionSeqs(t, f, nil, true, false, true)
	if n := unreadMentionsOf(f.s, mfChat, mBob); n != 2 {
		t.Fatalf("упоминаний до чтения = %d, want 2", n)
	}
	rows := len(journalOf(f.s, mBob, "media_read"))
	before := ptsOf(f.s, mBob)

	res, err := f.in.ReadMentions(ctx, mfChat, mBob, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Underscore != domain.MessagesAffectedHistoryTag || res.PtsCount != 1 || res.Pts != before+1 || res.Offset != 0 {
		t.Fatalf("ответ = %+v (pts до %d)", res, before)
	}
	got := journalOf(f.s, mBob, "media_read")
	if len(got) != rows+1 {
		t.Fatalf("строк media_read = %d, want %d", len(got), rows+1)
	}
	var body struct {
		Underscore string  `json:"_"`
		Messages   []int64 `json:"messages"`
		PtsCount   int     `json:"pts_count"`
	}
	if err := json.Unmarshal(got[len(got)-1].Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body.Underscore != domain.UpdateReadPeerMessagesContentsTag || len(body.Messages) != 2 ||
		body.Messages[0] != msgs[0].Seq || body.Messages[1] != msgs[2].Seq || body.PtsCount != 1 {
		t.Fatalf("тело = %+v, want messages [%d %d]", body, msgs[0].Seq, msgs[2].Seq)
	}
	if n := unreadMentionsOf(f.s, mfChat, mBob); n != 0 {
		t.Fatalf("упоминаний после = %d", n)
	}
	// Живой кадр ушёл Бобу с тем же курсором.
	if d := lastFrameOfType(t, f.pub, mBob, "media_read"); d["pts"] != float64(res.Pts) {
		t.Fatalf("pts кадра = %v, want %d", d["pts"], res.Pts)
	}

	// Повтор: ничего не снято, pts текущий, строк нет.
	res, err = f.in.ReadMentions(ctx, mfChat, mBob, 0)
	if err != nil || res.PtsCount != 0 || res.Pts != ptsOf(f.s, mBob) || len(journalOf(f.s, mBob, "media_read")) != rows+1 {
		t.Fatalf("пустой повтор = %+v, %v", res, err)
	}
	if _, err := f.in.ReadMentions(ctx, mfChat, 4242, 0); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не участник: %v", err)
	}
}

func TestReadMentions_TopicScopeAndBatch(t *testing.T) {
	f := newMentionsForum(t)
	ctx := context.Background()
	mentionSeqs(t, f, &f.rootA, true, true)
	inB := mentionSeqs(t, f, &f.rootB, true)
	f.enableForum()
	if n := unreadMentionsOf(f.s, mfChat, mBob); n != 3 {
		t.Fatalf("упоминаний до = %d", n)
	}
	res, err := f.in.ReadMentions(ctx, mfChat, mBob, f.rootA.Seq)
	if err != nil || res.PtsCount != 1 {
		t.Fatalf("тема A: %+v, %v", res, err)
	}
	if n := unreadMentionsOf(f.s, mfChat, mBob); n != 1 {
		t.Fatalf("после темы A упоминаний = %d, want 1 (тема B)", n)
	}
	rows := journalOf(f.s, mBob, "media_read")
	var body struct {
		Messages []int64 `json:"messages"`
	}
	_ = json.Unmarshal(rows[len(rows)-1].Payload, &body)
	if len(body.Messages) != 2 {
		t.Fatalf("в кадре темы A %v, want 2 номера", body.Messages)
	}
	if _, err := f.in.ReadMentions(ctx, mfChat, mBob, inB[0].Seq); !errors.Is(err, domain.ErrTopicIDInvalid) {
		t.Fatalf("не тема: %v", err)
	}

	// Пачка: 100 за вызов, остаток — offset 1.
	g := newMentionsForum(t)
	for n := 0; n < readBatchLimit+7; n++ {
		g.send(t, mAlice, "@bob_petrov", nil)
	}
	res, err = g.in.ReadMentions(ctx, mfChat, mBob, 0)
	if err != nil || res.Offset != 1 || res.PtsCount != 1 {
		t.Fatalf("первая пачка = %+v, %v", res, err)
	}
	rows = journalOf(g.s, mBob, "media_read")
	_ = json.Unmarshal(rows[len(rows)-1].Payload, &body)
	if len(body.Messages) != readBatchLimit {
		t.Fatalf("в первой пачке %d номеров, want %d", len(body.Messages), readBatchLimit)
	}
	res, err = g.in.ReadMentions(ctx, mfChat, mBob, 0)
	if err != nil || res.Offset != 0 || res.PtsCount != 1 || unreadMentionsOf(g.s, mfChat, mBob) != 0 {
		t.Fatalf("вторая пачка = %+v, %v", res, err)
	}
}
