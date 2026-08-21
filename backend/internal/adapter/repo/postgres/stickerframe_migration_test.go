package postgres

import (
	"context"
	"encoding/json"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0110 проставляет `documentAttributeSticker.stickerset` в
// ЗАМОРОЖЕННЫХ кадрах журналов.
//
// Цена ошибки — стикер без набора у всех, кто догоняет разрыв: клик по нему
// перестал бы открывать набор, а спросить больше некого (обратный поиск
// удалён вместе с ручкой). Проверка на настоящих строках в настоящем Postgres.
const stickerFrameMigrationPrevVersion = 109

func TestMigration0110_FrozenFramesGetStickerSet(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, stickerFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", stickerFrameMigrationPrevVersion, err)
	}

	owner := seedUser(t, pool, "+79990001001")
	user := seedUser(t, pool, "+79990001002")

	known := seedStickerMedia(t, pool, owner, "frame/known")
	orphan := seedStickerMedia(t, pool, owner, "frame/orphan") // файл вне наборов

	var setID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO sticker_sets (slug, title, kind, created_by) VALUES ('frameset','Frame','sticker',$1) RETURNING id`,
		owner).Scan(&setID); err != nil {
		t.Fatalf("seed set: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO stickers (set_id, media_id, emoji, position) VALUES ($1,$2,'😀',0)`, setID, known); err != nil {
		t.Fatalf("seed sticker: %v", err)
	}

	// Кадры СТАРОЙ формы: атрибут стикера без `stickerset`. Первый — документ
	// внутри сообщения (обычная отправка), второй — на верхнем уровне (кадр
	// обновления вложения), третий — файл вне наборов.
	frame := func(mediaID int64, nested bool) string {
		doc := map[string]any{
			"_": "document", "id": mediaID, "mime_type": "image/webp", "size": 1000,
			"attributes": []any{
				map[string]any{"_": "documentAttributeSticker", "alt": "😀"},
				map[string]any{"_": "documentAttributeImageSize", "w": 512, "h": 512},
			},
		}
		media := map[string]any{"_": "messageMediaDocument", "document": doc}
		var payload map[string]any
		if nested {
			payload = map[string]any{"message": map[string]any{"_": "message", "id": 1, "media": media}}
		} else {
			payload = map[string]any{"media": media}
		}
		raw, _ := json.Marshal(payload)
		return string(raw)
	}

	pts := 0
	insert := func(typ, payload string) {
		t.Helper()
		pts++
		if _, err := pool.Exec(ctx,
			`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
			user, pts, typ, payload); err != nil {
			t.Fatalf("seed update: %v", err)
		}
	}
	insert("new_message", frame(known, true))
	insert("media_update", frame(known, false))
	insert("new_message", frame(orphan, true))

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0110: %v", err)
	}

	// Набор известен → адрес числом; файла нет в наборах → честное «набора нет».
	var withSet, empty int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE payload::text LIKE '%"inputStickerSetID"%'`).Scan(&withSet); err != nil {
		t.Fatalf("count inputStickerSetID: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE payload::text LIKE '%"inputStickerSetEmpty"%'`).Scan(&empty); err != nil {
		t.Fatalf("count inputStickerSetEmpty: %v", err)
	}
	if withSet != 2 {
		t.Fatalf("кадров с адресом набора = %d, want 2 (вложенный и верхнеуровневый)", withSet)
	}
	if empty != 1 {
		t.Fatalf("кадров с «набора нет» = %d, want 1", empty)
	}

	// Ни один атрибут не остался без параметра — иначе переигранный стикер
	// оказался бы без набора.
	var bare int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates u, jsonb_array_elements(
		   COALESCE(u.payload->'message'->'media'->'document'->'attributes',
		            u.payload->'media'->'document'->'attributes', '[]'::jsonb)) a
		  WHERE a->>'_' = 'documentAttributeSticker' AND NOT (a ? 'stickerset')`).Scan(&bare); err != nil {
		t.Fatalf("count bare: %v", err)
	}
	if bare != 0 {
		t.Fatalf("атрибутов без stickerset осталось %d, want 0", bare)
	}

	// Круг Down → Up: откат снимает параметр, повторный накат ставит его снова.
	if err := storepostgres.MigrateDownTo(url, stickerFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE payload::text LIKE '%stickerset%'`).Scan(&withSet); err != nil {
		t.Fatalf("count после отката: %v", err)
	}
	if withSet != 0 {
		t.Fatalf("после отката параметр остался в %d кадрах, want 0", withSet)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM updates WHERE payload::text LIKE '%"inputStickerSetID"%'`).Scan(&withSet); err != nil {
		t.Fatalf("count после круга: %v", err)
	}
	if withSet != 2 {
		t.Fatalf("после круга Down→Up кадров с адресом = %d, want 2", withSet)
	}
}
