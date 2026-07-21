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

// Черновик несёт rich-text entities (санитизация как у сообщений) и reply_to_id
// (мягкая валидация: сообщение должно существовать в этом же чате, иначе NULL).
func TestDrafts_EntitiesAndReply(t *testing.T) {
	in, _ := newInteractor()
	drafts := newFakeDrafts()
	pub := &fakePublisher{}
	in.SetDrafts(drafts)
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	otherChat, _ := in.CreatePrivateChat(ctx, a, 3)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "target", ClientMsgID: "t1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	foreign, _ := in.Send(ctx, SendInput{ChatID: otherChat, SenderID: a, Text: "foreign", ClientMsgID: "t2"})

	// Entities: опасный text_link и отрицательный offset выкидываются, валидное — остаётся.
	ents := []domain.MessageEntity{
		{Type: "bold", Offset: 0, Length: 4},
		{Type: "text_link", Offset: 0, Length: 4, URL: "javascript:alert(1)"},
		{Type: "italic", Offset: -1, Length: 2},
	}
	d, err := in.SaveDraft(ctx, a, chatID, "жирный", ents, &msg.ID)
	if err != nil || d == nil {
		t.Fatalf("SaveDraft: %v %+v", err, d)
	}
	if len(d.Entities) != 1 || d.Entities[0].Type != "bold" {
		t.Fatalf("entities must be sanitized: %+v", d.Entities)
	}
	if d.ReplyToID == nil || *d.ReplyToID != msg.ID {
		t.Fatalf("valid reply must be kept: %+v", d.ReplyToID)
	}

	// Отдача: MyDrafts возвращает entities и reply_to_id как сохранили.
	list, _ := in.MyDrafts(ctx, a)
	if len(list) != 1 || len(list[0].Entities) != 1 || list[0].ReplyToID == nil || *list[0].ReplyToID != msg.ID {
		t.Fatalf("MyDrafts must carry entities+reply: %+v", list)
	}

	// draft_update-кадр несёт entities и reply_to_id.
	frames := draftFramesFor(pub, a)
	last, _ := frames[len(frames)-1]["draft"].(map[string]any)
	if last == nil || last["reply_to_id"] == nil || last["entities"] == nil {
		t.Fatalf("draft_update must carry entities+reply_to_id: %+v", last)
	}

	// Reply на сообщение из другого чата → NULL (черновик сохраняется).
	if d, err = in.SaveDraft(ctx, a, chatID, "x", nil, &foreign.ID); err != nil || d == nil || d.ReplyToID != nil {
		t.Fatalf("foreign reply must be nulled: %v %+v", err, d)
	}
	// Reply на несуществующее сообщение → NULL.
	missing := int64(999999)
	if d, err = in.SaveDraft(ctx, a, chatID, "y", nil, &missing); err != nil || d == nil || d.ReplyToID != nil {
		t.Fatalf("missing reply must be nulled: %v %+v", err, d)
	}
	// Пустой текст + невалидный reply → это удаление черновика.
	if d, err = in.SaveDraft(ctx, a, chatID, "", nil, &missing); err != nil || d != nil {
		t.Fatalf("empty text with invalid reply must delete: %v %+v", err, d)
	}
	if list, _ := in.MyDrafts(ctx, a); len(list) != 0 {
		t.Fatalf("draft must be gone: %+v", list)
	}
}
