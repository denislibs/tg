package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0124 — второй ключ пира ушёл из кадров журнала канала.
const channelFramePeerMigrationPrevVersion = 123

func TestMigration0124_ChannelFramePeerKey(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, channelFramePeerMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", channelFramePeerMigrationPrevVersion, err)
	}

	var channelID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('channel','Канал') RETURNING id`).
		Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload) VALUES
		   ($1, 1, 1, 'chat_update', jsonb_build_object(
		      '_', 'updateChannelFullSnapshot',
		      'peer', jsonb_build_object('_', 'peerChannel', 'channel_id', $1::bigint),
		      'peer_id', -$1::bigint,
		      'chat_full', jsonb_build_object('_', 'messages.chatFull'), 'pts_count', 1))`,
		channelID); err != nil {
		t.Fatalf("seed channel updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0124: %v", err)
	}

	var stray bool
	var peerTag string
	if err := pool.QueryRow(ctx,
		`SELECT payload ? 'peer_id', payload->'peer'->>'_' FROM channel_updates WHERE pts = 1`).
		Scan(&stray, &peerTag); err != nil {
		t.Fatalf("кадр журнала канала: %v", err)
	}
	if stray {
		t.Fatal("в теле кадра канала остался второй ключ пира peer_id")
	}
	if peerTag != "peerChannel" {
		t.Fatalf("пир кадра = %q (единственный ключ пира обязан остаться)", peerTag)
	}

	// Круг Down → Up: обратный ход восстанавливает число из ключа строки.
	if err := storepostgres.MigrateDownTo(url, channelFramePeerMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var back int64
	if err := pool.QueryRow(ctx, `SELECT (payload->>'peer_id')::bigint FROM channel_updates WHERE pts = 1`).
		Scan(&back); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if back != -channelID {
		t.Fatalf("после отката peer_id = %d, ожидался %d", back, -channelID)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload ? 'peer_id' FROM channel_updates WHERE pts = 1`).Scan(&stray); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if stray {
		t.Fatal("после круга Down→Up второй ключ пира вернулся")
	}
}
