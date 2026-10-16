package chat

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePaidMedia — in-memory PaidMediaRepo поверх тестового store (замок — locked).
type fakePaidMedia struct {
	mu      sync.Mutex
	s       *store
	prices  map[int64]int64
	sources map[int64]int64          // msgID -> предложение (копия → исходник)
	unlocks map[int64]map[int64]bool // offerID -> userID -> true
}

// newFakePaidMedia подключает и замок к фейку доступа к медиа (s.paidLocked).
func newFakePaidMedia(s *store) *fakePaidMedia {
	f := &fakePaidMedia{s: s, prices: map[int64]int64{}, sources: map[int64]int64{}, unlocks: map[int64]map[int64]bool{}}
	s.mu.Lock()
	s.paidLocked = f.locked
	s.mu.Unlock()
	return f
}

func (f *fakePaidMedia) SetPrice(_ context.Context, messageID, price, sourceID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prices[messageID] = price
	if sourceID != 0 {
		f.sources[messageID] = sourceID
	}
	return nil
}

// offerOf — предложение и продавец сообщения (под f.mu).
func (f *fakePaidMedia) offerOf(msgID int64) (int64, int64) {
	offer := msgID
	if src, ok := f.sources[msgID]; ok {
		offer = src
	}
	f.s.mu.Lock()
	defer f.s.mu.Unlock()
	for _, msgs := range f.s.messages {
		for _, m := range msgs {
			if m.ID == offer {
				return offer, m.SenderID
			}
		}
	}
	return offer, 0
}

func (f *fakePaidMedia) Offers(_ context.Context, ids []int64) (map[int64]PaidOffer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[int64]PaidOffer{}
	for _, id := range ids {
		if p, ok := f.prices[id]; ok {
			offer, seller := f.offerOf(id)
			out[id] = PaidOffer{Price: p, OfferID: offer, SellerID: seller}
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

func (f *fakePaidMedia) Unlock(_ context.Context, offerID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.unlocks[offerID] == nil {
		f.unlocks[offerID] = map[int64]bool{}
	}
	if f.unlocks[offerID][userID] {
		return false, nil
	}
	f.unlocks[offerID][userID] = true
	return true, nil
}

// locked — сообщение msgID платное и закрыто для userID (продавец не он и
// предложение не разблокировано): условие paidMediaLockedFor.
func (f *fakePaidMedia) locked(userID, msgID int64) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, paid := f.prices[msgID]; !paid {
		return false
	}
	offer, seller := f.offerOf(msgID)
	return seller != userID && !f.unlocks[offer][userID]
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
	in, s, fs, _ := newPaidInteractor()
	msgID, mediaID := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()

	// без звёзд — ErrBalanceTooLow
	if _, _, err := in.UnlockPaidMedia(ctx, msgID, 2); err != domain.ErrBalanceTooLow {
		t.Fatalf("unlock without stars = %v; want ErrBalanceTooLow", err)
	}
	// медиа всё ещё закрыто для скачивания
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); ok {
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

// P0-фикс 4 (аватар Алисы 404): замок платного медиа закрывает файл ТОЛЬКО как
// вложение платного сообщения. Тот же файл, открытый зрителю другим путём, —
// фото профиля автора или бесплатное сообщение в другом чате — качается без
// покупки; прежде замок по media_id гасил все пути разом.
func TestPaidMedia_LockDoesNotHideOtherPaths(t *testing.T) {
	in, s, _, _ := newPaidInteractor()
	_, mediaID := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); ok {
		t.Fatal("закрытое платное фото скачалось без покупки")
	}

	// фото профиля автора
	s.mu.Lock()
	s.avatars = map[int64][]int64{mediaID: {1}}
	s.mu.Unlock()
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); !ok {
		t.Fatal("фото профиля автора закрыто замком платного медиа")
	}
	// правило profile_photo, скрывающее фото, замок не обходит
	in.SetPrivacy(avatarPrivacy{deny: map[int64]bool{2: true}})
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); ok {
		t.Fatal("скрытое правилом фото профиля скачалось")
	}

	// бесплатно в чате с 3 — 3 качает, хотя в платном чате тот же файл
	chat3, err := in.CreatePrivateChat(ctx, 1, 3)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: chat3, SenderID: 1, Type: "photo", MediaID: &mediaID, ClientMsgID: "free"}); err != nil {
		t.Fatalf("Send free photo: %v", err)
	}
	if ok, _ := in.CanAccessMedia(ctx, 3, mediaID); !ok {
		t.Fatal("бесплатное фото закрыто замком того же файла в чужом платном сообщении")
	}
	if ok, _ := in.CanAccessMedia(ctx, 2, mediaID); ok {
		t.Fatal("получатель платного открыл файл через чужой бесплатный чат")
	}
}

// getFile бота упирается в тот же замок, что скачивание: бот-участник чата без
// покупки платное медиа не получает, после покупки — получает (побочный эффект
// переноса замка в MediaAccessRepo.CanAccess, контрольное ревью p0-fix-4).
func TestPaidMedia_BotFileInfoLockedUntilUnlock(t *testing.T) {
	in, s, _, _ := newPaidInteractor()
	msgID, mediaID := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()
	bot := domain.BotAccount{BotID: 2}
	if _, err := in.BotFileInfo(ctx, bot, mediaID); err != domain.ErrForbidden {
		t.Fatalf("бот-участник без покупки: err=%v, want ErrForbidden", err)
	}
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	if _, _, err := in.UnlockPaidMedia(ctx, msgID, 2); err != nil {
		t.Fatal(err)
	}
	if got, err := in.BotFileInfo(ctx, bot, mediaID); err != nil || got != mediaID {
		t.Fatalf("после покупки: %d, %v", got, err)
	}
}

// Лента отложенных и кадр updateNewScheduledMessage глазами автора отложенной
// пересылки платного: не купил — заглушка (messageExtendedMediaPreview, без
// media_id), купил — само медиа. Предложение — в params.fwd (контрольное
// ревью p0-fix-4 №3, п. 3).
func TestPaidMedia_ScheduledForwardWireLocked(t *testing.T) {
	in, s, _, _ := newPaidInteractor()
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	msgID, _ := sendPaidPhoto(t, in, s, 20)
	ctx := context.Background()
	src, _ := in.msgs.GetByID(ctx, msgID)
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src.ChatID, ToChatID: src.ChatID, MsgIDs: []int64{msgID}, SenderID: 2, ScheduleDate: future()}); err != nil {
		t.Fatalf("отложенная пересылка: %v", err)
	}
	paidOf := func(m domain.MessageReal) (domain.MessageMediaPaidMedia, bool) {
		switch pm := m.Media.(type) {
		case *domain.MessageMediaPaidMedia:
			return *pm, true
		case domain.MessageMediaPaidMedia:
			return pm, true
		}
		return domain.MessageMediaPaidMedia{}, false
	}
	isPreview := func(pm domain.MessageMediaPaidMedia) bool {
		return len(pm.ExtendedMedia) == 1 && pm.ExtendedMedia[0].Tag() == domain.MessageExtendedMediaPreviewTag
	}

	list, err := in.ListScheduled(ctx, src.ChatID, 2)
	if err != nil || len(list) != 1 {
		t.Fatalf("лента: %v %d", err, len(list))
	}
	pm, ok := paidOf(list[0])
	if !ok || !isPreview(pm) || pm.StarsAmount != 20 {
		t.Fatalf("лента отложенных открыла платное без покупки: %#v", list[0].Media)
	}
	rows := fs.sorted(func(domain.ScheduledMessage) bool { return true })
	upd, err := in.ScheduledUpdates(ctx, src.ChatID, 2, []int64{rows[0].ID})
	if err != nil || len(upd) != 1 {
		t.Fatalf("кадр: %v %d", err, len(upd))
	}
	frame := upd[0].(domain.UpdateNewScheduledMessage).Message.(domain.MessageReal)
	if pm, ok := paidOf(frame); !ok || !isPreview(pm) {
		t.Fatalf("updateNewScheduledMessage открыл платное без покупки: %#v", frame.Media)
	}

	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	if _, _, err := in.UnlockPaidMedia(ctx, msgID, 2); err != nil {
		t.Fatal(err)
	}
	list, _ = in.ListScheduled(ctx, src.ChatID, 2)
	if pm, ok := paidOf(list[0]); !ok || isPreview(pm) {
		t.Fatalf("купившему лента отдаёт заглушку: %#v", list[0].Media)
	}
}
