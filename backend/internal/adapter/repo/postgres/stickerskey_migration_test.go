package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0109 перекладывает избранное и недавние стикеры с суррогатного
// ключа строки набора (`stickers.id`) на ключ ФАЙЛА (`media_id`) — решение Р2
// разбора стикеров.
//
// Цена ошибки здесь — потерянное избранное у всех, кто им пользовался:
// колонка `sticker_id` удаляется, восстановить её неоткуда. Плюс сама
// перекладка неоднозначна — файл может числиться в двух наборах, — и её
// правило («остаётся самая свежая отметка») проверяемо только на настоящих
// строках.
//
// Схема та же, что у 0100–0108: откатываемся на версию назад, пишем строки как
// их писал прежний код, накатываем 0109 и читаем ОБЫЧНЫМ репозиторием — он
// знает только новую форму, поэтому «прочиталось» и значит «сконвертировалось».
const stickersKeyMigrationPrevVersion = 108

func TestMigration0109_FavesAndRecentsRekeyToDocument(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, stickersKeyMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", stickersKeyMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990000901")
	owner := seedUser(t, pool, "+79990000902")

	// Один файл в ДВУХ наборах — источник дубля, ради которого меняется ключ.
	shared := seedStickerMedia(t, pool, owner, "mig/shared")
	only := seedStickerMedia(t, pool, owner, "mig/only")

	newSet := func(slug string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO sticker_sets (slug, title, kind, created_by) VALUES ($1,$2,'sticker',$3) RETURNING id`,
			slug, slug, owner).Scan(&id); err != nil {
			t.Fatalf("seed set %s: %v", slug, err)
		}
		return id
	}
	newSticker := func(setID, mediaID int64, pos int) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO stickers (set_id, media_id, emoji, position) VALUES ($1,$2,'😀',$3) RETURNING id`,
			setID, mediaID, pos).Scan(&id); err != nil {
			t.Fatalf("seed sticker: %v", err)
		}
		return id
	}

	setA, setB := newSet("mig_a"), newSet("mig_b")
	sharedInA := newSticker(setA, shared, 0)
	sharedInB := newSticker(setB, shared, 0)
	onlyInA := newSticker(setA, only, 1)

	// Прежний код: ключ — строка набора. Один и тот же ФАЙЛ, добавленный из
	// двух наборов, давал ДВЕ строки; побеждать при схлопывании обязана самая
	// свежая отметка.
	seedFave := func(stickerID int64, at string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO faved_stickers (user_id, sticker_id, faved_at) VALUES ($1,$2,$3)`,
			user, stickerID, at); err != nil {
			t.Fatalf("seed fave: %v", err)
		}
	}
	seedFave(sharedInA, "2026-01-01T00:00:00Z")
	seedFave(sharedInB, "2026-06-01T00:00:00Z") // новее — она и должна остаться
	seedFave(onlyInA, "2026-03-01T00:00:00Z")

	if _, err := pool.Exec(ctx,
		`INSERT INTO recent_stickers (user_id, sticker_id, used_at) VALUES ($1,$2,'2026-02-01T00:00:00Z'),($1,$3,'2026-05-01T00:00:00Z')`,
		user, sharedInA, sharedInB); err != nil {
		t.Fatalf("seed recent: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0109: %v", err)
	}

	r := NewStickersRepo(pool)

	faved, err := r.Faved(ctx, user, 10)
	if err != nil {
		t.Fatalf("Faved: %v", err)
	}
	if len(faved) != 2 {
		t.Fatalf("в избранном %d записей, want 2 (файл из двух наборов обязан схлопнуться в один)", len(faved))
	}
	// Порядок — по времени: самая свежая отметка общего файла (июнь) впереди
	// одиночного (март). Если бы победила старая (январь), порядок был бы обратным.
	if faved[0].MediaID != shared || faved[1].MediaID != only {
		t.Fatalf("порядок избранного %d,%d — want %d,%d (побеждает свежая отметка)",
			faved[0].MediaID, faved[1].MediaID, shared, only)
	}

	recent, err := r.Recent(ctx, user, 10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recent) != 1 || recent[0].MediaID != shared {
		t.Fatalf("в недавних %+v, want одну запись файла %d", recent, shared)
	}

	// Избранное переживает удаление одного из наборов: ключ — файл, а прежняя
	// ссылка на stickers(id) шла с ON DELETE CASCADE и стёрла бы запись.
	if _, err := pool.Exec(ctx, `DELETE FROM sticker_sets WHERE id=$1`, setB); err != nil {
		t.Fatalf("удаление набора: %v", err)
	}
	if faved, err = r.Faved(ctx, user, 10); err != nil || len(faved) != 2 {
		t.Fatalf("после удаления набора избранное = %+v (%v), want те же 2 записи", faved, err)
	}
}

// Обратный ход миграции: круг Down → Up обязан пройти на непустых данных.
// Точное восстановление невозможно в принципе (прямой ход теряет «из какого
// набора добавили», и это лишняя информация), поэтому проверяем не равенство
// строк, а то, что откат применяется и накат после него даёт рабочее состояние.
func TestMigration0109_DownUpRoundTrip(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	r := NewStickersRepo(pool)
	owner := seedUser(t, pool, "+79990000903")
	user := seedUser(t, pool, "+79990000904")

	set, seeded := seedFullSet(t, pool, r, owner, "roundtrip", 2)
	if err := r.Fave(ctx, user, seeded[0].MediaID, 10); err != nil {
		t.Fatalf("Fave: %v", err)
	}
	if err := r.TouchRecent(ctx, user, seeded[1].MediaID, 20); err != nil {
		t.Fatalf("TouchRecent: %v", err)
	}
	_ = set

	if err := storepostgres.MigrateDownTo(url, stickersKeyMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	// После отката ключ снова строка набора — читаем сырым SQL: репозиторий
	// такой формы уже не знает.
	var favedID int64
	if err := pool.QueryRow(ctx,
		`SELECT sticker_id FROM faved_stickers WHERE user_id=$1`, user).Scan(&favedID); err != nil {
		t.Fatalf("после отката избранное не читается: %v", err)
	}
	if favedID != seeded[0].ID {
		t.Fatalf("после отката sticker_id=%d, want %d", favedID, seeded[0].ID)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	faved, err := r.Faved(ctx, user, 10)
	if err != nil || len(faved) != 1 || faved[0].MediaID != seeded[0].MediaID {
		t.Fatalf("после круга Down→Up избранное = %+v (%v), want файл %d", faved, err, seeded[0].MediaID)
	}
}
