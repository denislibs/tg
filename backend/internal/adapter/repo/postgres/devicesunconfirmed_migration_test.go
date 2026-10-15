package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграции 0180–0181 («новый вход», М1-3): devices.unconfirmed и
// password_login_tokens.approved появляются с DEFAULT false (существующие
// сессии и токены — подтверждённые), а idx_devices_user строится CONCURRENTLY
// (отдельный файл NO TRANSACTION) и обязан остаться валидным. Откат убирает
// всё и сам проходит без ошибок.
const devicesUnconfirmedPrevVersion = 179

func TestMigration0180_0181_DevicesUnconfirmedAndIndex(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, devicesUnconfirmedPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", devicesUnconfirmedPrevVersion, err)
	}
	var cols int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE (table_name='devices' AND column_name='unconfirmed')
		   OR (table_name='password_login_tokens' AND column_name='approved')`).Scan(&cols); err != nil || cols != 0 {
		t.Fatalf("после отката колонок %d, err=%v; want 0", cols, err)
	}
	var idx int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE indexname='idx_devices_user'`).Scan(&idx); err != nil || idx != 0 {
		t.Fatalf("после отката индексов %d, err=%v; want 0", idx, err)
	}

	userID := seedUser(t, pool, "+79990000780")
	if _, err := pool.Exec(ctx,
		`INSERT INTO devices (user_id, name, platform, token_hash) VALUES ($1,'Chrome','web','tok-old')`, userID); err != nil {
		t.Fatalf("seed device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO password_login_tokens (token_hash, user_id, expires_at) VALUES ('pt-old',$1, now()+interval '1 minute')`, userID); err != nil {
		t.Fatalf("seed token: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0180–0181: %v", err)
	}

	var unconfirmed, approved bool
	if err := pool.QueryRow(ctx, `SELECT unconfirmed FROM devices WHERE token_hash='tok-old'`).Scan(&unconfirmed); err != nil || unconfirmed {
		t.Fatalf("старая сессия unconfirmed=%v err=%v; want false", unconfirmed, err)
	}
	if err := pool.QueryRow(ctx, `SELECT approved FROM password_login_tokens WHERE token_hash='pt-old'`).Scan(&approved); err != nil || approved {
		t.Fatalf("старый токен approved=%v err=%v; want false", approved, err)
	}
	var valid bool
	if err := pool.QueryRow(ctx,
		`SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_devices_user'::regclass`).Scan(&valid); err != nil || !valid {
		t.Fatalf("idx_devices_user valid=%v err=%v; want true", valid, err)
	}

	// Повторный накат — пустой шаг (идемпотентность IF NOT EXISTS).
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	// Откат убирает всё.
	if err := storepostgres.MigrateDownTo(url, devicesUnconfirmedPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE indexname='idx_devices_user'`).Scan(&idx); err != nil || idx != 0 {
		t.Fatalf("после второго отката индексов %d, err=%v", idx, err)
	}
}
