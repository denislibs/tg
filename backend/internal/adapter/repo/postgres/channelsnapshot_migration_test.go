package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0123 — снимок карточки в журнале КАНАЛА стал своим конструктором.
//
// Проверяется ровно то, ради чего он заведён: два журнала различаются
// дискриминатором. Поэтому тест смотрит на ОБА — персональный кадр обязан
// остаться updateChatFullSnapshot, иначе развилка курсора у получателя снова
// станет неразрешимой, только в другую сторону.
const channelSnapshotMigrationPrevVersion = 122

func TestMigration0123_ChannelSnapshotConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, channelSnapshotMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", channelSnapshotMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990013101")
	var channelID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('channel','Канал') RETURNING id`).
		Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}

	snapshot := `jsonb_build_object('_', 'updateChatFullSnapshot',
	   'peer', jsonb_build_object('_', 'peerChannel', 'channel_id', $2::bigint),
	   'chat_full', jsonb_build_object('_', 'messages.chatFull'), 'pts_count', 1)`
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload)
		 VALUES ($1, 1, 1, 'chat_update', `+snapshot+`)`, channelID, channelID); err != nil {
		t.Fatalf("seed channel updates: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1, 1, 'chat_update', `+snapshot+`)`,
		user, channelID); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0123: %v", err)
	}

	var channelTag, userTag string
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM channel_updates WHERE pts = 1`).Scan(&channelTag); err != nil {
		t.Fatalf("кадр журнала канала: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM updates WHERE pts = 1`).Scan(&userTag); err != nil {
		t.Fatalf("кадр персонального журнала: %v", err)
	}
	if channelTag != "updateChannelFullSnapshot" {
		t.Fatalf("кадр журнала канала = %q", channelTag)
	}
	if userTag != "updateChatFullSnapshot" {
		t.Fatalf("кадр персонального журнала = %q (пер-юзерный курсор не переименовывается)", userTag)
	}

	// Остальное тело кадра переименование не задело: пир и карточка на месте.
	var peerTag, fullTag string
	if err := pool.QueryRow(ctx,
		`SELECT payload->'peer'->>'_', payload->'chat_full'->>'_' FROM channel_updates WHERE pts = 1`).
		Scan(&peerTag, &fullTag); err != nil {
		t.Fatalf("тело кадра канала: %v", err)
	}
	if peerTag != "peerChannel" || fullTag != "messages.chatFull" {
		t.Fatalf("тело кадра канала = %s/%s", peerTag, fullTag)
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, channelSnapshotMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM channel_updates WHERE pts = 1`).Scan(&channelTag); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if channelTag != "updateChatFullSnapshot" {
		t.Fatalf("после отката кадр канала = %q", channelTag)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM channel_updates WHERE pts = 1`).Scan(&channelTag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if channelTag != "updateChannelFullSnapshot" {
		t.Fatalf("после круга Down→Up кадр канала = %q", channelTag)
	}
}
