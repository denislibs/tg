package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0119 переводит замороженные кадры черновика на конструкторы.
//
// Главное, что она обязана сделать, — перестать выражать отсутствие ЗНАЧЕНИЕМ:
// снятый черновик становится конструктором draftMessageEmpty, а не `null` под
// тем же ключом.
const draftFrameMigrationPrevVersion = 118

func TestMigration0119_DraftFrameBecomesConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, draftFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", draftFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990010001")
	peer := seedUser(t, pool, "+79990010002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'draft_update', jsonb_build_object('peer_id', $2::bigint, 'draft', jsonb_build_object(
		      'text', 'набросок',
		      'entities', jsonb_build_array(jsonb_build_object('_', 'messageEntityBold', 'offset', 0, 'length', 4)),
		      'reply_to_id', 12,
		      'updated_at', '2026-08-01T10:00:00Z'))),
		   ($1, 2, 'draft_update', jsonb_build_object('peer_id', $2::bigint, 'draft', NULL))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0119: %v", err)
	}

	var tag, draftTag, message, replyTag string
	var date, replyTo int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'draft'->>'_', payload->'draft'->>'message',
		        (payload->'draft'->>'date')::bigint,
		        payload->'draft'->'reply_to'->>'_',
		        (payload->'draft'->'reply_to'->>'reply_to_msg_id')::bigint
		   FROM updates WHERE pts = 1`).Scan(&tag, &draftTag, &message, &date, &replyTag, &replyTo); err != nil {
		t.Fatalf("кадр черновика: %v", err)
	}
	if tag != "updateDraftMessage" || draftTag != "draftMessage" || message != "набросок" {
		t.Fatalf("кадр = %s/%s/%q", tag, draftTag, message)
	}
	if replyTag != "inputReplyToMessage" || replyTo != 12 {
		t.Fatalf("ссылка на ответ = %s/%d", replyTag, replyTo)
	}
	// Дата — СЕКУНДЫ эпохи, а не ISO-строка: те же единицы, что у сообщения.
	if date != 1785578400 {
		t.Fatalf("дата = %d; ждали секунды эпохи 2026-08-01T10:00:00Z", date)
	}
	var strayText, strayReply bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->'draft' ? 'text', payload->'draft' ? 'reply_to_id' FROM updates WHERE pts = 1`).
		Scan(&strayText, &strayReply); err != nil {
		t.Fatalf("остатки: %v", err)
	}
	if strayText || strayReply {
		t.Fatal("в черновике остались имена старой формы")
	}

	// Снятый черновик — КОНСТРУКТОР, а не null.
	var emptyTag string
	if err := pool.QueryRow(ctx,
		`SELECT payload->'draft'->>'_' FROM updates WHERE pts = 2`).Scan(&emptyTag); err != nil {
		t.Fatalf("кадр снятия: %v", err)
	}
	if emptyTag != "draftMessageEmpty" {
		t.Fatalf("снятый черновик = %q; ждали draftMessageEmpty", emptyTag)
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, draftFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var text string
	if err := pool.QueryRow(ctx, `SELECT payload->'draft'->>'text' FROM updates WHERE pts = 1`).Scan(&text); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if text != "набросок" {
		t.Fatalf("после отката текст = %q", text)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->'draft'->>'_' FROM updates WHERE pts = 2`).Scan(&emptyTag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if emptyTag != "draftMessageEmpty" {
		t.Fatalf("после круга Down→Up снятый черновик = %q", emptyTag)
	}
}
