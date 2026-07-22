package chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeChecklists — in-memory ChecklistRepo.
type fakeChecklists struct {
	mu    sync.Mutex
	next  int64
	lists map[int64]domain.Checklist
	marks map[int64]map[int]map[int64]bool // checklistID -> itemID -> userID -> marked
}

func newFakeChecklists() *fakeChecklists {
	return &fakeChecklists{lists: map[int64]domain.Checklist{}, marks: map[int64]map[int]map[int64]bool{}}
}

func (f *fakeChecklists) Create(_ context.Context, c domain.Checklist) (domain.Checklist, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	c.ID = f.next
	f.lists[c.ID] = c
	return c, nil
}

func (f *fakeChecklists) ByID(_ context.Context, id int64) (domain.Checklist, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.lists[id]
	if !ok {
		return domain.Checklist{}, domain.ErrNotFound
	}
	return c, nil
}

func (f *fakeChecklists) SetItems(_ context.Context, checklistID int64, items []domain.ChecklistItem) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.lists[checklistID]
	c.Items = items
	f.lists[checklistID] = c
	return nil
}

func (f *fakeChecklists) ToggleMark(_ context.Context, checklistID int64, itemID int, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.marks[checklistID] == nil {
		f.marks[checklistID] = map[int]map[int64]bool{}
	}
	if f.marks[checklistID][itemID] == nil {
		f.marks[checklistID][itemID] = map[int64]bool{}
	}
	if f.marks[checklistID][itemID][userID] {
		delete(f.marks[checklistID][itemID], userID)
		return false, nil
	}
	f.marks[checklistID][itemID][userID] = true
	return true, nil
}

func (f *fakeChecklists) Info(_ context.Context, checklistID int64) (domain.ChecklistInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.lists[checklistID]
	if !ok {
		return domain.ChecklistInfo{}, domain.ErrNotFound
	}
	info := domain.ChecklistInfo{
		ID: c.ID, Title: c.Title, OthersCanAdd: c.OthersCanAdd, OthersCanMark: c.OthersCanMark,
		Items: make([]domain.ChecklistItemInfo, 0, len(c.Items)),
	}
	for _, it := range c.Items {
		by := []int64{}
		for uid := range f.marks[checklistID][it.ID] {
			by = append(by, uid)
		}
		info.Items = append(info.Items, domain.ChecklistItemInfo{ID: it.ID, Text: it.Text, MarkedBy: by})
	}
	return info, nil
}

func markedBy(info domain.ChecklistInfo, itemID int) int {
	for _, it := range info.Items {
		if it.ID == itemID {
			return len(it.MarkedBy)
		}
	}
	return -1
}

func TestChecklist_ToggleAndAdd_Rules(t *testing.T) {
	fg := newFakeGroupRepo()
	fg.members[1] = map[int64]domain.Member{
		10: {ChatID: 1, UserID: 10, Role: "creator"}, // автор чек-листа
		11: {ChatID: 1, UserID: 11, Role: "member"},
	}
	s := newStore()
	fc := newFakeChecklists()
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, nil, nil, nil, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	in.SetChecklists(fc)
	ctx := context.Background()

	// чек-лист «только автор»: seed сущности + сообщение-владелец (автор = 10)
	strict, _ := fc.Create(ctx, domain.Checklist{
		ChatID: 1, Title: "todo", Items: []domain.ChecklistItem{{ID: 1, Text: "a"}, {ID: 2, Text: "b"}},
	})
	clID := strict.ID
	s.messages[1] = append(s.messages[1], domain.Message{ID: 1, ChatID: 1, SenderID: 10, Type: "checklist", ChecklistID: &clID})

	// автор отмечает пункт
	info, err := in.ToggleChecklistItem(ctx, clID, 1, 10)
	if err != nil || markedBy(info, 1) != 1 {
		t.Fatalf("author mark: %v %+v", err, info)
	}
	// повторный тоггл автором снимает отметку
	if info, err = in.ToggleChecklistItem(ctx, clID, 1, 10); err != nil || markedBy(info, 1) != 0 {
		t.Fatalf("author unmark: %v %+v", err, info)
	}
	// другой участник не может отмечать (others_can_mark=false)
	if _, err = in.ToggleChecklistItem(ctx, clID, 1, 11); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member mark on strict: want ErrForbidden, got %v", err)
	}
	// несуществующий пункт
	if _, err = in.ToggleChecklistItem(ctx, clID, 99, 10); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("bad item: want ErrNotFound, got %v", err)
	}
	// не участник чата
	if _, err = in.ToggleChecklistItem(ctx, clID, 1, 99); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-member toggle: want ErrNotFound, got %v", err)
	}
	// автор добавляет пункт → id продолжает максимальный (3)
	info, err = in.AddChecklistItems(ctx, clID, 10, []string{"c"})
	if err != nil || len(info.Items) != 3 || info.Items[2].ID != 3 || info.Items[2].Text != "c" {
		t.Fatalf("author add: %v %+v", err, info)
	}
	// другой участник не может добавлять (others_can_add=false)
	if _, err = in.AddChecklistItems(ctx, clID, 11, []string{"d"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member add on strict: want ErrForbidden, got %v", err)
	}

	// открытый чек-лист: другие могут отмечать и добавлять
	open, _ := fc.Create(ctx, domain.Checklist{
		ChatID: 1, Title: "shared", Items: []domain.ChecklistItem{{ID: 1, Text: "x"}},
		OthersCanAdd: true, OthersCanMark: true,
	})
	if info, err = in.ToggleChecklistItem(ctx, open.ID, 1, 11); err != nil || markedBy(info, 1) != 1 {
		t.Fatalf("member mark on open: %v %+v", err, info)
	}
	if info, err = in.AddChecklistItems(ctx, open.ID, 11, []string{"y"}); err != nil || len(info.Items) != 2 {
		t.Fatalf("member add on open: %v %+v", err, info)
	}
}
