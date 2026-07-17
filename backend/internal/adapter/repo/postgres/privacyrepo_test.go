package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPrivacyRepo_RulesAndBlocks(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewPrivacyRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7901")
	contact := seedUser(t, pool, "+7902")
	stranger := seedUser(t, pool, "+7903")

	// Пустое состояние: правил нет, Get → ErrNotFound.
	if _, err := r.Get(ctx, owner, domain.PrivacyCalls); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("Get empty = %v, want ErrNotFound", err)
	}

	// Upsert + Get + повторный Upsert (обновление).
	rule := domain.PrivacyRule{Key: domain.PrivacyCalls, Value: domain.PrivacyContacts, AllowUserIDs: []int64{stranger}}
	if err := r.Upsert(ctx, owner, rule); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	got, err := r.Get(ctx, owner, domain.PrivacyCalls)
	if err != nil || got.Value != domain.PrivacyContacts || len(got.AllowUserIDs) != 1 || got.AllowUserIDs[0] != stranger {
		t.Fatalf("Get = %+v, %v", got, err)
	}
	rule.Value = domain.PrivacyNobody
	rule.AllowUserIDs = nil
	rule.DenyUserIDs = []int64{contact}
	if err := r.Upsert(ctx, owner, rule); err != nil {
		t.Fatalf("Upsert update: %v", err)
	}
	got, _ = r.Get(ctx, owner, domain.PrivacyCalls)
	if got.Value != domain.PrivacyNobody || len(got.DenyUserIDs) != 1 || len(got.AllowUserIDs) != 0 {
		t.Fatalf("Get after update = %+v", got)
	}
	if all, err := r.Rules(ctx, owner); err != nil || len(all) != 1 {
		t.Fatalf("Rules = %v, %v", all, err)
	}

	// Контактность: owner сохранил contact.
	if _, err := pool.Exec(ctx,
		`INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, owner, contact); err != nil {
		t.Fatalf("seed contact: %v", err)
	}
	if ok, _ := r.IsContact(ctx, owner, contact); !ok {
		t.Fatal("IsContact(owner, contact) = false")
	}
	if ok, _ := r.IsContact(ctx, owner, stranger); ok {
		t.Fatal("IsContact(owner, stranger) = true")
	}

	// Блокировки.
	if err := r.Block(ctx, owner, stranger); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if err := r.Block(ctx, owner, stranger); err != nil { // идемпотентно
		t.Fatalf("Block twice: %v", err)
	}
	if ok, _ := r.IsBlocked(ctx, owner, stranger); !ok {
		t.Fatal("IsBlocked = false after Block")
	}
	list, total, err := r.BlockedList(ctx, owner, 0, 50)
	if err != nil || total != 1 || len(list) != 1 || list[0].UserID != stranger {
		t.Fatalf("BlockedList = %+v, %d, %v", list, total, err)
	}
	if found, _ := r.Unblock(ctx, owner, stranger); !found {
		t.Fatal("Unblock = not found")
	}
	if ok, _ := r.IsBlocked(ctx, owner, stranger); ok {
		t.Fatal("IsBlocked = true after Unblock")
	}
	if err := r.Block(ctx, owner, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("Block missing user = %v, want ErrNotFound", err)
	}
}

func TestPrivacyRepo_VisibleMap(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewPrivacyRepo(pool)
	ctx := context.Background()
	viewer := seedUser(t, pool, "+7911")
	open := seedUser(t, pool, "+7912")     // без правила → дефолт everybody
	closed := seedUser(t, pool, "+7913")   // nobody
	friend := seedUser(t, pool, "+7914")   // contacts, viewer — контакт
	blocker := seedUser(t, pool, "+7915")  // everybody, но заблокировал viewer
	excepted := seedUser(t, pool, "+7916") // nobody + allow viewer

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(r.Upsert(ctx, closed, domain.PrivacyRule{Key: domain.PrivacyLastSeen, Value: domain.PrivacyNobody}))
	must(r.Upsert(ctx, friend, domain.PrivacyRule{Key: domain.PrivacyLastSeen, Value: domain.PrivacyContacts}))
	must(r.Upsert(ctx, excepted, domain.PrivacyRule{Key: domain.PrivacyLastSeen, Value: domain.PrivacyNobody, AllowUserIDs: []int64{viewer}}))
	_, err := pool.Exec(ctx, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'V')`, friend, viewer)
	must(err)
	must(r.Block(ctx, blocker, viewer))

	vis, err := r.VisibleMap(ctx, viewer, []int64{viewer, open, closed, friend, blocker, excepted}, domain.PrivacyLastSeen)
	must(err)
	want := map[int64]bool{viewer: true, open: true, closed: false, friend: true, blocker: false, excepted: true}
	for id, w := range want {
		if vis[id] != w {
			t.Errorf("VisibleMap[%d] = %v, want %v", id, vis[id], w)
		}
	}

	// Дефолт contacts (phone_number): open без правила → не виден не-контакту.
	vis, err = r.VisibleMap(ctx, viewer, []int64{open, friend}, domain.PrivacyPhoneNumber)
	must(err)
	if vis[open] {
		t.Error("phone_number: дефолт contacts — не-контакт не должен видеть номер open")
	}
	if !vis[friend] {
		t.Error("phone_number: дефолт contacts — viewer контакт friend, номер должен быть виден")
	}
}
