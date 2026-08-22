package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0112 раздваивает замороженные кадры прочтения на два конструктора.
//
// Чей это кадр, решается по ВЛАДЕЛЬЦУ СТРОКИ (журнал пер-юзерный), и цена
// ошибки видна сразу: перепутай стороны — и после догона разрыва у читателя
// поедет горизонт собеседника (галочки «прочитано» у чужих сообщений), а у
// автора обнулится собственный счётчик непрочитанного.
const readFrameMigrationPrevVersion = 111

func TestMigration0112_ReadFrameSplitsByOwner(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, readFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", readFrameMigrationPrevVersion, err)
	}

	reader := seedUser(t, pool, "+79990003001")
	author := seedUser(t, pool, "+79990003002")

	// Одно и то же прочтение, записанное обоим: у читателя — своя строка, у
	// автора — своя. Форма СТАРАЯ: один кадр с user_id внутри.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'read', jsonb_build_object('user_id', $1::bigint, 'peer_id', $2::bigint, 'up_to_seq', 12, 'unread', 0)),
		   ($2, 1, 'read', jsonb_build_object('user_id', $1::bigint, 'peer_id', $1::bigint, 'up_to_seq', 12, 'unread', 0))`,
		reader, author); err != nil {
		t.Fatalf("seed updates: %v", err)
	}
	// Кадр канала: ключ пира отрицательный, значит на проводе он должен стать
	// конструктором peerChannel, а не остаться числом.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 2, 'read', jsonb_build_object('user_id', $1::bigint, 'peer_id', -55::bigint, 'up_to_seq', 7, 'unread', 3))`,
		reader); err != nil {
		t.Fatalf("seed channel read: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0112: %v", err)
	}

	var tag string
	var unread *int
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->>'still_unread_count')::int FROM updates WHERE user_id=$1 AND pts=1`,
		reader).Scan(&tag, &unread); err != nil {
		t.Fatalf("строка читателя: %v", err)
	}
	if tag != "updateReadHistoryInbox" {
		t.Fatalf("читателю = %q, want updateReadHistoryInbox", tag)
	}
	if unread == nil {
		t.Fatal("у кадра читателя нет счётчика непрочитанного")
	}

	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->>'still_unread_count')::int FROM updates WHERE user_id=$1 AND pts=1`,
		author).Scan(&tag, &unread); err != nil {
		t.Fatalf("строка автора: %v", err)
	}
	if tag != "updateReadHistoryOutbox" {
		t.Fatalf("автору = %q, want updateReadHistoryOutbox", tag)
	}
	if unread != nil {
		t.Fatalf("кадр «прочитали меня» несёт ЧУЖОЙ счётчик = %d", *unread)
	}

	// Пир стал конструктором: пользователь — peerUser, канал — peerChannel с
	// положительным id внутри.
	var peerTag string
	var peerID int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->'peer'->>'_', (payload->'peer'->>'user_id')::bigint FROM updates WHERE user_id=$1 AND pts=1`,
		author).Scan(&peerTag, &peerID); err != nil {
		t.Fatalf("пир строки автора: %v", err)
	}
	if peerTag != "peerUser" || peerID != reader {
		t.Fatalf("пир = %s{%d}, want peerUser{%d}", peerTag, peerID, reader)
	}
	if err := pool.QueryRow(ctx,
		`SELECT payload->'peer'->>'_', (payload->'peer'->>'channel_id')::bigint FROM updates WHERE user_id=$1 AND pts=2`,
		reader).Scan(&peerTag, &peerID); err != nil {
		t.Fatalf("пир канального прочтения: %v", err)
	}
	if peerTag != "peerChannel" || peerID != 55 {
		t.Fatalf("пир = %s{%d}, want peerChannel{55}", peerTag, peerID)
	}

	// Круг Down → Up: обратный ход возвращает единый кадр, повторный накат —
	// снова два конструктора.
	if err := storepostgres.MigrateDownTo(url, readFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var oldUser int64
	var oldPeer int64
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'user_id')::bigint, (payload->>'peer_id')::bigint FROM updates WHERE user_id=$1 AND pts=1`,
		reader).Scan(&oldUser, &oldPeer); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if oldUser != reader || oldPeer != author {
		t.Fatalf("после отката кадр читателя = user_id %d, peer_id %d", oldUser, oldPeer)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_' FROM updates WHERE user_id=$1 AND pts=1`, reader).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "updateReadHistoryInbox" {
		t.Fatalf("после круга Down→Up у читателя %q", tag)
	}
}
