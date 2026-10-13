package postgres

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// LockState создаёт строку курсора, если её нет, и держит её до конца транзакции:
// второй LockState того же владельца ждёт коммита первого.
func TestUpdatesRepo_LockStateBlocksUntilCommit(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewUpdatesRepo(pool)
	txm := NewTxManager(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7931")
	// Строка курсора уже закоммичена: ждать второму не на чем, кроме FOR UPDATE.
	if _, err := r.AppendUpdate(ctx, user, 1, 1, "seed", json.RawMessage(`{"_":"x"}`)); err != nil {
		t.Fatal(err)
	}

	locked := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	doRelease := func() { releaseOnce.Do(func() { close(release) }) }
	defer doRelease() // при падении теста первая транзакция не должна висеть
	done1 := make(chan error, 1)
	go func() {
		done1 <- txm.WithinTx(ctx, func(ctx context.Context) error {
			if err := r.LockState(ctx, user); err != nil {
				return err
			}
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked

	second := make(chan error, 1)
	go func() {
		second <- txm.WithinTx(ctx, func(ctx context.Context) error {
			return r.LockState(ctx, user)
		})
	}()
	select {
	case err := <-second:
		t.Fatalf("второй LockState не дождался коммита первого: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	doRelease()
	if err := <-done1; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-second:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("второй LockState не вернулся после коммита первого")
	}

}

// У владельца без строки курсора LockState её создаёт, не двигая pts:
// следующий AppendUpdate даёт 1.
func TestUpdatesRepo_LockStateCreatesRow(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewUpdatesRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7932")

	err := NewTxManager(pool).WithinTx(ctx, func(ctx context.Context) error { return r.LockState(ctx, user) })
	if err != nil {
		t.Fatal(err)
	}
	pts, err := r.AppendUpdate(ctx, user, 1, 1, "notify_settings", json.RawMessage(`{"_":"x"}`))
	if err != nil || pts != 1 {
		t.Fatalf("AppendUpdate после LockState: pts=%d err=%v", pts, err)
	}
}
