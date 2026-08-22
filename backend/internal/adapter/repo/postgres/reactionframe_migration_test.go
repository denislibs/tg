package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0116 переводит замороженные кадры реакций на конструктор с
// абсолютным агрегатом.
//
// Главное, что она обязана сделать, — пометить агрегат `min`: без флага клиент
// принял бы «сервер не сообщил про мой выбор» за «я не ставил» и стёр бы
// собственную реакцию при первом же переигрывании из догона.
const reactionFrameMigrationPrevVersion = 115

func TestMigration0116_ReactionFrameBecomesConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, reactionFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", reactionFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990007001")
	peer := seedUser(t, pool, "+79990007002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1, 1, 'reaction', jsonb_build_object(
		   'id', 12, 'peer_id', $2::bigint, 'user_id', $2::bigint, 'author_id', $1::bigint,
		   'emoji', '👍', 'action', 'add', 'unread_reactions', 3,
		   'counts', jsonb_build_array(
		     jsonb_build_object('emoji', '👍', 'count', 2),
		     jsonb_build_object('emoji', '🔥', 'count', 1))))`,
		user, peer); err != nil {
		t.Fatalf("seed update: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0116: %v", err)
	}

	var tag string
	var min *bool
	var msgID int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->'reactions'->'pFlags'->>'min')::boolean, (payload->>'msg_id')::bigint
		   FROM updates WHERE pts=1`).Scan(&tag, &min, &msgID); err != nil {
		t.Fatalf("кадр: %v", err)
	}
	if tag != "updateMessageReactions" || msgID != 12 {
		t.Fatalf("кадр = %q, msg_id = %d", tag, msgID)
	}
	if min == nil || !*min {
		t.Fatal("агрегат не помечен min — клиент сотрёт свой выбор при переигрывании")
	}

	// Чипы стали конструкторами, порядок сохранён.
	var first, second string
	var firstCount int
	if err := pool.QueryRow(ctx,
		`SELECT payload->'reactions'->'results'->0->'reaction'->>'emoticon',
		        (payload->'reactions'->'results'->0->>'count')::int,
		        payload->'reactions'->'results'->1->'reaction'->>'emoticon'
		   FROM updates WHERE pts=1`).Scan(&first, &firstCount, &second); err != nil {
		t.Fatalf("чипы: %v", err)
	}
	if first != "👍" || firstCount != 2 || second != "🔥" {
		t.Fatalf("чипы = %s(%d), %s", first, firstCount, second)
	}

	// Дифф и пер-зрительский счётчик ушли: обе формы одного факта в одном кадре
	// и были той болезнью, ради которой порт делается.
	var stray bool
	if err := pool.QueryRow(ctx,
		`SELECT (payload ? 'emoji') OR (payload ? 'action') OR (payload ? 'user_id')
		     OR (payload ? 'unread_reactions') OR (payload ? 'counts') FROM updates WHERE pts=1`).Scan(&stray); err != nil {
		t.Fatalf("остатки: %v", err)
	}
	if stray {
		t.Fatal("в кадре остались поля диффа или пер-зрительский счётчик")
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, reactionFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var flatEmoji string
	if err := pool.QueryRow(ctx,
		`SELECT payload->'counts'->0->>'emoji' FROM updates WHERE pts=1`).Scan(&flatEmoji); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if flatEmoji != "👍" {
		t.Fatalf("после отката чип = %q", flatEmoji)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_' FROM updates WHERE pts=1`).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "updateMessageReactions" {
		t.Fatalf("после круга Down→Up = %q", tag)
	}
}
