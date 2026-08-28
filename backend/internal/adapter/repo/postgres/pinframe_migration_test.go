package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0113 переводит замороженные кадры закрепления на конструктор.
//
// Главное, что она обязана сохранить, — РАЗНИЦУ между «закрепили» и
// «открепили», выразив её отсутствием бита, а не значением поля. Ошибка здесь
// не теоретическая: после догона разрыва открепление, приехавшее как
// закрепление, вернёт снятую плашку.
const pinFrameMigrationPrevVersion = 112

func TestMigration0113_PinFrameBecomesConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, pinFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", pinFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990004001")
	peer := seedUser(t, pool, "+79990004002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'pin_message', jsonb_build_object('id', 12, 'peer_id', $2::bigint, 'pinned', true)),
		   ($1, 2, 'pin_message', jsonb_build_object('id', 12, 'peer_id', $2::bigint, 'pinned', false))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0113: %v", err)
	}

	var tag string
	var pinned *bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->'pFlags'->>'pinned')::boolean FROM updates WHERE pts=1`).
		Scan(&tag, &pinned); err != nil {
		t.Fatalf("кадр закрепления: %v", err)
	}
	if tag != "updatePinnedMessages" || pinned == nil || !*pinned {
		t.Fatalf("закрепление = %q, бит = %v", tag, pinned)
	}

	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->'pFlags'->>'pinned')::boolean FROM updates WHERE pts=2`).
		Scan(&tag, &pinned); err != nil {
		t.Fatalf("кадр открепления: %v", err)
	}
	if tag != "updatePinnedMessages" {
		t.Fatalf("открепление = %q, want тот же конструктор", tag)
	}
	if pinned != nil {
		t.Fatalf("у открепления бит поднят (%v) — «выключено» стало значением", *pinned)
	}

	// Номер уехал в вектор, а пир стал конструктором.
	var msgID int64
	var peerTag string
	if err := pool.QueryRow(ctx,
		`SELECT (payload->'messages'->>0)::bigint, payload->'peer'->>'_' FROM updates WHERE pts=1`).
		Scan(&msgID, &peerTag); err != nil {
		t.Fatalf("адрес кадра: %v", err)
	}
	if msgID != 12 || peerTag != "peerUser" {
		t.Fatalf("адрес = messages[0]=%d, peer=%s", msgID, peerTag)
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, pinFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var flat bool
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'pinned')::boolean FROM updates WHERE pts=1`).Scan(&flat); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if !flat {
		t.Fatal("после отката закрепление потеряло признак")
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_' FROM updates WHERE pts=2`).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "updatePinnedMessages" {
		t.Fatalf("после круга Down→Up = %q", tag)
	}
}
