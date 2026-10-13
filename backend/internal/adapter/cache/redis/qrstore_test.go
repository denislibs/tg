package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

func newQRTestStore(t *testing.T) (*QRStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	return NewQRStore(goredis.NewClient(&goredis.Options{Addr: mr.Addr()})), mr
}

func TestQRStore_ClaimTokenOnce(t *testing.T) {
	store, _ := newQRTestStore(t)
	ctx := context.Background()
	rec := domain.QRLogin{Token: "t", Status: domain.QRPending, Platform: "web", ExceptIDs: []int64{7}}

	created, err := store.Create(ctx, "k", "th", rec, time.Minute)
	if err != nil || !created {
		t.Fatalf("Create: created=%v err=%v", created, err)
	}
	if k, err := store.PeekToken(ctx, "th"); err != nil || k != "k" {
		t.Fatalf("PeekToken = %q, %v", k, err)
	}
	// Peek не снимает указатель.
	if k, err := store.PeekToken(ctx, "th"); err != nil || k != "k" {
		t.Fatalf("PeekToken повторно = %q, %v", k, err)
	}
	if k, err := store.ClaimToken(ctx, "th"); err != nil || k != "k" {
		t.Fatalf("ClaimToken = %q, %v", k, err)
	}
	if _, err := store.ClaimToken(ctx, "th"); err != domain.ErrNotFound {
		t.Fatalf("второй ClaimToken = %v, want ErrNotFound", err)
	}
	got, err := store.GetByKey(ctx, "k")
	if err != nil || got.Token != "t" || got.Platform != "web" || len(got.ExceptIDs) != 1 || got.ExceptIDs[0] != 7 {
		t.Fatalf("GetByKey = %+v, %v", got, err)
	}
	if err := store.DeleteByKey(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetByKey(ctx, "k"); err != domain.ErrNotFound {
		t.Fatalf("GetByKey после удаления = %v", err)
	}
}

// Запись ключа ставится NX: проигравший не перезаписывает чужую запись и не
// ставит свой указатель.
func TestQRStore_CreateIsNX(t *testing.T) {
	store, _ := newQRTestStore(t)
	ctx := context.Background()
	if ok, err := store.Create(ctx, "k", "th1", domain.QRLogin{Token: "t1"}, time.Minute); err != nil || !ok {
		t.Fatalf("первый Create: %v %v", ok, err)
	}
	if ok, err := store.Create(ctx, "k", "th2", domain.QRLogin{Token: "t2"}, time.Minute); err != nil || ok {
		t.Fatalf("второй Create: created=%v err=%v; want false", ok, err)
	}
	if got, _ := store.GetByKey(ctx, "k"); got.Token != "t1" {
		t.Fatalf("запись перезаписана: %+v", got)
	}
	if _, err := store.PeekToken(ctx, "th2"); err != domain.ErrNotFound {
		t.Fatalf("указатель проигравшего поставлен: %v", err)
	}
}

func TestQRStore_PutByKeyAndTTL(t *testing.T) {
	store, mr := newQRTestStore(t)
	ctx := context.Background()
	_, _ = store.Create(ctx, "k", "th", domain.QRLogin{Token: "t", Status: domain.QRPending}, time.Minute)
	if err := store.PutByKey(ctx, "k", domain.QRLogin{Token: "t", Status: domain.QRConfirmed}, time.Minute); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.GetByKey(ctx, "k"); got.Status != domain.QRConfirmed {
		t.Fatalf("PutByKey не записал: %+v", got)
	}
	mr.FastForward(2 * time.Minute)
	if _, err := store.GetByKey(ctx, "k"); err != domain.ErrNotFound {
		t.Fatalf("запись не протухла: %v", err)
	}
	if _, err := store.PeekToken(ctx, "th"); err != domain.ErrNotFound {
		t.Fatalf("указатель не протух: %v", err)
	}
}
