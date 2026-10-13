package postgres

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func boolPtr(v bool) *bool { return &v }

// PatchType трогает только переданное поле своего типа и создаёт строку с
// дефолтами остальных; параллельные правки разных типов не затирают друг друга.
func TestNotifyRepo_PatchType(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewNotifyRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7941")

	if _, err := r.Get(ctx, user); err == nil {
		t.Fatal("Get без строки должен вернуть ErrNotFound")
	}
	if err := r.PatchType(ctx, user, domain.NotifyTypeChats, boolPtr(true), nil); err != nil {
		t.Fatal(err)
	}
	s, _ := r.Get(ctx, user)
	want := domain.DefaultNotifySettings()
	want.Groups.Muted = true
	if s != want {
		t.Fatalf("после мьюта групп: %+v, want %+v", s, want)
	}
	if err := r.PatchType(ctx, user, domain.NotifyTypeChats, nil, boolPtr(false)); err != nil {
		t.Fatal(err)
	}
	s, _ = r.Get(ctx, user)
	if !s.Groups.Muted || s.Groups.Preview {
		t.Fatalf("превью групп не выставилось, мьют потерян: %+v", s.Groups)
	}

	var wg sync.WaitGroup
	for _, nt := range []domain.NotifyType{domain.NotifyTypeUsers, domain.NotifyTypeBroadcasts} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.PatchType(ctx, user, nt, boolPtr(true), boolPtr(false)); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	s, _ = r.Get(ctx, user)
	for _, nt := range []domain.NotifyType{domain.NotifyTypeUsers, domain.NotifyTypeChats, domain.NotifyTypeBroadcasts} {
		if v := s.ForType(nt); !v.Muted || v.Preview {
			t.Errorf("%s: %+v, want muted/no-preview", nt, v)
		}
	}
	if err := r.PatchType(ctx, user, "notifyPeer", nil, nil); err == nil {
		t.Fatal("неизвестный тип принят")
	}
}
