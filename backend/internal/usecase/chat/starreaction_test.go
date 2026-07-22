package chat

import (
	"context"
	"sort"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeStarReactions — in-memory StarReactionRepo (накопительный вклад по паре
// сообщение+пользователь).
type fakeStarReactions struct {
	mu sync.Mutex
	// msgID -> userID -> вклад
	stars map[int64]map[int64]int64
	anon  map[int64]map[int64]bool
}

func newFakeStarReactions() *fakeStarReactions {
	return &fakeStarReactions{stars: map[int64]map[int64]int64{}, anon: map[int64]map[int64]bool{}}
}

func (f *fakeStarReactions) Add(_ context.Context, messageID, userID, delta int64, anonymous bool) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stars[messageID] == nil {
		f.stars[messageID] = map[int64]int64{}
		f.anon[messageID] = map[int64]bool{}
	}
	f.stars[messageID][userID] += delta
	f.anon[messageID][userID] = anonymous
	return f.stars[messageID][userID], nil
}

func (f *fakeStarReactions) AggregatesFor(_ context.Context, messageIDs []int64, viewerID int64) (map[int64]domain.StarReactionAgg, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[int64]domain.StarReactionAgg{}
	for _, id := range messageIDs {
		per := f.stars[id]
		if len(per) == 0 {
			continue
		}
		var agg domain.StarReactionAgg
		for uid, s := range per {
			agg.Total += s
			if uid == viewerID {
				agg.Mine = s
			}
		}
		out[id] = agg
	}
	return out, nil
}

func (f *fakeStarReactions) TopSenders(_ context.Context, messageID int64, limit int) ([]domain.StarReactionSender, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.StarReactionSender
	for uid, s := range f.stars[messageID] {
		out = append(out, domain.StarReactionSender{
			User: domain.UserCard{ID: uid}, Stars: s, Anonymous: f.anon[messageID][uid],
		})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Stars > out[b].Stars })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func newStarReactionInteractor() (*Interactor, *store, *fakeStars, *fakeStarReactions) {
	in, s := newInteractor()
	fs := newFakeStars()
	sr := newFakeStarReactions()
	in.SetStars(fs)
	in.SetStarReactions(sr)
	in.SetPublisher(&fakePublisher{})
	return in, s, fs, sr
}

// seedStarReactionMsg: user 1 отправляет текст в приватный чат с user 2.
func seedStarReactionMsg(t *testing.T, in *Interactor) (chatID, msgID int64) {
	t.Helper()
	ctx := context.Background()
	chatID, err := in.CreatePrivateChat(ctx, 1, 2)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "text", Text: "post", ClientMsgID: "m1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	return chatID, msg.ID
}

func TestStarReaction_ChargesCreditsAndAccumulates(t *testing.T) {
	in, _, fs, _ := newStarReactionInteractor()
	ctx := context.Background()
	chatID, msgID := seedStarReactionMsg(t, in)

	// Без звёзд — ErrPaidRequired.
	if _, _, _, err := in.SendStarReaction(ctx, chatID, msgID, 2, 10, false); err != domain.ErrPaidRequired {
		t.Fatalf("star react without stars = %v; want ErrPaidRequired", err)
	}

	// Пополняем 50 и жмём 10: -10 у отправителя(2), +10 автору(1), агрегат 10.
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	agg, _, bal, err := in.SendStarReaction(ctx, chatID, msgID, 2, 10, false)
	if err != nil {
		t.Fatalf("SendStarReaction: %v", err)
	}
	if agg.Total != 10 || agg.Mine != 10 || bal != 40 {
		t.Fatalf("after 10: total=%d mine=%d bal=%d; want 10,10,40", agg.Total, agg.Mine, bal)
	}
	if b, _ := fs.Balance(ctx, 1); b != 10 {
		t.Fatalf("author credited = %d; want 10", b)
	}

	// Накопление: ещё 5 → вклад 15, агрегат 15.
	agg, _, bal, err = in.SendStarReaction(ctx, chatID, msgID, 2, 5, false)
	if err != nil {
		t.Fatalf("SendStarReaction 2: %v", err)
	}
	if agg.Total != 15 || agg.Mine != 15 || bal != 35 {
		t.Fatalf("after +5: total=%d mine=%d bal=%d; want 15,15,35", agg.Total, agg.Mine, bal)
	}

	// Hydrate отдаёт агрегат зрителю.
	msg, _ := in.msgs.GetByID(ctx, msgID)
	win := []domain.Message{msg}
	in.hydrateStarReactions(ctx, 2, win)
	if win[0].StarReactionTotal != 15 || win[0].StarReactionMine != 15 {
		t.Fatalf("hydrate viewer 2: total=%d mine=%d; want 15,15", win[0].StarReactionTotal, win[0].StarReactionMine)
	}
	// Автор видит total, но mine=0 (он не реагировал).
	win2 := []domain.Message{msg}
	in.hydrateStarReactions(ctx, 1, win2)
	if win2[0].StarReactionTotal != 15 || win2[0].StarReactionMine != 0 {
		t.Fatalf("hydrate viewer 1: total=%d mine=%d; want 15,0", win2[0].StarReactionTotal, win2[0].StarReactionMine)
	}
}

func TestStarReaction_AnonymousHidesSender(t *testing.T) {
	in, _, _, _ := newStarReactionInteractor()
	ctx := context.Background()
	chatID, msgID := seedStarReactionMsg(t, in)
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	_, top, _, err := in.SendStarReaction(ctx, chatID, msgID, 2, 10, true)
	if err != nil {
		t.Fatalf("SendStarReaction: %v", err)
	}
	if len(top) != 1 {
		t.Fatalf("top senders = %d; want 1", len(top))
	}
	if !top[0].Anonymous || top[0].User.ID != 0 {
		t.Fatalf("anonymous sender must be hidden: anon=%v id=%d", top[0].Anonymous, top[0].User.ID)
	}
}

func TestStarReaction_BadCountAndDisabled(t *testing.T) {
	in, _, _, _ := newStarReactionInteractor()
	ctx := context.Background()
	chatID, msgID := seedStarReactionMsg(t, in)
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := in.SendStarReaction(ctx, chatID, msgID, 2, 0, false); err != domain.ErrBadReaction {
		t.Fatalf("zero count = %v; want ErrBadReaction", err)
	}
	if _, _, _, err := in.SendStarReaction(ctx, chatID, msgID, 2, maxStarReaction+1, false); err != domain.ErrBadReaction {
		t.Fatalf("over-max count = %v; want ErrBadReaction", err)
	}
	// Не член чата (user 3) — ErrNotFound.
	if _, _, _, err := in.SendStarReaction(ctx, chatID, msgID, 3, 5, false); err != domain.ErrNotFound {
		t.Fatalf("non-member = %v; want ErrNotFound", err)
	}
}
