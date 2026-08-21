package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Избранное и недавние адресуют ФАЙЛ, а не строку набора.
//
// Один и тот же файл может числиться в ДВУХ наборах — это не гипотеза, а
// свойство схемы: у `stickers.media_id` нет уникального индекса, и докблок
// прежнего обратного поиска (`SetByMediaID`) прямо это оговаривал. Пока
// избранное ключевалось суррогатным `stickers.id`, тот же файл попадал в
// список ДВАЖДЫ — панель показывала один стикер два раза.
//
// В оригинале `messages.faveSticker` принимает `InputDocument`, то есть файл, и
// дубль невыразим. Пин ловит возврат к ключу строки.
func TestStickersRepo_FaveIsPerDocument_NoDuplicates(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7901")

	// Один файл, два набора — как у Telegram, где документы переиспользуются.
	mediaID := seedStickerMedia(t, pool, owner, "shared/1")
	first, err := r.CreateSet(ctx, domain.StickerSetRecord{Slug: "first", Title: "Первый", Kind: "sticker", CreatedBy: owner})
	if err != nil {
		t.Fatalf("CreateSet: %v", err)
	}
	second, err := r.CreateSet(ctx, domain.StickerSetRecord{Slug: "second", Title: "Второй", Kind: "sticker", CreatedBy: owner})
	if err != nil {
		t.Fatalf("CreateSet: %v", err)
	}
	for _, setID := range []int64{first.ID, second.ID} {
		if _, err := r.AddSticker(ctx, domain.Sticker{SetID: setID, MediaID: mediaID, Emoji: "😀"}); err != nil {
			t.Fatalf("AddSticker: %v", err)
		}
	}

	if err := r.Fave(ctx, owner, mediaID, 10); err != nil {
		t.Fatalf("Fave: %v", err)
	}
	// Повторное добавление того же файла — не второй элемент, а обновление.
	if err := r.Fave(ctx, owner, mediaID, 10); err != nil {
		t.Fatalf("Fave повторно: %v", err)
	}

	faved, err := r.Faved(ctx, owner, 10)
	if err != nil {
		t.Fatalf("Faved: %v", err)
	}
	if len(faved) != 1 {
		t.Fatalf("в избранном %d записей, want 1 — один файл попал списком дважды", len(faved))
	}
	if faved[0].MediaID != mediaID {
		t.Fatalf("в избранном чужой файл: %d, want %d", faved[0].MediaID, mediaID)
	}
}

// Избранное переживает удаление набора: ключ — файл, а не строка набора.
//
// Прежде `faved_stickers.sticker_id` ссылался на `stickers(id)` с ON DELETE
// CASCADE, поэтому удаление набора стирало избранное пользователя — даже когда
// тот же файл оставался в другом, живом наборе.
func TestStickersRepo_FaveSurvivesSetDeletion(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7902")

	mediaID := seedStickerMedia(t, pool, owner, "survive/1")
	doomed, err := r.CreateSet(ctx, domain.StickerSetRecord{Slug: "doomed", Title: "Удалим", Kind: "sticker", CreatedBy: owner})
	if err != nil {
		t.Fatalf("CreateSet: %v", err)
	}
	keeper, err := r.CreateSet(ctx, domain.StickerSetRecord{Slug: "keeper", Title: "Останется", Kind: "sticker", CreatedBy: owner})
	if err != nil {
		t.Fatalf("CreateSet: %v", err)
	}
	for _, setID := range []int64{doomed.ID, keeper.ID} {
		if _, err := r.AddSticker(ctx, domain.Sticker{SetID: setID, MediaID: mediaID, Emoji: "😀"}); err != nil {
			t.Fatalf("AddSticker: %v", err)
		}
	}
	if err := r.Fave(ctx, owner, mediaID, 10); err != nil {
		t.Fatalf("Fave: %v", err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM sticker_sets WHERE id=$1`, doomed.ID); err != nil {
		t.Fatalf("удаление набора: %v", err)
	}

	faved, err := r.Faved(ctx, owner, 10)
	if err != nil {
		t.Fatalf("Faved: %v", err)
	}
	if len(faved) != 1 {
		t.Fatalf("после удаления набора в избранном %d записей, want 1 — избранное стёрлось вместе с чужим набором", len(faved))
	}
}

// Недавние — тот же ключ и та же причина.
func TestStickersRepo_RecentIsPerDocument_NoDuplicates(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7903")

	mediaID := seedStickerMedia(t, pool, owner, "recent/1")
	for _, slug := range []string{"ra", "rb"} {
		set, err := r.CreateSet(ctx, domain.StickerSetRecord{Slug: slug, Title: slug, Kind: "sticker", CreatedBy: owner})
		if err != nil {
			t.Fatalf("CreateSet: %v", err)
		}
		if _, err := r.AddSticker(ctx, domain.Sticker{SetID: set.ID, MediaID: mediaID, Emoji: "😀"}); err != nil {
			t.Fatalf("AddSticker: %v", err)
		}
	}

	if err := r.TouchRecent(ctx, owner, mediaID, 20); err != nil {
		t.Fatalf("TouchRecent: %v", err)
	}
	if err := r.TouchRecent(ctx, owner, mediaID, 20); err != nil {
		t.Fatalf("TouchRecent повторно: %v", err)
	}

	recent, err := r.Recent(ctx, owner, 20)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recent) != 1 {
		t.Fatalf("в недавних %d записей, want 1 — один файл попал списком дважды", len(recent))
	}
}

// Стикер резолвится ПО ФАЙЛУ: суррогатный ключ строки наружу больше не выходит,
// поэтому и usecase спрашивает документ. Набор при этом приезжает тот же, что
// отдавал удалённый обратный поиск, — но не отдельным запросом, а внутри самого
// документа (documentAttributeSticker.stickerset).
func TestStickersRepo_StickerByMediaID(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7904")

	set, _ := seedFullSet(t, pool, r, owner, "bymedia", 1)
	sts, err := r.Stickers(ctx, set.ID)
	if err != nil || len(sts) != 1 {
		t.Fatalf("Stickers: %v, %d", err, len(sts))
	}

	got, err := r.StickerByMediaID(ctx, sts[0].MediaID)
	if err != nil {
		t.Fatalf("StickerByMediaID: %v", err)
	}
	if got.MediaID != sts[0].MediaID || got.SetID != set.ID {
		t.Fatalf("резолв по файлу дал %+v, want media=%d set=%d", got, sts[0].MediaID, set.ID)
	}

	unknown := seedStickerMedia(t, pool, owner, "bymedia/none")
	if _, err := r.StickerByMediaID(ctx, unknown); err == nil {
		t.Fatal("файл вне наборов обязан давать ErrNotFound")
	}
}
