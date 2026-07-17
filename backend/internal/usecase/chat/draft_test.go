package chat

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeDrafts — in-memory chat.DraftRepo.
type fakeDrafts struct {
	mu sync.Mutex
	m  map[[2]int64]domain.Draft // {chatID,userID}
}

func newFakeDrafts() *fakeDrafts { return &fakeDrafts{m: map[[2]int64]domain.Draft{}} }

func (f *fakeDrafts) Upsert(_ context.Context, userID int64, d domain.Draft) (domain.Draft, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d.UpdatedAt = time.Now()
	f.m[[2]int64{d.ChatID, userID}] = d
	return d, nil
}

func (f *fakeDrafts) Delete(_ context.Context, chatID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := [2]int64{chatID, userID}
	if _, ok := f.m[k]; !ok {
		return false, nil
	}
	delete(f.m, k)
	return true, nil
}

func (f *fakeDrafts) ListByUser(_ context.Context, userID int64) ([]domain.Draft, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.Draft
	for k, d := range f.m {
		if k[1] == userID {
			out = append(out, d)
		}
	}
	return out, nil
}

func (f *fakeDrafts) DeleteAllByUser(_ context.Context, userID int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []int64
	for k := range f.m {
		if k[1] == userID {
			out = append(out, k[0])
			delete(f.m, k)
		}
	}
	return out, nil
}

func draftFramesFor(p *fakePublisher, userID int64) []map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []map[string]any
	for _, f := range p.frames {
		if f.userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if json.Unmarshal(f.frame, &env) == nil && env.T == "draft_update" {
			out = append(out, env.D)
		}
	}
	return out
}

func TestDrafts_SaveListClearAndSendClears(t *testing.T) {
	in, _ := newInteractor()
	drafts := newFakeDrafts()
	pub := &fakePublisher{}
	in.SetDrafts(drafts)
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	// Сохранение → черновик в списке + draft_update владельцу.
	d, err := in.SaveDraft(ctx, a, chatID, "черновик", nil, nil)
	if err != nil || d == nil || d.Text != "черновик" {
		t.Fatalf("SaveDraft: %v %+v", err, d)
	}
	list, _ := in.MyDrafts(ctx, a)
	if len(list) != 1 || list[0].ChatID != chatID {
		t.Fatalf("MyDrafts: %+v", list)
	}
	if got := draftFramesFor(pub, a); len(got) != 1 || got[0]["draft"] == nil {
		t.Fatalf("draft_update frames: %+v", got)
	}
	if got := draftFramesFor(pub, b); len(got) != 0 {
		t.Fatalf("peer must not receive draft_update: %+v", got)
	}

	// Не участник чата — ErrNotFound.
	if _, err := in.SaveDraft(ctx, 99, chatID, "x", nil, nil); err != domain.ErrNotFound {
		t.Fatalf("outsider SaveDraft: %v", err)
	}

	// Пустой текст без reply → удаление + draft_update null.
	if d, err := in.SaveDraft(ctx, a, chatID, "", nil, nil); err != nil || d != nil {
		t.Fatalf("empty SaveDraft: %v %+v", err, d)
	}
	if list, _ := in.MyDrafts(ctx, a); len(list) != 0 {
		t.Fatalf("draft must be deleted: %+v", list)
	}
	frames := draftFramesFor(pub, a)
	if len(frames) != 2 || frames[1]["draft"] != nil {
		t.Fatalf("expected null draft_update: %+v", frames)
	}

	// Отправка сообщения снимает черновик.
	_, _ = in.SaveDraft(ctx, a, chatID, "again", nil, nil)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "d1"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if list, _ := in.MyDrafts(ctx, a); len(list) != 0 {
		t.Fatalf("Send must clear the draft: %+v", list)
	}

	// ClearAllDrafts чистит все и шлёт null-апдейты.
	chat2, _ := in.CreatePrivateChat(ctx, a, 3)
	_, _ = in.SaveDraft(ctx, a, chatID, "one", nil, nil)
	_, _ = in.SaveDraft(ctx, a, chat2, "two", nil, nil)
	pub.reset()
	if err := in.ClearAllDrafts(ctx, a); err != nil {
		t.Fatalf("ClearAllDrafts: %v", err)
	}
	if list, _ := in.MyDrafts(ctx, a); len(list) != 0 {
		t.Fatalf("all drafts must be gone: %+v", list)
	}
	if got := draftFramesFor(pub, a); len(got) != 2 {
		t.Fatalf("expected 2 null updates: %+v", got)
	}
}
