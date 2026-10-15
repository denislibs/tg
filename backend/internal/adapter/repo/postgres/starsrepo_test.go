package postgres

import (
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Списание у пользователя без строки баланса - недостаток звёзд, а не долг:
// раньше INSERT создавал строку с отрицательным балансом.
func TestStarsRepo_AddBalance_DebitWithoutRow(t *testing.T) {
	pool := postgres.NewTestDB(t)
	ctx := t.Context()
	r := NewStarsRepo(pool)
	u := seedUser(t, pool, "+79990007701")

	if _, err := r.AddBalance(ctx, u, -5); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("списание без строки = %v, want ErrForbidden", err)
	}
	if bal, err := r.Balance(ctx, u); err != nil || bal != 0 {
		t.Fatalf("после отказа баланс = %d, %v; want 0", bal, err)
	}
	if bal, err := r.AddBalance(ctx, u, 0); err != nil || bal != 0 {
		t.Fatalf("нулевое движение (блокировка) = %d, %v", bal, err)
	}
	if bal, err := r.AddBalance(ctx, u, 10); err != nil || bal != 10 {
		t.Fatalf("зачисление = %d, %v", bal, err)
	}
	if _, err := r.AddBalance(ctx, u, -11); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("списание сверх баланса = %v, want ErrForbidden", err)
	}
	if bal, err := r.AddBalance(ctx, u, -10); err != nil || bal != 0 {
		t.Fatalf("списание всего = %d, %v", bal, err)
	}
}
