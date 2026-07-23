package chat

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeSavedTags — in-memory SavedTagRepo: имена в мапе, список/счётчики берём из
// реакций стора по сообщениям самочата (как реальный репозиторий из reactions).
type fakeSavedTags struct {
	s      *store
	titles map[int64]map[string]string // userID -> reaction -> title
}

func (r *fakeSavedTags) ListWithCounts(_ context.Context, userID, savedChatID int64) ([]domain.SavedTag, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	counts := map[string]int{}
	for _, m := range r.s.messages[savedChatID] {
		if m.Deleted {
			continue
		}
		for e := range r.s.reactions[m.ID][userID] {
			counts[e]++
		}
	}
	out := make([]domain.SavedTag, 0, len(counts))
	for e, c := range counts {
		out = append(out, domain.SavedTag{Reaction: e, Title: r.titles[userID][e], Count: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Reaction < out[j].Reaction
	})
	return out, nil
}

func (r *fakeSavedTags) SetTitle(_ context.Context, userID int64, reaction, title string) error {
	if r.titles == nil {
		r.titles = map[int64]map[string]string{}
	}
	if r.titles[userID] == nil {
		r.titles[userID] = map[string]string{}
	}
	if title == "" {
		delete(r.titles[userID], reaction)
		return nil
	}
	r.titles[userID][reaction] = title
	return nil
}

// TestSavedTags покрывает пометку тегом (реакция в самочате), список с
// именами/счётчиками, переименование/сброс имени и фильтр истории по тегу.
func TestSavedTags(t *testing.T) {
	in, s := newInteractor()
	in.SetSavedTags(&fakeSavedTags{s: s})
	ctx := context.Background()
	const a int64 = 1

	savedID, err := in.GetOrCreateSaved(ctx, a)
	if err != nil {
		t.Fatalf("GetOrCreateSaved: %v", err)
	}
	var ids []int64
	for i := 0; i < 3; i++ {
		m, e := in.Send(ctx, SendInput{ChatID: savedID, SenderID: a, Text: "note"})
		if e != nil {
			t.Fatalf("Send: %v", e)
		}
		ids = append(ids, m.ID)
	}
	// Помечаем: два сообщения тегом 👍, одно — ❤️ (реакции на самочат).
	for _, id := range ids[:2] {
		if e := in.React(ctx, savedID, id, a, "👍", true); e != nil {
			t.Fatalf("React 👍: %v", e)
		}
	}
	if e := in.React(ctx, savedID, ids[2], a, "❤️", true); e != nil {
		t.Fatalf("React ❤️: %v", e)
	}

	// Список тегов: самый частый первым, имён пока нет.
	tags, err := in.SavedTags(ctx, a)
	if err != nil {
		t.Fatalf("SavedTags: %v", err)
	}
	if len(tags) != 2 || tags[0].Reaction != "👍" || tags[0].Count != 2 || tags[1].Reaction != "❤️" || tags[1].Count != 1 {
		t.Fatalf("tags = %+v", tags)
	}
	if tags[0].Title != "" {
		t.Fatalf("expected no title, got %q", tags[0].Title)
	}

	// Задаём имя тега 👍.
	if err := in.SetSavedTagName(ctx, a, "👍", "Работа"); err != nil {
		t.Fatalf("SetSavedTagName: %v", err)
	}
	tags, _ = in.SavedTags(ctx, a)
	if tags[0].Reaction != "👍" || tags[0].Title != "Работа" {
		t.Fatalf("after name: %+v", tags)
	}

	// Сброс имени (пустой title удаляет).
	if err := in.SetSavedTagName(ctx, a, "👍", ""); err != nil {
		t.Fatalf("clear name: %v", err)
	}
	tags, _ = in.SavedTags(ctx, a)
	if tags[0].Title != "" {
		t.Fatalf("name not cleared: %+v", tags)
	}

	// Слишком длинное имя (>12 рун) → ErrTooLong; пустая реакция → ErrBadReaction.
	if err := in.SetSavedTagName(ctx, a, "👍", "0123456789012"); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("expected ErrTooLong, got %v", err)
	}
	if err := in.SetSavedTagName(ctx, a, "", "x"); !errors.Is(err, domain.ErrBadReaction) {
		t.Fatalf("expected ErrBadReaction, got %v", err)
	}

	// Фильтр истории по тегу: 👍 → два сообщения, ❤️ → одно.
	res, err := in.GetHistory(ctx, savedID, a, 0, 0, 40, nil, "👍")
	if err != nil {
		t.Fatalf("GetHistory tag 👍: %v", err)
	}
	if len(res.Messages) != 2 || res.Count != 2 {
		t.Fatalf("filter 👍 = %d msgs (count %d), want 2", len(res.Messages), res.Count)
	}
	res, _ = in.GetHistory(ctx, savedID, a, 0, 0, 40, nil, "❤️")
	if len(res.Messages) != 1 {
		t.Fatalf("filter ❤️ = %d msgs, want 1", len(res.Messages))
	}
	// Без фильтра — все три.
	res, _ = in.GetHistory(ctx, savedID, a, 0, 0, 40, nil, "")
	if len(res.Messages) != 3 {
		t.Fatalf("no filter = %d msgs, want 3", len(res.Messages))
	}
}
