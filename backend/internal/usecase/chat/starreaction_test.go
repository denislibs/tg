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
			User: domain.UserReal{ID: uid}, Stars: s, Anonymous: f.anon[messageID][uid],
		})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Stars > out[b].Stars })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func newStarReactionInteractor() (*Interactor, *store, *fakeStars, *fakeStarReactions, *fakePublisher) {
	in, s := newInteractor()
	fs := newFakeStars()
	sr := newFakeStarReactions()
	pub := &fakePublisher{}
	in.SetStars(fs)
	in.SetStarReactions(sr)
	in.SetPublisher(pub)
	return in, s, fs, sr, pub
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
	in, _, fs, _, _ := newStarReactionInteractor()
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
	in, _, _, _, _ := newStarReactionInteractor()
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
	in, _, _, _, _ := newStarReactionInteractor()
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

// Платная ⭐-реакция едет ТЕМ ЖЕ кадром, что и обычная: своего конструктора у
// неё в схеме нет — она второй конструктор объединения Reaction (reactionPaid)
// в том же векторе results. Значит кадр обязан нести агрегат ЦЕЛИКОМ: половина
// («только звёзды») утверждала бы, что эмодзи-чипов не существует, и стёрла бы
// их получателю.
func TestStarReaction_FrameIsMessageReactionsWithPaidChip(t *testing.T) {
	in, s, _, _, pub := newStarReactionInteractor()
	ctx := context.Background()
	chatID, msgID := seedStarReactionMsg(t, in)
	if _, err := in.TopUpStars(ctx, 2, 50); err != nil {
		t.Fatal(err)
	}
	// Обычная реакция ДО платной: именно её платный кадр не имеет права стереть.
	if err := in.React(ctx, chatID, msgID, 2, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}

	pub.reset()
	if _, _, _, err := in.SendStarReaction(ctx, chatID, msgID, 2, 10, false); err != nil {
		t.Fatalf("SendStarReaction: %v", err)
	}

	d := lastFrameOfType(t, pub, 1, "reaction")
	if d["_"] != domain.UpdateMessageReactionsTag {
		t.Fatalf("кадр = %v; ждали %s", d["_"], domain.UpdateMessageReactionsTag)
	}
	reactions, ok := d["reactions"].(map[string]any)
	if !ok {
		t.Fatalf("в кадре нет агрегата: %#v", d)
	}
	// Агрегат помечен min: пер-зрительской части (мой вклад звёздами) в общем
	// теле нет и быть не может — тело одно на всех получателей.
	if pf, _ := reactions["pFlags"].(map[string]any); pf["min"] != true {
		t.Fatalf("агрегат не помечен min: %#v", reactions["pFlags"])
	}
	if _, ok := reactions["top_reactors"]; ok {
		t.Fatal("в общем теле кадра поехала доска вкладов: она пер-зрительская")
	}
	var paid, emoji float64
	for _, e := range reactions["results"].([]any) {
		chip := e.(map[string]any)
		switch r := chip["reaction"].(map[string]any); r["_"] {
		case domain.ReactionPaidTag:
			paid = chip["count"].(float64)
		case domain.ReactionEmojiTag:
			if r["emoticon"] == "🔥" {
				emoji = chip["count"].(float64)
			}
		}
	}
	if paid != 10 || emoji != 1 {
		t.Fatalf("агрегат = платных %v, 🔥 %v; ждали 10 и 1 (обе половины сразу)", paid, emoji)
	}
	// Диффа платной реакции в кадре нет: «кто отправил» и «сколько отдал он» —
	// это ответ ручки отправителю, а не общее тело.
	for _, k := range []string{"sender_id", "total", "mine", "id"} {
		if _, ok := d[k]; ok {
			t.Fatalf("в кадре остался ключ старой формы %q: %#v", k, d)
		}
	}

	// Записи журнала своего типа у платной реакции больше нет: тип кадра не
	// различает платную и эмодзи, их различает конструктор ВНУТРИ агрегата.
	s.mu.Lock()
	ups := append([]domain.UpdateRecord(nil), s.updates[1]...)
	s.mu.Unlock()
	for _, u := range ups {
		if u.Type == "star_reaction" {
			t.Fatal("в журнале осталась запись типа star_reaction")
		}
	}
	var logged int
	for _, u := range ups {
		if u.Type == "reaction" {
			logged++
		}
	}
	// Две: эмодзи-реакция и платная — обе одним типом.
	if logged != 2 {
		t.Fatalf("записей типа reaction = %d; ждали 2", logged)
	}
}
