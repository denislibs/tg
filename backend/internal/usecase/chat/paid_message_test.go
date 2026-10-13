package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-Г (MC-06): плата за сообщение только с согласием. tweb
// `appMessagesManager.ts:2702` шлёт `allow_paid_stars` = цена × число сообщений
// запроса; без него сервер отвечает ALLOW_PAYMENT_REQUIRED_<N>.

type paidFixture struct {
	in    *Interactor
	s     *store
	fg    *fakeGroupRepo
	stars *fakeStars
	sched *fakeScheduled
	cid   int64 // группа с платой 5, владелец 1, участник 2
}

func newPaidFixture(t *testing.T) paidFixture {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	stars := newFakeStars()
	in.SetStars(stars)
	in.SetPublisher(&fakePublisher{})
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	in.SetPolls(newFakePolls())
	in.SetChecklists(newFakeChecklists())
	ctx := context.Background()
	fg.users[1] = domain.UserReal{ID: 1, FirstName: "Owner"}
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Member"}
	cid, _, err := in.CreateGroup(ctx, 1, "Paid", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatChargeStars(ctx, cid, 1, 5); err != nil {
		t.Fatal(err)
	}
	return paidFixture{in: in, s: s, fg: fg, stars: stars, sched: fs, cid: cid}
}

func (f paidFixture) topUp(t *testing.T, user, n int64) {
	t.Helper()
	if _, err := f.in.TopUpStars(context.Background(), user, n); err != nil {
		t.Fatal(err)
	}
}

func (f paidFixture) balance(user int64) int64 {
	b, _ := f.stars.Balance(context.Background(), user)
	return b
}

func needStars(err error) int64 {
	var e domain.ErrAllowPaymentRequired
	if errors.As(err, &e) {
		return e.Stars
	}
	return -1
}

func TestPaidMessage_RequiresAllowance(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)

	// Согласия нет → отказ с суммой, баланс цел, сообщения нет.
	_, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "a", ClientMsgID: "c0"})
	if got := needStars(err); got != 5 {
		t.Fatalf("без согласия: %v, want ErrAllowPaymentRequired{5}", err)
	}
	if f.balance(2) != 100 {
		t.Fatalf("баланс тронут отказом: %d", f.balance(2))
	}
	// Согласие меньше цены — тоже отказ.
	_, err = f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "a", ClientMsgID: "c0", AllowPaidStars: 4})
	if got := needStars(err); got != 5 {
		t.Fatalf("согласие 4 при цене 5: %v", err)
	}
	// Согласие = цена → списано 5.
	if _, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "a", ClientMsgID: "c1", AllowPaidStars: 5}); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 95 {
		t.Fatalf("после согласия 5: баланс %d, want 95", f.balance(2))
	}
	// Согласие — потолок: 100 при цене 5 списывает 5.
	if _, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "b", ClientMsgID: "c2", AllowPaidStars: 100}); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 90 {
		t.Fatalf("потолок 100: баланс %d, want 90", f.balance(2))
	}
	// Вход без allow_paid_stars в TL (бот) — списывается без проверки, как раньше.
	if _, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "bot", ClientMsgID: "c3", paidConsentNotRequired: true}); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 85 {
		t.Fatalf("paidConsentNotRequired: баланс %d, want 85", f.balance(2))
	}
	// Владелец пишет бесплатно без согласия.
	if _, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 1, Type: "text", Text: "own", ClientMsgID: "c4"}); err != nil {
		t.Fatalf("владелец: %v", err)
	}
	if f.balance(1) != 15 { // доход владельца: три списания по 5; свои сообщения бесплатны
		t.Fatalf("баланс владельца %d, want 15", f.balance(1))
	}
}

func TestPaidMessage_BalanceTooLow(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 3)
	_, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "a", ClientMsgID: "c1", AllowPaidStars: 5})
	if !errors.Is(err, domain.ErrBalanceTooLow) {
		t.Fatalf("баланс 3, согласие 5: %v, want ErrBalanceTooLow", err)
	}
	if f.balance(2) != 3 {
		t.Fatalf("баланс изменился: %d", f.balance(2))
	}
}

// Каждый пользовательский вход в платную группу без суммы получает отказ.
func TestPaidMessage_EveryUserEntryNeedsAllowance(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)
	f.s.seedMedia(42, 2)
	cases := map[string]func() error{
		"poll": func() error {
			_, err := f.in.SendPoll(ctx, SendPollInput{ChatID: f.cid, SenderID: 2, Question: "q", Options: []string{"a", "b"}})
			return err
		},
		"checklist": func() error {
			_, err := f.in.SendChecklist(ctx, SendChecklistInput{ChatID: f.cid, SenderID: 2, Title: "t", Items: []string{"a"}})
			return err
		},
		"schedule": func() error {
			_, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Text: "x", ScheduleDate: future()})
			return err
		},
		"story share": func() error {
			return f.in.SendStoryShare(ctx, f.cid, 2, 42, "История", 0)
		},
	}
	for name, run := range cases {
		if got := needStars(run()); got != 5 {
			t.Errorf("%s без суммы: needStars=%d, want 5", name, got)
		}
	}
	if f.balance(2) != 100 || f.sched.count() != 0 {
		t.Fatalf("отказы оставили следы: баланс %d, строк %d", f.balance(2), f.sched.count())
	}
}

func TestPaidForward_WholeBatch(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)
	f.fg.users[3] = domain.UserReal{ID: 3, FirstName: "Other"}
	src, _, err := f.in.CreateGroup(ctx, 3, "Src", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, txt := range []string{"1", "2", "3"} {
		m, err := f.in.Send(ctx, SendInput{ChatID: src, SenderID: 3, Text: txt})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	fwd := func(allow int64) ([]domain.Message, error) {
		return f.in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: f.cid, MsgIDs: ids, SenderID: 2, AllowPaidStars: allow})
	}
	if _, err := fwd(10); needStars(err) != 15 {
		t.Fatalf("согласие 10 за пачку из 3 по 5: %v, want ErrAllowPaymentRequired{15}", err)
	}
	if f.balance(2) != 100 {
		t.Fatalf("отказ списал: %d", f.balance(2))
	}
	out, err := fwd(15)
	if err != nil || len(out) != 3 {
		t.Fatalf("пересылка с согласием 15: %v (%d копий)", err, len(out))
	}
	if f.balance(2) != 85 {
		t.Fatalf("списано %d, want 15", 100-f.balance(2))
	}
}

func TestPaidScheduled_ChargedOnSchedule(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 20)
	sm, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Text: "x", ScheduleDate: future(), AllowPaidStars: 5})
	if err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 15 {
		t.Fatalf("после постановки %d, want 15", f.balance(2))
	}
	if _, err := f.in.SendScheduledNow(ctx, f.cid, 2, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 15 {
		t.Fatalf("публикация списала второй раз: %d", f.balance(2))
	}
}

// Отложенная пересылка пачки: согласие — на всю пачку при постановке, а в
// каждой строке остаётся доля на одно сообщение (повторы платят по ней).
func TestPaidScheduledForward_BatchConsent(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)
	f.fg.users[3] = domain.UserReal{ID: 3, FirstName: "Other"}
	src, _, err := f.in.CreateGroup(ctx, 3, "Src", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, txt := range []string{"1", "2", "3"} {
		m, err := f.in.Send(ctx, SendInput{ChatID: src, SenderID: 3, Text: txt})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	fwd := func(allow int64) error {
		_, err := f.in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: f.cid, MsgIDs: ids, SenderID: 2,
			AllowPaidStars: allow, ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
		return err
	}
	if got := needStars(fwd(10)); got != 15 || f.sched.count() != 0 {
		t.Fatalf("согласие 10 за пачку из 3: need=%d, строк %d", got, f.sched.count())
	}
	if err := fwd(15); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 85 || f.sched.count() != 3 {
		t.Fatalf("после постановки: баланс %d, строк %d", f.balance(2), f.sched.count())
	}
	for _, r := range f.sched.sorted(func(domain.ScheduledMessage) bool { return true }) {
		if r.Params.AllowPaidStars == nil || *r.Params.AllowPaidStars != 5 {
			t.Fatalf("согласие строки: %v, want 5 (доля пачки)", r.Params.AllowPaidStars)
		}
	}
}

// Согласие постановки действует на повторы: рост цены — отказ без повторных
// попыток; строка до деплоя (AllowPaidStars == nil) платит как раньше.
func TestPaidScheduled_RepeatUsesStoredConsent(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)
	row := domain.ScheduledMessage{ChatID: f.cid, SenderID: 2, Type: "text", Text: "r", Occurrence: 1}

	// Цена прежняя, согласие 5 → списывает.
	row.Params.AllowPaidStars = ptr(int64(5))
	if _, err := f.in.publishScheduledRow(ctx, row, false); err != nil {
		t.Fatalf("повтор при прежней цене: %v", err)
	}
	if f.balance(2) != 95 {
		t.Fatalf("повтор не списал: %d", f.balance(2))
	}
	// Владелец поднял цену до 8 → отказ по существу.
	if err := f.in.SetChatChargeStars(ctx, f.cid, 1, 8); err != nil {
		t.Fatal(err)
	}
	row.SendAt = row.SendAt.Add(time.Minute)
	_, err := f.in.publishScheduledRow(ctx, row, false)
	if needStars(err) != 8 || !publishRefused(err) {
		t.Fatalf("повтор при выросшей цене: %v (refused=%v)", err, publishRefused(err))
	}
	if f.balance(2) != 95 {
		t.Fatalf("отказ списал: %d", f.balance(2))
	}
	// Строка до деплоя: nil → списывает без проверки.
	row.Params.AllowPaidStars = nil
	row.SendAt = row.SendAt.Add(time.Minute)
	if _, err := f.in.publishScheduledRow(ctx, row, false); err != nil {
		t.Fatalf("строка до деплоя: %v", err)
	}
	if f.balance(2) != 87 {
		t.Fatalf("строка до деплоя: баланс %d, want 87", f.balance(2))
	}
}

// raisePriceStars поднимает цену группы перед первым движением баланса: админ
// успел между проверкой согласия и списанием.
type raisePriceStars struct {
	StarsRepo
	once  sync.Once
	raise func()
}

func (r *raisePriceStars) AddBalance(ctx context.Context, userID, delta int64) (int64, error) {
	r.once.Do(r.raise)
	return r.StarsRepo.AddBalance(ctx, userID, delta)
}

// Смена цены между проверкой и списанием не списывает больше согласованного.
func TestPaidMessage_PriceReadOnce(t *testing.T) {
	f := newPaidFixture(t)
	ctx := context.Background()
	f.topUp(t, 2, 100)
	f.in.SetStars(&raisePriceStars{StarsRepo: f.stars, raise: func() {
		if err := f.in.SetChatChargeStars(ctx, f.cid, 1, 6); err != nil {
			t.Error(err)
		}
	}})
	if _, err := f.in.Send(ctx, SendInput{ChatID: f.cid, SenderID: 2, Type: "text", Text: "a", ClientMsgID: "c1", AllowPaidStars: 5}); err != nil {
		t.Fatal(err)
	}
	if f.balance(2) != 95 {
		t.Fatalf("списано %d, want 5 (цена читается один раз)", 100-f.balance(2))
	}
}

func TestPaidComment_NeedsAllowance(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	stars := newFakeStars()
	f.i.SetStars(stars)
	if err := f.i.SetChatChargeStars(ctx, f.disc, 7, 5); err != nil {
		t.Fatal(err)
	}
	_, _ = stars.AddBalance(ctx, 9, 50)
	_, err := f.i.PostComment(ctx, f.ch, f.post.ID, 9, "c", "k1", 0)
	if needStars(err) != 5 {
		t.Fatalf("комментарий без суммы: %v", err)
	}
	if _, err := f.i.PostComment(ctx, f.ch, f.post.ID, 9, "c", "k1", 5); err != nil {
		t.Fatal(err)
	}
	if b, _ := stars.Balance(ctx, 9); b != 45 {
		t.Fatalf("баланс %d, want 45", b)
	}
}
