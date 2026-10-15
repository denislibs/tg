package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestFoldersRepo_CRUD(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewFoldersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7801")
	other := seedUser(t, pool, "+7802")

	f, err := r.Create(ctx, owner, domain.DialogFilter{Title: "друзья", Groups: true, IncludeChats: []int64{5, 7}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if f.ID == 0 || f.Pos != 0 || !f.Groups || len(f.IncludeChats) != 2 {
		t.Fatalf("created = %+v", f)
	}

	f2, err := r.Create(ctx, owner, domain.DialogFilter{Title: "работа", Broadcasts: true})
	if err != nil {
		t.Fatalf("Create 2: %v", err)
	}
	if f2.Pos != 1 {
		t.Fatalf("pos = %d, want 1", f2.Pos)
	}

	list, err := r.List(ctx, owner)
	if err != nil || len(list) != 2 {
		t.Fatalf("List = %v, %v", list, err)
	}
	if list[0].Title != "друзья" || len(list[1].IncludeChats) != 0 {
		t.Fatalf("list = %+v", list)
	}

	f.Title = "друзья 2"
	f.ExcludeChats = []int64{9}
	upd, err := r.Update(ctx, owner, f)
	if err != nil || upd.Title != "друзья 2" || len(upd.ExcludeChats) != 1 {
		t.Fatalf("Update = %+v, %v", upd, err)
	}

	// чужую папку нельзя обновить/удалить
	if _, err := r.Update(ctx, other, f); err != domain.ErrNotFound {
		t.Fatalf("Update foreign: %v, want ErrNotFound", err)
	}
	if err := r.Delete(ctx, other, f.ID); err != domain.ErrNotFound {
		t.Fatalf("Delete foreign: %v, want ErrNotFound", err)
	}

	if err := r.Delete(ctx, owner, f.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if n, _ := r.Count(ctx, owner); n != 1 {
		t.Fatalf("Count = %d, want 1", n)
	}
}

func TestFoldersRepo_Invites(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewFoldersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7901")
	other := seedUser(t, pool, "+7902")

	f, err := r.Create(ctx, owner, domain.DialogFilter{Title: "команда", Groups: true, IncludeChats: []int64{11, 22}})
	if err != nil {
		t.Fatalf("Create folder: %v", err)
	}

	slug, err := r.CreateFolderInvite(ctx, domain.FolderInvite{
		FolderID: f.ID, OwnerID: owner, Title: "команда", ChatIDs: []int64{11, 22},
	})
	if err != nil || slug == "" {
		t.Fatalf("CreateFolderInvite = %q, %v", slug, err)
	}

	inv, err := r.GetFolderInviteBySlug(ctx, slug)
	if err != nil {
		t.Fatalf("GetFolderInviteBySlug: %v", err)
	}
	if inv.FolderID != f.ID || inv.OwnerID != owner || inv.Title != "команда" || len(inv.ChatIDs) != 2 {
		t.Fatalf("invite = %+v", inv)
	}

	list, err := r.ListFolderInvites(ctx, f.ID, owner)
	if err != nil || len(list) != 1 || list[0].Slug != slug || len(list[0].ChatIDs) != 2 {
		t.Fatalf("ListFolderInvites = %+v, %v", list, err)
	}

	// missing slug → ErrNotFound
	if _, err := r.GetFolderInviteBySlug(ctx, "nope"); err != domain.ErrNotFound {
		t.Fatalf("GetFolderInviteBySlug(missing) = %v, want ErrNotFound", err)
	}

	// чужой не может отозвать
	if err := r.DeleteFolderInvite(ctx, slug, other); err != domain.ErrNotFound {
		t.Fatalf("DeleteFolderInvite foreign = %v, want ErrNotFound", err)
	}
	if err := r.DeleteFolderInvite(ctx, slug, owner); err != nil {
		t.Fatalf("DeleteFolderInvite: %v", err)
	}
	if _, err := r.GetFolderInviteBySlug(ctx, slug); err != domain.ErrNotFound {
		t.Fatalf("after delete: %v, want ErrNotFound", err)
	}

	// каскад: удаление папки убирает её ссылки
	slug2, err := r.CreateFolderInvite(ctx, domain.FolderInvite{FolderID: f.ID, OwnerID: owner, Title: "x", ChatIDs: []int64{11}})
	if err != nil {
		t.Fatalf("CreateFolderInvite 2: %v", err)
	}
	if err := r.Delete(ctx, owner, f.ID); err != nil {
		t.Fatalf("Delete folder: %v", err)
	}
	if _, err := r.GetFolderInviteBySlug(ctx, slug2); err != domain.ErrNotFound {
		t.Fatalf("after folder delete: %v, want ErrNotFound (cascade)", err)
	}
}

// Ф7-З: порядок папок (messages.updateDialogFiltersOrder) и позиция «Все чаты».
func TestFoldersRepo_Reorder(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewFoldersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7811")
	other := seedUser(t, pool, "+7812")

	var ids [3]int64
	for i, title := range []string{"a", "b", "c"} {
		f, err := r.Create(ctx, owner, domain.DialogFilter{Title: title, Groups: true})
		if err != nil {
			t.Fatalf("Create %s: %v", title, err)
		}
		ids[i] = f.ID
	}
	foreign, err := r.Create(ctx, other, domain.DialogFilter{Title: "x", Groups: true})
	if err != nil {
		t.Fatalf("Create foreign: %v", err)
	}
	order := func() []int64 {
		t.Helper()
		list, err := r.List(ctx, owner)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		out := make([]int64, len(list))
		for i, f := range list {
			out[i] = f.ID
		}
		return out
	}
	eq := func(got, want []int64) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("order = %v; want %v", got, want)
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("order = %v; want %v", got, want)
			}
		}
	}

	// Полный порядок.
	if changed, err := r.Reorder(ctx, owner, []int64{ids[2], ids[0], ids[1]}); err != nil || !changed {
		t.Fatalf("Reorder full: changed=%v err=%v", changed, err)
	}
	eq(order(), []int64{ids[2], ids[0], ids[1]})

	// Частичный: перечисленные первыми, остальные — в хвост в прежнем порядке.
	if changed, err := r.Reorder(ctx, owner, []int64{ids[1]}); err != nil || !changed {
		t.Fatalf("Reorder partial: changed=%v err=%v", changed, err)
	}
	eq(order(), []int64{ids[1], ids[2], ids[0]})

	// Пустой порядок — ничего не меняет.
	if changed, err := r.Reorder(ctx, owner, nil); err != nil || changed {
		t.Fatalf("Reorder empty: changed=%v err=%v", changed, err)
	}
	eq(order(), []int64{ids[1], ids[2], ids[0]})

	// Тот же порядок (полный и частичный префикс) — не изменение.
	for _, same := range [][]int64{{ids[1], ids[2], ids[0]}, {ids[1]}} {
		if changed, err := r.Reorder(ctx, owner, same); err != nil || changed {
			t.Fatalf("Reorder same %v: changed=%v err=%v", same, changed, err)
		}
	}

	// Чужая, несуществующая папка и повтор — ErrInvalid, порядок не тронут.
	for name, bad := range map[string][]int64{
		"чужая":          {ids[0], foreign.ID},
		"несуществующая": {999999},
		"повтор":         {ids[0], ids[0]},
	} {
		if _, err := r.Reorder(ctx, owner, bad); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("Reorder %s: %v; want ErrInvalid", name, err)
		}
		eq(order(), []int64{ids[1], ids[2], ids[0]})
	}
	// Чужие папки не затронуты.
	if list, _ := r.List(ctx, other); len(list) != 1 || list[0].Pos != 0 {
		t.Fatalf("foreign list = %+v", list)
	}

	// Новая папка после перестановки встаёт в конец.
	nf, err := r.Create(ctx, owner, domain.DialogFilter{Title: "d", Groups: true})
	if err != nil {
		t.Fatalf("Create after reorder: %v", err)
	}
	eq(order(), []int64{ids[1], ids[2], ids[0], nf.ID})
}

func TestFoldersRepo_AllChatsPos(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewFoldersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7821")
	other := seedUser(t, pool, "+7822")

	if pos, err := r.AllChatsPos(ctx, owner); err != nil || pos != 0 {
		t.Fatalf("default AllChatsPos = %d, %v; want 0", pos, err)
	}
	if changed, err := r.SetAllChatsPos(ctx, owner, 2); err != nil || !changed {
		t.Fatalf("SetAllChatsPos: changed=%v err=%v", changed, err)
	}
	if changed, err := r.SetAllChatsPos(ctx, owner, 2); err != nil || changed {
		t.Fatalf("SetAllChatsPos то же место: changed=%v err=%v", changed, err)
	}
	if pos, _ := r.AllChatsPos(ctx, owner); pos != 2 {
		t.Fatalf("AllChatsPos = %d; want 2", pos)
	}
	if pos, _ := r.AllChatsPos(ctx, other); pos != 0 {
		t.Fatalf("чужая позиция = %d; want 0", pos)
	}
}
