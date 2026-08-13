package chat

import (
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func pageFixture(ids ...int64) []domain.Dialog {
	out := make([]domain.Dialog, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.Dialog{ChatID: id})
	}
	return out
}

func chatIDs(ds []domain.Dialog) []int64 {
	out := make([]int64, 0, len(ds))
	for _, d := range ds {
		out = append(out, d.ChatID)
	}
	return out
}

func eq(t *testing.T, got, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestSliceDialogPage(t *testing.T) {
	all := pageFixture(10, 20, 30, 40, 50)

	t.Run("без лимита — весь список и конец", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 || !r.IsEnd {
			t.Fatalf("count=%d isEnd=%v", r.Count, r.IsEnd)
		}
	})

	t.Run("первая страница", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
		if r.Count != 5 || r.IsEnd {
			t.Fatalf("count=%d isEnd=%v", r.Count, r.IsEnd)
		}
	})

	t.Run("страница по курсору", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{30, 40})
		if r.IsEnd {
			t.Fatal("не конец")
		}
	})

	t.Run("последняя страница помечена концом в том же ответе", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{40, 50})
		if !r.IsEnd {
			t.Fatal("должен быть конец: остатка нет")
		}
	})

	t.Run("курсор на последнем — пустая страница и конец", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 50})
		if len(r.Dialogs) != 0 || !r.IsEnd || r.Count != 5 {
			t.Fatalf("%v count=%d isEnd=%v", chatIDs(r.Dialogs), r.Count, r.IsEnd)
		}
	})

	t.Run("неизвестный курсор — с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 999})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
	})

	t.Run("лимит больше остатка", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 100})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if !r.IsEnd {
			t.Fatal("должен быть конец")
		}
	})

	t.Run("count не зависит от лимита и курсора", func(t *testing.T) {
		for _, p := range []domain.DialogPage{{}, {Limit: 1}, {Limit: 1, OffsetChatID: 30}, {Limit: 1, OffsetChatID: 999}} {
			if got := sliceDialogPage(all, p).Count; got != 5 {
				t.Fatalf("%+v: count=%d", p, got)
			}
		}
	})

	t.Run("пустой список", func(t *testing.T) {
		r := sliceDialogPage(nil, domain.DialogPage{Limit: 10})
		if len(r.Dialogs) != 0 || r.Count != 0 || !r.IsEnd {
			t.Fatalf("%v count=%d isEnd=%v", chatIDs(r.Dialogs), r.Count, r.IsEnd)
		}
	})

	t.Run("проход курсором собирает весь список без дублей и пропусков", func(t *testing.T) {
		var got []int64
		var cursor int64
		for {
			r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: cursor})
			got = append(got, chatIDs(r.Dialogs)...)
			if r.IsEnd {
				break
			}
			cursor = r.Dialogs[len(r.Dialogs)-1].ChatID
		}
		eq(t, got, []int64{10, 20, 30, 40, 50})
	})
}
