package chat

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePaidMedia — in-memory PaidMediaRepo поверх тестового store (для LockedMedia).
type fakePaidMedia struct {
	mu      sync.Mutex
	s       *store
	prices  map[int64]int64
	unlocks map[int64]map[int64]bool // msgID -> userID -> true
}

func newFakePaidMedia(s *store) *fakePaidMedia {
	return &fakePaidMedia{s: s, prices: map[int64]int64{}, unlocks: map[int64]map[int64]bool{}}
}

func (f *fakePaidMedia) SetPrice(_ context.Context, messageID, price int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prices[messageID] = price
	return nil
}

func (f *fakePaidMedia) PricesByIDs(_ context.Context, ids []int64) (map[int64]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[int64]int64{}
	for _, id := range ids {
		if p, ok := f.prices[id]; ok {
			out[id] = p
		}
	}
	return out, nil
}

func (f *fakePaidMedia) UnlockedByIDs(_ context.Context, userID int64, ids []int64) (map[int64]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[int64]bool{}
	for _, id := range ids {
		if f.unlocks[id][userID] {
			out[id] = true
		}
	}
	return out, nil
}

func (f *fakePaidMedia) Unlock(_ context.Context, messageID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.unlocks[messageID] == nil {
		f.unlocks[messageID] = map[int64]bool{}
	}
	if f.unlocks[messageID][userID] {
		return false, nil
	}
	f.unlocks[messageID][userID] = true
	return true, nil
}

func (f *fakePaidMedia) LockedMedia(_ context.Context, userID, mediaID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, msgs := range f.s.messages {
		for _, m := range msgs {
			if m.MediaID == nil || *m.MediaID != mediaID {
				continue
			}
			if _, paid := f.prices[m.ID]; !paid {
				continue
			}
			if m.SenderID != userID && !f.unlocks[m.ID][userID] {
				return true, nil
			}
		}
	}
	return false, nil
}

// newPaidInteractor собирает интерактор со звёздами и платным медиа поверх
// общего in-memory store (возвращает store для сидов).
func newPaidInteractor() (*Interactor, *store, *fakeStars, *fakePaidMedia) {
	in, s := newInteractor()
	fs := newFakeStars()
	pm := newFakePaidMedia(s)
	in.SetStars(fs)
	in.SetPaidMedia(pm)
	in.SetPublisher(&fakePublisher{})
	return in, s, fs, pm
}

// sendPaidPhoto: пользователь 1 шлёт платное фото в приватный чат с пользователем 2.
func sendPaidPhoto(t *testing.T, in *Interactor, s *store, price int64) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	chatID, err := in.CreatePrivateChat(ctx, 1, 2)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	var mid int64 = 77
	s.seedMedia(mid, 1)
	msg, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: 1, Type: "photo", MediaID: &mid,
		PaidMediaPrice: &price, ClientMsgID: "p1",
	})
	if err != nil {
		t.Fatalf("Send paid photo: %v", err)
	}
	return msg.ID, mid
}

func TestPaidMedia_LockedForRecipientOnlyAndPriceSet(t *testing.T) {
	in, s, _, _ := newPaidInteractor()
	msgID, _ := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()

	// автор (1) видит медиа сразу
	msg, err := in.msgs.GetByID(ctx, msgID)
	if err != nil {
		t.Fatal(err)
	}
	author := []domain.Message{msg}
	in.hydratePaidMedia(ctx, 1, author)
	if author[0].PaidMediaLocked {
		t.Fatal("author must see media unlocked")
	}
	if author[0].PaidMediaPrice == nil || *author[0].PaidMediaPrice != 20 {
		t.Fatalf("author price = %v; want 20", author[0].PaidMediaPrice)
	}
	if author[0].MediaID == nil {
		t.Fatal("author must keep media_id")
	}

	// получатель (2) видит заблокированное медиа без ссылки на контент
	recip := []domain.Message{msg}
	in.hydratePaidMedia(ctx, 2, recip)
	if !recip[0].PaidMediaLocked {
		t.Fatal("recipient must see media locked")
	}
	if recip[0].MediaID != nil {
		t.Fatal("locked media must not expose media_id")
	}
	if recip[0].PaidMediaPrice == nil || *recip[0].PaidMediaPrice != 20 {
		t.Fatalf("recipient price = %v; want 20", recip[0].PaidMediaPrice)
	}
}

func TestPaidMedia_UnlockChargesCreditsAndIdempotent(t *testing.T) {
	in, s, fs, pm := newPaidInteractor()
	msgID, mediaID := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()

	// без звёзд — ErrPaidRequired
	if _, _, err := in.UnlockPaidMedia(ctx, msgID, 2); err != domain.ErrPaidRequired {
		t.Fatalf("unlock without stars = %v; want ErrPaidRequired", err)
	}
	// медиа всё ещё закрыто для скачивания
	if locked, _ := pm.LockedMedia(ctx, 2, mediaID); !locked {
		t.Fatal("media must stay locked before payment")
	}

	// пополняем и разблокируем: -20 у покупателя, +20 автору
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	msg, bal, err := in.UnlockPaidMedia(ctx, msgID, 2)
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if bal != 30 {
		t.Fatalf("buyer balance = %d; want 30", bal)
	}
	if b, _ := fs.Balance(ctx, 1); b != 20 {
		t.Fatalf("author balance = %d; want 20", b)
	}
	if msg.PaidMediaLocked || msg.MediaID == nil {
		t.Fatal("unlocked message must expose media")
	}
	// байты медиа теперь доступны покупателю
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); !ok {
		t.Fatal("buyer must access media after unlock")
	}

	// повторный unlock не списывает повторно
	if _, bal2, err := in.UnlockPaidMedia(ctx, msgID, 2); err != nil || bal2 != 30 {
		t.Fatalf("repeat unlock = %d, %v; want 30, nil", bal2, err)
	}
	if b, _ := fs.Balance(ctx, 1); b != 20 {
		t.Fatalf("author double-credited: balance = %d; want 20", b)
	}
}

func TestPaidMedia_AuthorAccessesWithoutCharge(t *testing.T) {
	in, s, fs, _ := newPaidInteractor()
	msgID, mediaID := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()
	_, _, err := in.UnlockPaidMedia(ctx, msgID, 1) // автор
	if err != nil {
		t.Fatalf("author unlock: %v", err)
	}
	if b, _ := fs.Balance(ctx, 1); b != 0 {
		t.Fatalf("author must not be charged; balance = %d", b)
	}
	if ok, _ := in.CanAccessMedia(ctx, 1, mediaID); !ok {
		t.Fatal("author must always access own media")
	}
}
