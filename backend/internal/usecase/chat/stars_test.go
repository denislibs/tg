package chat

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeStars — in-memory StarsRepo.
type fakeStars struct {
	mu      sync.Mutex
	next    int64
	bal     map[int64]int64
	catalog map[int64]domain.StarGift
	saved   map[int64]*domain.GiftInfo
	owner   map[int64]int64 // savedID -> ownerID
}

func newFakeStars() *fakeStars {
	return &fakeStars{
		bal: map[int64]int64{},
		catalog: map[int64]domain.StarGift{
			1: {ID: 1, Emoji: "🌹", Title: "Роза", PriceStars: 15, ConvertStars: 15},
		},
		saved: map[int64]*domain.GiftInfo{},
		owner: map[int64]int64{},
	}
}

func (f *fakeStars) Balance(_ context.Context, userID int64) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.bal[userID], nil
}

func (f *fakeStars) AddBalance(_ context.Context, userID, delta int64) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.bal[userID]+delta < 0 {
		return 0, domain.ErrForbidden
	}
	f.bal[userID] += delta
	return f.bal[userID], nil
}

func (f *fakeStars) Catalog(_ context.Context) ([]domain.StarGift, error) {
	return []domain.StarGift{f.catalog[1]}, nil
}

func (f *fakeStars) GiftByID(_ context.Context, id int64) (domain.StarGift, error) {
	g, ok := f.catalog[id]
	if !ok {
		return domain.StarGift{}, domain.ErrNotFound
	}
	return g, nil
}

func (f *fakeStars) DecRemains(context.Context, int64) error { return nil }

func (f *fakeStars) SaveGift(_ context.Context, ownerID int64, fromID *int64, giftID int64, message string, anonymous bool) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	f.saved[f.next] = &domain.GiftInfo{
		ID: f.next, Gift: f.catalog[giftID], FromID: fromID,
		Message: message, Anonymous: anonymous, ConvertStars: f.catalog[giftID].ConvertStars,
	}
	f.owner[f.next] = ownerID
	return f.next, nil
}

func (f *fakeStars) GiftInfo(_ context.Context, savedID, viewerID int64) (domain.GiftInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	gi, ok := f.saved[savedID]
	if !ok {
		return domain.GiftInfo{}, domain.ErrNotFound
	}
	out := *gi
	if out.Anonymous && viewerID != f.owner[savedID] {
		out.FromID = nil
	}
	return out, nil
}

func (f *fakeStars) ProfileGifts(_ context.Context, ownerID, viewerID int64) ([]domain.GiftInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.GiftInfo
	for id, gi := range f.saved {
		if f.owner[id] != ownerID || gi.Converted {
			continue
		}
		if gi.Hidden && ownerID != viewerID {
			continue
		}
		out = append(out, *gi)
	}
	return out, nil
}

func (f *fakeStars) SetHidden(_ context.Context, savedID, ownerID int64, hidden bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	gi, ok := f.saved[savedID]
	if !ok || f.owner[savedID] != ownerID {
		return domain.ErrForbidden
	}
	gi.Hidden = hidden
	return nil
}

func (f *fakeStars) Convert(_ context.Context, savedID, ownerID int64) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	gi, ok := f.saved[savedID]
	if !ok || f.owner[savedID] != ownerID || gi.Converted {
		return 0, domain.ErrForbidden
	}
	gi.Converted = true
	return gi.ConvertStars, nil
}

func newStarsInteractor() (*Interactor, *fakeStars, *fakePublisher) {
	in, _ := newInteractor()
	fs := newFakeStars()
	pub := &fakePublisher{}
	in.SetStars(fs)
	in.SetPublisher(pub)
	return in, fs, pub
}

func TestTopUpStars(t *testing.T) {
	in, _, pub := newStarsInteractor()
	ctx := context.Background()
	bal, err := in.TopUpStars(ctx, 1, 100)
	if err != nil || bal != 100 {
		t.Fatalf("TopUpStars = %d, %v; want 100", bal, err)
	}
	if pub.countFor(1) == 0 {
		t.Fatal("expected balance_update published to user")
	}
	if _, err := in.TopUpStars(ctx, 1, 0); err != domain.ErrForbidden {
		t.Fatalf("zero top-up should be ErrForbidden, got %v", err)
	}
}

func TestSendGift(t *testing.T) {
	in, fs, _ := newStarsInteractor()
	ctx := context.Background()
	// нет звёзд — нельзя подарить
	if _, _, err := in.SendGift(ctx, 1, 2, 1, "hi", false); err != domain.ErrForbidden {
		t.Fatalf("send without stars should be ErrForbidden, got %v", err)
	}
	// пополняем и дарим
	if _, err := in.TopUpStars(ctx, 1, 50); err != nil {
		t.Fatal(err)
	}
	msg, bal, err := in.SendGift(ctx, 1, 2, 1, "с днём рождения", false)
	if err != nil {
		t.Fatalf("SendGift: %v", err)
	}
	if bal != 35 { // 50 - 15
		t.Fatalf("balance after gift = %d; want 35", bal)
	}
	if msg.Type != "gift" || msg.GiftID == nil {
		t.Fatalf("gift message malformed: type=%q giftID=%v", msg.Type, msg.GiftID)
	}
	if msg.Gift == nil || msg.Gift.Gift.PriceStars != 15 {
		t.Fatal("gift message not hydrated")
	}
	// подарок появился в профиле получателя
	gifts, err := in.ProfileGifts(ctx, 2, 2)
	if err != nil || len(gifts) != 1 {
		t.Fatalf("ProfileGifts = %d, %v; want 1", len(gifts), err)
	}
	_ = fs
}

func TestConvertGift(t *testing.T) {
	in, _, _ := newStarsInteractor()
	ctx := context.Background()
	_, _ = in.TopUpStars(ctx, 1, 50)
	msg, _, err := in.SendGift(ctx, 1, 2, 1, "", false)
	if err != nil {
		t.Fatal(err)
	}
	savedID := *msg.GiftID
	// получатель конвертирует подарок в звёзды
	bal, err := in.ConvertGift(ctx, savedID, 2)
	if err != nil || bal != 15 {
		t.Fatalf("ConvertGift = %d, %v; want 15", bal, err)
	}
	// повторная конвертация запрещена
	if _, err := in.ConvertGift(ctx, savedID, 2); err != domain.ErrForbidden {
		t.Fatalf("double convert should fail, got %v", err)
	}
	// после конвертации подарок исчез из профиля
	gifts, _ := in.ProfileGifts(ctx, 2, 2)
	if len(gifts) != 0 {
		t.Fatalf("converted gift still in profile: %d", len(gifts))
	}
}

func TestGiftAnonymity(t *testing.T) {
	in, _, _ := newStarsInteractor()
	ctx := context.Background()
	_, _ = in.TopUpStars(ctx, 1, 50)
	msg, _, err := in.SendGift(ctx, 1, 2, 1, "", true) // anonymous
	if err != nil {
		t.Fatal(err)
	}
	savedID := *msg.GiftID
	// владелец (2) видит отправителя
	ownerView, _ := in.stars.GiftInfo(ctx, savedID, 2)
	if ownerView.FromID == nil {
		t.Fatal("owner should see anonymous sender")
	}
	// посторонний (3) не видит
	otherView, _ := in.stars.GiftInfo(ctx, savedID, 3)
	if otherView.FromID != nil {
		t.Fatal("outsider must not see anonymous sender")
	}
}
