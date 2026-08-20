package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeSuggestedRepo — in-memory SuggestedPostRepo для usecase-тестов предложки.
type fakeSuggestedRepo struct {
	mu     sync.Mutex
	nextID int64
	rows   map[int64]domain.SuggestedPost
}

func newFakeSuggestedRepo() *fakeSuggestedRepo {
	return &fakeSuggestedRepo{rows: map[int64]domain.SuggestedPost{}}
}

func (r *fakeSuggestedRepo) Create(_ context.Context, sp domain.SuggestedPost) (domain.SuggestedPost, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	sp.ID = r.nextID
	if sp.Status == "" {
		sp.Status = "pending"
	}
	sp.CreatedAt = time.Now()
	r.rows[sp.ID] = sp
	return sp, nil
}

func (r *fakeSuggestedRepo) ByID(_ context.Context, id int64) (domain.SuggestedPost, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sp, ok := r.rows[id]
	if !ok {
		return domain.SuggestedPost{}, domain.ErrNotFound
	}
	return sp, nil
}

func (r *fakeSuggestedRepo) filter(pred func(domain.SuggestedPost) bool) []domain.SuggestedPost {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.SuggestedPost, 0)
	for _, sp := range r.rows {
		if pred(sp) {
			out = append(out, sp)
		}
	}
	return out
}

func (r *fakeSuggestedRepo) ListPending(_ context.Context, chatID int64) ([]domain.SuggestedPost, error) {
	return r.filter(func(sp domain.SuggestedPost) bool {
		return sp.ChatID == chatID && sp.Status == "pending"
	}), nil
}

func (r *fakeSuggestedRepo) ListByAuthor(_ context.Context, chatID, authorID int64) ([]domain.SuggestedPost, error) {
	return r.filter(func(sp domain.SuggestedPost) bool {
		return sp.ChatID == chatID && sp.AuthorID == authorID
	}), nil
}

func (r *fakeSuggestedRepo) Decide(_ context.Context, id int64, status string, decidedBy int64, publishAt *time.Time) (domain.SuggestedPost, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sp, ok := r.rows[id]
	if !ok || sp.Status != "pending" {
		return domain.SuggestedPost{}, domain.ErrNotFound
	}
	sp.Status = status
	sp.DecidedBy = &decidedBy
	now := time.Now()
	sp.DecidedAt = &now
	sp.PublishAt = publishAt
	r.rows[id] = sp
	return sp, nil
}

func (r *fakeSuggestedRepo) MarkPublished(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	sp := r.rows[id]
	sp.PublishAt = nil
	r.rows[id] = sp
	return nil
}

func (r *fakeSuggestedRepo) DuePublish(_ context.Context, now time.Time, _ int) ([]domain.SuggestedPost, error) {
	return r.filter(func(sp domain.SuggestedPost) bool {
		return sp.Status == "approved" && sp.PublishAt != nil && !sp.PublishAt.After(now)
	}), nil
}

// newSuggestTestInteractor — channel-интерактор + подключённая предложка и publisher.
func newSuggestTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeSuggestedRepo, *fakeChannelPublisher, *fakePublisher) {
	t.Helper()
	in, fg, _, fpub := newChannelTestInteractor(t)
	sr := newFakeSuggestedRepo()
	in.SetSuggestedPosts(sr)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	return in, fg, sr, fpub, pub
}

func TestSuggestPost_OnlyNonAdminMember(t *testing.T) {
	in, fg, sr, _, pub := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true) // 7 — creator
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)  // 8 — подписчик

	// не участник — нельзя
	if _, err := in.SuggestPost(ctx, id, 9, "hi", nil, nil, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-member suggest = %v, want forbidden", err)
	}
	// админ (creator) постит напрямую — предлагать нельзя
	if _, err := in.SuggestPost(ctx, id, 7, "hi", nil, nil, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("creator suggest = %v, want forbidden", err)
	}
	// пустой пост без медиа — invalid
	if _, err := in.SuggestPost(ctx, id, 8, "  ", nil, nil, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("empty suggest = %v, want invalid", err)
	}
	// подписчик предлагает → pending, админ получает фрейм
	info, err := in.SuggestPost(ctx, id, 8, "please publish", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if info.Status != "pending" {
		t.Fatalf("status=%q, want pending", info.Status)
	}
	if len(sr.rows) != 1 {
		t.Fatalf("rows=%d, want 1", len(sr.rows))
	}
	if pub.countFor(7) == 0 {
		t.Fatal("admin (7) did not receive suggested_post_update frame")
	}
}

func TestApproveSuggestedPost_PublishesNow(t *testing.T) {
	in, fg, _, fpub, pub := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	info, _ := in.SuggestPost(ctx, id, 8, "hello", nil, nil, nil)

	// подписчик не может одобрять
	if _, err := in.ApproveSuggestedPost(ctx, info.ID, 8, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber approve = %v, want forbidden", err)
	}
	pub.reset()
	// creator одобряет без времени → публикуется в канал немедленно
	got, err := in.ApproveSuggestedPost(ctx, info.ID, 7, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "approved" {
		t.Fatalf("status=%q, want approved", got.Status)
	}
	if fpub.count != 1 {
		t.Fatalf("channel publishes=%d, want 1", fpub.count)
	}
	// автор получил статус-фрейм
	if pub.countFor(8) == 0 {
		t.Fatal("author (8) did not receive status frame")
	}
	// повторное решение уже решённого — invalid
	if _, err := in.ApproveSuggestedPost(ctx, info.ID, 7, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("re-approve = %v, want invalid", err)
	}
}

func TestApproveSuggestedPost_Deferred_WorkerPublishes(t *testing.T) {
	in, fg, sr, fpub, _ := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	info, _ := in.SuggestPost(ctx, id, 8, "later", nil, nil, nil)

	future := time.Now().Add(time.Hour)
	if _, err := in.ApproveSuggestedPost(ctx, info.ID, 7, &future); err != nil {
		t.Fatal(err)
	}
	// отложено — сейчас не публикуется
	if fpub.count != 0 {
		t.Fatalf("channel publishes=%d, want 0 (deferred)", fpub.count)
	}
	// сдвигаем время в прошлое и гоняем воркер
	past := time.Now().Add(-time.Minute)
	sr.mu.Lock()
	sp := sr.rows[info.ID]
	sp.PublishAt = &past
	sr.rows[info.ID] = sp
	sr.mu.Unlock()

	n, err := in.DispatchDueSuggestedPosts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 || fpub.count != 1 {
		t.Fatalf("dispatched=%d publishes=%d, want 1/1", n, fpub.count)
	}
	// publish_at сброшен — повторно не публикуется
	if _, err := in.DispatchDueSuggestedPosts(ctx); err != nil {
		t.Fatal(err)
	}
	if fpub.count != 1 {
		t.Fatalf("re-dispatch publishes=%d, want 1", fpub.count)
	}
}

func TestRejectSuggestedPost(t *testing.T) {
	in, fg, _, fpub, _ := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	info, _ := in.SuggestPost(ctx, id, 8, "nope", nil, nil, nil)

	got, err := in.RejectSuggestedPost(ctx, info.ID, 7)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "rejected" {
		t.Fatalf("status=%q, want rejected", got.Status)
	}
	if fpub.count != 0 {
		t.Fatalf("rejected post must not publish, count=%d", fpub.count)
	}
}

func TestListSuggestedPosts_AdminVsAuthor(t *testing.T) {
	in, fg, _, _, _ := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, id, 9, domain.RoleSubscriber, 0)
	_, _ = in.SuggestPost(ctx, id, 8, "from 8", nil, nil, nil)
	_, _ = in.SuggestPost(ctx, id, 9, "from 9", nil, nil, nil)

	// админ видит все pending
	all, err := in.ListSuggestedPosts(ctx, id, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("admin sees %d, want 2", len(all))
	}
	// автор видит только свои
	mine, err := in.ListSuggestedPosts(ctx, id, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 1 || mine[0].AuthorID != 8 {
		t.Fatalf("author list = %+v, want 1 own", mine)
	}
}

// Решение по предложке уезжает автору СЛУЖЕБНЫМ сообщением, а не текстом.
//
// Дефект, который держит этот тест, был живым: notifyAuthorDecision слал
// JSON-действие через PostServiceMessage, а тот зовёт Send БЕЗ типа — то есть
// подставлялся дефолт "text". Клиент включает разбор действия по ВИДУ
// сообщения, поэтому автор видел в чате сырой `{"action":"suggest_post_...`.
//
// Корень путаницы — имя: «service» в PostServiceMessage означает аккаунт-
// отправитель, а не вид сообщения. Поэтому проверяем ОБА пути: действие едет
// как service, а человекочитаемое уведомление (вход в аккаунт) — как text.
func TestSuggestedDecision_GoesAsServiceMessage(t *testing.T) {
	in, fg, _, _, _ := newSuggestTestInteractor(t)
	ctx := context.Background()
	id, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	info, _ := in.SuggestPost(ctx, id, 8, "hello", nil, nil, nil)

	if _, err := in.ApproveSuggestedPost(ctx, info.ID, 7, nil); err != nil {
		t.Fatal(err)
	}

	msg, ok := findServiceAccountMessage(t, in, 8)
	if !ok {
		t.Fatal("автор не получил сообщения из чата с сервисным аккаунтом")
	}
	// Решение по предложке — ДЕЙСТВИЕ, а не текст: прежде оно уезжало обычным
	// текстовым сообщением, и автор видел сырой JSON.
	approval, ok := msg.Action.(domain.MessageActionSuggestedPostApproval)
	if !ok {
		t.Fatalf("действие = %#v, want messageActionSuggestedPostApproval", msg.Action)
	}
	// Одобрено: pFlags.rejected нет ВОВСЕ, а не false.
	if approval.PFlags["rejected"] {
		t.Fatalf("одобренная предложка помечена отказом: %#v", approval)
	}
	if msg.Text != "" {
		t.Fatalf("текст = %q, у служебного сообщения текста нет", msg.Text)
	}
	// Канал назван ССЫЛКОЙ. Без неё фраза вырождается в «ваш пост одобрен» без
	// ответа на вопрос «где»: у оригинала канал это peer_id пилюли, а у нас она
	// приходит в чат с сервисным аккаунтом. Имя соберёт клиент из карточки —
	// строкой название не едет (урок дефекта «Пользователь добавил(а)…»).
	if want := int64(domain.ToPeerID(id, true)); approval.ChannelID != want {
		t.Fatalf("канал в действии = %d, want %d", approval.ChannelID, want)
	}

	// Обратная сторона: обычное уведомление остаётся ТЕКСТОМ.
	if err := in.PostServiceMessage(ctx, 8, "Новый вход в аккаунт"); err != nil {
		t.Fatal(err)
	}
	last, _ := findServiceAccountMessage(t, in, 8)
	if last.Type != "text" {
		t.Fatalf("уведомление о входе = %q, want \"text\": его читает человек, а не разборщик действий", last.Type)
	}
}

// findServiceAccountMessage — последнее сообщение в приватном чате userID с
// сервисным аккаунтом.
func findServiceAccountMessage(t *testing.T, in *Interactor, userID int64) (domain.Message, bool) {
	t.Helper()
	chatID, err := in.chats.FindPrivate(context.Background(), userID, domain.ServiceUserID)
	if err != nil {
		return domain.Message{}, false
	}
	msgs, err := in.msgs.GetHistory(context.Background(), chatID, userID, 0, 0, 50, nil, 0, "")
	if err != nil || len(msgs) == 0 {
		return domain.Message{}, false
	}
	return msgs[0], true
}
