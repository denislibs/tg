package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func pageFixture(ids ...int64) []domain.DialogRecord {
	out := make([]domain.DialogRecord, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.DialogRecord{ChatID: id})
	}
	return out
}

func chatIDs(ds []domain.DialogRecord) []int64 {
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

	t.Run("без лимита — весь список отдан целиком", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 || !r.Whole {
			t.Fatalf("count=%d whole=%v", r.Count, r.Whole)
		}
	})

	t.Run("первая страница — кусок, а не весь набор", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
		if r.Count != 5 || r.Whole {
			t.Fatalf("count=%d whole=%v", r.Count, r.Whole)
		}
	})

	t.Run("страница по курсору", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{30, 40})
		if r.Whole {
			t.Fatal("страница с середины — не весь набор")
		}
	})

	// Хвост набора, дочитанный курсором, — по-прежнему КУСОК: count в нём
	// обязателен, иначе клиент решит, что весь список у него уже есть
	// (tweb: isEnd = !count || dialogsLength >= count). Прежний is_end на этом
	// месте говорил «конец» и тем самым терял размер набора.
	t.Run("хвост набора по курсору — всё ещё кусок", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{40, 50})
		if r.Whole || r.Count != 5 {
			t.Fatalf("whole=%v count=%d, want false 5", r.Whole, r.Count)
		}
	})

	t.Run("курсор на последнем — пустая страница с размером набора", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 50})
		if len(r.Dialogs) != 0 || r.Whole || r.Count != 5 {
			t.Fatalf("%v count=%d whole=%v", chatIDs(r.Dialogs), r.Count, r.Whole)
		}
	})

	t.Run("неизвестный курсор — с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 999})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
	})

	t.Run("лимит больше набора — набор отдан целиком", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 100})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if !r.Whole {
			t.Fatal("весь набор влез в страницу — это messages.dialogs")
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
		if len(r.Dialogs) != 0 || r.Count != 0 || !r.Whole {
			t.Fatalf("%v count=%d whole=%v", chatIDs(r.Dialogs), r.Count, r.Whole)
		}
	})

	t.Run("проход курсором собирает весь список без дублей и пропусков", func(t *testing.T) {
		var got []int64
		var cursor int64
		for {
			r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: cursor})
			got = append(got, chatIDs(r.Dialogs)...)
			// Конец выводит КЛИЕНТ по размеру набора — ровно как оригинал:
			// isEnd = !count || собрано >= count || страница пуста.
			if r.Count == 0 || len(got) >= r.Count || len(r.Dialogs) == 0 {
				break
			}
			cursor = r.Dialogs[len(r.Dialogs)-1].ChatID
		}
		eq(t, got, []int64{10, 20, 30, 40, 50})
	})
}

// archivedFixture — набор со смешанными архивными: 10,30,50 в архиве.
func archivedFixture() []domain.DialogRecord {
	return []domain.DialogRecord{
		{ChatID: 10, Folder: domain.FolderArchive},
		{ChatID: 20},
		{ChatID: 30, Folder: domain.FolderArchive},
		{ChatID: 40},
		{ChatID: 50, Folder: domain.FolderArchive},
	}
}

// folder — указатель на значение папки: «папка не указана» у запроса выражается
// nil, а не третьим членом перечисления (tweb GLOBAL_FOLDER_ID = undefined).
func folder(f domain.FolderID) *domain.FolderID { return &f }

func TestSliceDialogPageFolder(t *testing.T) {
	all := archivedFixture()

	t.Run("папка не указана — весь набор, архив вместе с остальными", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 {
			t.Fatalf("count=%d, want 5", r.Count)
		}
	})

	t.Run("FolderAll — без архива, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderAll)})
		eq(t, chatIDs(r.Dialogs), []int64{20, 40})
		if r.Count != 2 || !r.Whole {
			t.Fatalf("count=%d whole=%v, want 2 true", r.Count, r.Whole)
		}
	})

	t.Run("FolderArchive — только архив, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive)})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30, 50})
		if r.Count != 3 {
			t.Fatalf("count=%d, want 3", r.Count)
		}
	})

	// Курсор ищется ВНУТРИ выборки: chat_id 30 в архиве — второй, а в полном
	// наборе третий. Мутация «фильтровать после нарезки» краснит здесь.
	t.Run("курсор считается внутри выборки", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive), Limit: 1, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{50})
		if r.Count != 3 || r.Whole {
			t.Fatalf("count=%d whole=%v, want 3 false", r.Count, r.Whole)
		}
	})

	// Чат из ДРУГОЙ выборки курсором не является — страница идёт с начала
	// (то же правило, что у неизвестного id: домен не различает эти случаи).
	t.Run("курсор из другой выборки — страница с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive), Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30})
	})
}

// TestListDialogsPage бьёт по самой проводке Interactor.ListDialogsPage, а не
// только по чистой sliceDialogPage: чинит находку ревью — до этого теста подмена
// `all, err := i.ListDialogs(...)` на `all, _ := i.ListDialogs(...)` (глотание
// ошибки) не красила ни один тест пакета.
func TestListDialogsPage(t *testing.T) {
	t.Run("страница согласована с ListDialogs", func(t *testing.T) {
		in, _ := newInteractor()
		ctx := context.Background()
		const owner int64 = 1
		for _, peer := range []int64{2, 3, 4} {
			if _, err := in.CreatePrivateChat(ctx, owner, peer); err != nil {
				t.Fatalf("CreatePrivateChat: %v", err)
			}
		}

		all, err := in.ListDialogs(ctx, owner)
		if err != nil {
			t.Fatalf("ListDialogs: %v", err)
		}
		if len(all) != 3 {
			t.Fatalf("setup: got %d dialogs, want 3", len(all))
		}

		page, err := in.ListDialogsPage(ctx, owner, domain.DialogPage{Limit: 2})
		if err != nil {
			t.Fatalf("ListDialogsPage: %v", err)
		}
		if page.Count != len(all) || page.Whole {
			t.Fatalf("page count=%d whole=%v, want count=%d whole=false", page.Count, page.Whole, len(all))
		}
		eq(t, chatIDs(page.Dialogs), chatIDs(all)[:2])

		rest, err := in.ListDialogsPage(ctx, owner, domain.DialogPage{
			Limit:        2,
			OffsetChatID: page.Dialogs[len(page.Dialogs)-1].ChatID,
		})
		if err != nil {
			t.Fatalf("ListDialogsPage (2-я страница): %v", err)
		}
		if rest.Count != len(all) {
			t.Fatalf("хвост набора обязан нести размер набора: count=%d, want %d", rest.Count, len(all))
		}
		eq(t, chatIDs(rest.Dialogs), chatIDs(all)[2:])
	})

	t.Run("ошибка ListDialogs пробрасывается наружу, а не глотается", func(t *testing.T) {
		s := newStore()
		wantErr := errors.New("boom")
		in := New(fakeTx{}, errChatRepo{fakeChats{s}, wantErr}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)

		_, err := in.ListDialogsPage(context.Background(), 1, domain.DialogPage{})
		if !errors.Is(err, wantErr) {
			t.Fatalf("got err=%v, want %v", err, wantErr)
		}
	})
}

// errChatRepo — обёртка над fakeChats, форсирующая ошибку ListDialogs: единственный
// способ проверить, что ListDialogsPage её пробрасывает, а не глотает.
type errChatRepo struct {
	fakeChats
	err error
}

func (r errChatRepo) ListDialogs(_ context.Context, _ int64) ([]domain.DialogRecord, error) {
	return nil, r.err
}
