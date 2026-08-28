package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0122 — последние кадры шага B: чат исчез, тема чата, баланс звёзд,
// снимок карточки и бусты канала.
//
// Отдельно проверяется журнал КАНАЛА: у его кадров курсор жил ключом
// `channel_pts` — вторым именем того же поля, — и теперь это параметр `pts`
// самого конструктора.
const chatFramesMigrationPrevVersion = 121

func TestMigration0122_ChatAndProfileFrames(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, chatFramesMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", chatFramesMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990013001")
	var channelID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('channel','Канал') RETURNING id`).
		Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'chat_removed', jsonb_build_object('peer_id', -$2::bigint, 'removed', true)),
		   ($1, 2, 'chat_theme_update', jsonb_build_object('peer_id', -$2::bigint, 'theme_id', 'sunset')),
		   ($1, 3, 'balance_update', jsonb_build_object('balance', 42)),
		   ($1, 4, 'chat_update', jsonb_build_object('peer_id', -$2::bigint,
		      'chat_full', jsonb_build_object('_', 'messages.chatFull')))`,
		user, channelID); err != nil {
		t.Fatalf("seed updates: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload) VALUES
		   ($1, 1, 1, 'chat_update', jsonb_build_object('chat_full', jsonb_build_object('_', 'messages.chatFull'))),
		   ($1, 2, 1, 'boost_update', jsonb_build_object('status', jsonb_build_object(
		      'level', 2, 'boosts_count', 5, 'current_level_boosts', 3, 'next_level_boosts', 6)))`,
		channelID); err != nil {
		t.Fatalf("seed channel updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0122: %v", err)
	}

	// «Чат исчез»: константа `removed: true` ушла вместе со строкой типа.
	var tag string
	var hasRemoved bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload ? 'removed' FROM updates WHERE pts = 1`).Scan(&tag, &hasRemoved); err != nil {
		t.Fatalf("кадр удаления чата: %v", err)
	}
	if tag != "updateChatRemoved" || hasRemoved {
		t.Fatalf("кадр удаления = %s, removed остался: %v", tag, hasRemoved)
	}

	var themeTag, themeID string
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->>'theme_id' FROM updates WHERE pts = 2`).Scan(&themeTag, &themeID); err != nil {
		t.Fatalf("кадр темы: %v", err)
	}
	if themeTag != "updateChatTheme" || themeID != "sunset" {
		t.Fatalf("кадр темы = %s/%q", themeTag, themeID)
	}

	// Баланс — КОНСТРУКТОР starsAmount, а не голое число.
	var balTag, amountTag string
	var amount, nanos int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'balance'->>'_', (payload->'balance'->>'amount')::bigint,
		        (payload->'balance'->>'nanos')::bigint
		   FROM updates WHERE pts = 3`).Scan(&balTag, &amountTag, &amount, &nanos); err != nil {
		t.Fatalf("кадр баланса: %v", err)
	}
	if balTag != "updateStarsBalance" || amountTag != "starsAmount" || amount != 42 || nanos != 0 {
		t.Fatalf("кадр баланса = %s/%s/%d.%d", balTag, amountTag, amount, nanos)
	}

	// Журнал КАНАЛА: карточка и бусты.
	var chTag, chPeer string
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'peer'->>'_' FROM channel_updates WHERE pts = 1`).Scan(&chTag, &chPeer); err != nil {
		t.Fatalf("кадр карточки канала: %v", err)
	}
	// Ожидание — конструктор КАНАЛЬНОГО журнала: 0122 записал сюда
	// updateChatFullSnapshot, а 0123 развёл два журнала по конструкторам
	// (курсор у них разный). Накат идёт до последней миграции, поэтому здесь
	// видно состояние после обеих.
	if chTag != "updateChannelFullSnapshot" || chPeer != "peerChannel" {
		t.Fatalf("кадр карточки канала = %s/%s", chTag, chPeer)
	}
	var boostTag, statusTag string
	var level, boosts, next int
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'status'->>'_', (payload->'status'->>'level')::int,
		        (payload->'status'->>'boosts')::int, (payload->'status'->>'next_level_boosts')::int
		   FROM channel_updates WHERE pts = 2`).Scan(&boostTag, &statusTag, &level, &boosts, &next); err != nil {
		t.Fatalf("кадр бустов: %v", err)
	}
	if boostTag != "updateChannelBoostStatus" || statusTag != "premium.boostsStatus" {
		t.Fatalf("кадр бустов = %s/%s", boostTag, statusTag)
	}
	if level != 2 || boosts != 5 || next != 6 {
		t.Fatalf("статус бустов = уровень %d, бустов %d, следующий порог %d", level, boosts, next)
	}
	// Ключа `channel_pts` в теле нет и быть не может: курсор — параметр
	// конструктора, а в журнале он колонка.
	var strayCursor bool
	if err := pool.QueryRow(ctx,
		`SELECT bool_or(payload ? 'channel_pts') FROM channel_updates`).Scan(&strayCursor); err != nil {
		t.Fatalf("проверка курсора: %v", err)
	}
	if strayCursor {
		t.Fatal("в теле кадра канала остался ключ channel_pts")
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, chatFramesMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var balance int64
	if err := pool.QueryRow(ctx, `SELECT (payload->>'balance')::bigint FROM updates WHERE pts = 3`).Scan(&balance); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if balance != 42 {
		t.Fatalf("после отката баланс = %d", balance)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->'balance'->>'_' FROM updates WHERE pts = 3`).Scan(&amountTag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if amountTag != "starsAmount" {
		t.Fatalf("после круга Down→Up баланс = %q", amountTag)
	}
}
