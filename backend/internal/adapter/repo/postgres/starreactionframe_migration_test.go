package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0117 убирает замороженные кадры платной ⭐-реакции: своего кадра у
// неё больше нет — она едет тем же конструктором updateMessageReactions, что и
// обычная, вторым конструктором объединения Reaction в общем векторе results.
//
// Восстановить из старого тела полный агрегат нечем: эмодзи-чипов на тот момент
// в нём не сохранено, а положить половину нельзя — агрегат АБСОЛЮТЕН, и кадр
// без эмодзи-чипов стёр бы их получателю.
const starReactionFrameMigrationPrevVersion = 116

func TestMigration0117_StarReactionFramesRemoved(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, starReactionFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", starReactionFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990008001")
	peer := seedUser(t, pool, "+79990008002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'star_reaction', jsonb_build_object(
		      'id', 12, 'peer_id', $2::bigint, 'sender_id', $2::bigint, 'total', 15, 'mine', 15)),
		   ($1, 2, 'reaction', jsonb_build_object(
		      '_', 'updateMessageReactions', 'msg_id', 12, 'pts_count', 1,
		      'peer', jsonb_build_object('_', 'peerUser', 'user_id', $2::bigint),
		      'reactions', jsonb_build_object('_', 'messageReactions',
		         'pFlags', jsonb_build_object('min', true), 'results', '[]'::jsonb)))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0117: %v", err)
	}

	var stars int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE type = 'star_reaction'`).Scan(&stars); err != nil {
		t.Fatalf("счёт кадров: %v", err)
	}
	if stars != 0 {
		t.Fatalf("кадров star_reaction осталось %d — переигрывание половины агрегата стёрло бы эмодзи-чипы", stars)
	}

	// Кадры обычной реакции миграция не трогает: они уже в форме конструктора.
	var kept string
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_' FROM updates WHERE pts = 2`).Scan(&kept); err != nil {
		t.Fatalf("кадр реакции: %v", err)
	}
	if kept != "updateMessageReactions" {
		t.Fatalf("кадр реакции = %q; миграция задела чужие строки", kept)
	}
}
