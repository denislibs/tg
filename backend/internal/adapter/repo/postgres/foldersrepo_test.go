package postgres

import (
	"context"
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

	f, err := r.Create(ctx, owner, domain.Folder{Title: "друзья", Groups: true, IncludeChats: []int64{5, 7}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if f.ID == 0 || f.Pos != 0 || !f.Groups || len(f.IncludeChats) != 2 {
		t.Fatalf("created = %+v", f)
	}

	f2, err := r.Create(ctx, owner, domain.Folder{Title: "работа", Broadcasts: true})
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
