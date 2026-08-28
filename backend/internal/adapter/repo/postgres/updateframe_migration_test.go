package postgres

import (
	"context"
	"encoding/json"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0111 проставляет ДИСКРИМИНАТОР кадра в замороженных записях
// журналов: `updateNewMessage` в пер-юзерном и `updateNewChannelMessage` в
// канальном.
//
// Цена ошибки — вся история после разрыва связи: клиент переигрывает эти записи
// при /sync и channels.getDifference, и как только разбор начнёт ветвиться по
// `_` (шаг C порта), кадр без дискриминатора станет неопознанным. Проверка на
// настоящих строках в настоящем Postgres.
const updateFrameMigrationPrevVersion = 110

func TestMigration0111_FrozenFramesGetConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, updateFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", updateFrameMigrationPrevVersion, err)
	}

	owner := seedUser(t, pool, "+79990002001")
	var channelID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title) VALUES ('channel','News') RETURNING id`).Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}

	// Кадр СТАРОЙ формы: тело — словарь под ключом `message`, вида у него нет.
	oldFrame := func(id int) string {
		raw, _ := json.Marshal(map[string]any{
			"message": map[string]any{"_": "message", "id": id, "message": "привет"},
		})
		return string(raw)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'new_message', $2::jsonb),
		   ($1, 2, 'read',        $3::jsonb)`,
		owner, oldFrame(1), `{"user_id":1,"up_to_seq":1}`); err != nil {
		t.Fatalf("seed updates: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, type, payload) VALUES ($1, 1, 'new_message', $2::jsonb)`,
		channelID, oldFrame(2)); err != nil {
		t.Fatalf("seed channel_updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0111: %v", err)
	}

	// Какой конструктор ставить, решает ТАБЛИЦА, а не тип записи: он у обеих
	// один и тот же.
	assertTag := func(query, want string) {
		t.Helper()
		var got string
		if err := pool.QueryRow(ctx, query).Scan(&got); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		if got != want {
			t.Fatalf("дискриминатор = %q, want %q", got, want)
		}
	}
	assertTag(`SELECT payload->>'_' FROM updates WHERE type='new_message'`, "updateNewMessage")
	assertTag(`SELECT payload->>'_' FROM channel_updates WHERE type='new_message'`, "updateNewChannelMessage")

	var ptsCount int
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'pts_count')::int FROM updates WHERE type='new_message'`).Scan(&ptsCount); err != nil {
		t.Fatalf("pts_count: %v", err)
	}
	if ptsCount != 1 {
		t.Fatalf("pts_count = %d, а курсор у нас плотный", ptsCount)
	}

	// Кадры ДРУГИХ типов миграция не трогает: их порт — следующие шаги, и
	// подставить им чужой конструктор значило бы соврать о виде кадра.
	var otherTag *string
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_' FROM updates WHERE type='read'`).Scan(&otherTag); err != nil {
		t.Fatalf("read: %v", err)
	}
	if otherTag != nil {
		t.Fatalf("кадру read проставлен дискриминатор %q, а его порт ещё не сделан", *otherTag)
	}

	// Круг Down → Up: откат снимает оба ключа, повторный накат ставит их снова.
	if err := storepostgres.MigrateDownTo(url, updateFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var withTag int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE payload ? '_' OR payload ? 'pts_count'`).Scan(&withTag); err != nil {
		t.Fatalf("count после отката: %v", err)
	}
	if withTag != 0 {
		t.Fatalf("после отката дискриминатор остался у %d записей, want 0", withTag)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	assertTag(`SELECT payload->>'_' FROM updates WHERE type='new_message'`, "updateNewMessage")
}
