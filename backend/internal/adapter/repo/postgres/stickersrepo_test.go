package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// seedStickerMedia — media-строка под файл стикера/GIF.
func seedStickerMedia(t *testing.T, pool *pgxpool.Pool, ownerID int64, key string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media',$2,'application/json') RETURNING id`,
		ownerID, key).Scan(&id)
	if err != nil {
		t.Fatalf("seedStickerMedia: %v", err)
	}
	return id
}

// seedFullSet — набор из n стикеров, возвращает набор и id стикеров.
func seedFullSet(t *testing.T, pool *pgxpool.Pool, r *StickersRepo, owner int64, slug string, n int) (domain.StickerSet, []int64) {
	t.Helper()
	ctx := context.Background()
	set, err := r.CreateSet(ctx, domain.StickerSet{Slug: slug, Title: "Набор " + slug, Kind: "sticker", CreatedBy: owner})
	if err != nil {
		t.Fatalf("CreateSet(%s): %v", slug, err)
	}
	ids := make([]int64, 0, n)
	for k := 0; k < n; k++ {
		mediaID := seedStickerMedia(t, pool, owner, fmt.Sprintf("%s/%d", slug, k))
		s, err := r.AddSticker(ctx, domain.Sticker{SetID: set.ID, MediaID: mediaID, Emoji: "😀"})
		if err != nil {
			t.Fatalf("AddSticker: %v", err)
		}
		ids = append(ids, s.ID)
	}
	return set, ids
}

func TestStickersRepo_SetsCRUD(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7801")

	set, ids := seedFullSet(t, pool, r, owner, "duck", 3)
	if set.ID == 0 {
		t.Fatalf("CreateSet: пустой id")
	}
	// Занятый slug → ErrConflict.
	if _, err := r.CreateSet(ctx, domain.StickerSet{Slug: "duck", Title: "Дубль", Kind: "sticker", CreatedBy: owner}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate slug: want ErrConflict, got %v", err)
	}
	got, err := r.SetBySlug(ctx, "duck")
	if err != nil || got.ID != set.ID || got.StickerCount != 3 || got.CreatedBy != owner || got.Kind != "sticker" {
		t.Fatalf("SetBySlug: %+v, %v", got, err)
	}
	if _, err := r.SetBySlug(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetBySlug missing: want ErrNotFound, got %v", err)
	}
	byID, err := r.SetByID(ctx, set.ID)
	if err != nil || byID.Slug != "duck" {
		t.Fatalf("SetByID: %+v, %v", byID, err)
	}
	// Стикеры набора: позиции последовательные, порядок стабильный.
	sts, err := r.Stickers(ctx, set.ID)
	if err != nil || len(sts) != 3 {
		t.Fatalf("Stickers: %+v, %v", sts, err)
	}
	for k, s := range sts {
		if s.Position != k || s.ID != ids[k] || s.Emoji != "😀" {
			t.Fatalf("Stickers[%d]: %+v", k, s)
		}
	}
	if _, err := r.StickerByID(ctx, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("StickerByID missing: want ErrNotFound, got %v", err)
	}

	// Поиск по title/slug, регистронезависимый.
	found, err := r.SearchSets(ctx, "DUC", 10)
	if err != nil || len(found) != 1 || found[0].ID != set.ID {
		t.Fatalf("SearchSets: %+v, %v", found, err)
	}
}

func TestStickersRepo_InstallAndMySets(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7802")
	user := seedUser(t, pool, "+7803")

	set1, _ := seedFullSet(t, pool, r, owner, "first_set", 1)
	set2, _ := seedFullSet(t, pool, r, owner, "second_set", 2)

	for _, id := range []int64{set1.ID, set2.ID, set1.ID} { // повторная установка — no-op
		if err := r.Install(ctx, user, id); err != nil {
			t.Fatalf("Install(%d): %v", id, err)
		}
	}
	sets, err := r.InstalledSets(ctx, user)
	if err != nil || len(sets) != 2 {
		t.Fatalf("InstalledSets: %+v, %v", sets, err)
	}
	// Порядок установки сохраняется (position).
	if sets[0].ID != set1.ID || sets[1].ID != set2.ID || sets[1].StickerCount != 2 {
		t.Fatalf("InstalledSets order: %+v", sets)
	}
	if err := r.Uninstall(ctx, user, set1.ID); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if err := r.Uninstall(ctx, user, set1.ID); err != nil { // идемпотентно
		t.Fatalf("Uninstall повторно: %v", err)
	}
	if sets, _ = r.InstalledSets(ctx, user); len(sets) != 1 || sets[0].ID != set2.ID {
		t.Fatalf("InstalledSets после Uninstall: %+v", sets)
	}
}

func TestStickersRepo_RecentUpsertTrim(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7804")
	user := seedUser(t, pool, "+7805")

	_, ids := seedFullSet(t, pool, r, owner, "recent_set", 6)
	// keep=4: после 6 касаний остаются 4 последних.
	for _, id := range ids {
		if err := r.TouchRecent(ctx, user, id, 4); err != nil {
			t.Fatalf("TouchRecent(%d): %v", id, err)
		}
	}
	got, err := r.Recent(ctx, user, 10)
	if err != nil || len(got) != 4 {
		t.Fatalf("Recent: %+v, %v", got, err)
	}
	if got[0].ID != ids[5] {
		t.Fatalf("Recent[0]: want %d, got %d", ids[5], got[0].ID)
	}
	// Upsert: повторное касание поднимает стикер наверх, не плодя строк.
	if err := r.TouchRecent(ctx, user, ids[2], 4); err != nil {
		t.Fatalf("TouchRecent повторно: %v", err)
	}
	got, _ = r.Recent(ctx, user, 10)
	if len(got) != 4 || got[0].ID != ids[2] {
		t.Fatalf("Recent после upsert: %+v", got)
	}
}

func TestStickersRepo_FavedTrim(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7806")
	user := seedUser(t, pool, "+7807")

	_, ids := seedFullSet(t, pool, r, owner, "faved_set", 4)
	for _, id := range ids {
		if err := r.Fave(ctx, user, id, 3); err != nil {
			t.Fatalf("Fave(%d): %v", id, err)
		}
	}
	got, err := r.Faved(ctx, user, 10)
	if err != nil || len(got) != 3 || got[0].ID != ids[3] {
		t.Fatalf("Faved: %+v, %v", got, err)
	}
	if err := r.Unfave(ctx, user, ids[3]); err != nil {
		t.Fatalf("Unfave: %v", err)
	}
	if got, _ = r.Faved(ctx, user, 10); len(got) != 2 {
		t.Fatalf("Faved после Unfave: %+v", got)
	}
}

func TestStickersRepo_SearchByEmoji_InstalledOnly(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7808")
	user := seedUser(t, pool, "+7809")

	installed, instIDs := seedFullSet(t, pool, r, owner, "inst_set", 2)
	seedFullSet(t, pool, r, owner, "not_inst_set", 2) // тот же emoji, но не установлен
	if err := r.Install(ctx, user, installed.ID); err != nil {
		t.Fatalf("Install: %v", err)
	}
	got, err := r.SearchByEmoji(ctx, user, "😀", 16)
	if err != nil || len(got) != 2 || got[0].ID != instIDs[0] || got[1].ID != instIDs[1] {
		t.Fatalf("SearchByEmoji: %+v, %v", got, err)
	}
	if got, _ = r.SearchByEmoji(ctx, user, "🐟", 16); len(got) != 0 {
		t.Fatalf("SearchByEmoji чужой emoji: %+v", got)
	}
}

func TestStickersRepo_SavedGifsTrim(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7810")

	var ids []int64
	for k := 0; k < 5; k++ {
		ids = append(ids, seedStickerMedia(t, pool, user, fmt.Sprintf("gif/%d", k)))
	}
	// keep=3: старые вытесняются по saved_at (LIFO).
	for _, id := range ids {
		if err := r.SaveGif(ctx, user, id, 3); err != nil {
			t.Fatalf("SaveGif(%d): %v", id, err)
		}
	}
	gifs, err := r.SavedGifs(ctx, user)
	if err != nil || len(gifs) != 3 {
		t.Fatalf("SavedGifs: %+v, %v", gifs, err)
	}
	if gifs[0].MediaID != ids[4] || gifs[2].MediaID != ids[2] {
		t.Fatalf("SavedGifs order: %+v", gifs)
	}
	// Upsert: пересохранение поднимает наверх без дублей.
	if err := r.SaveGif(ctx, user, ids[2], 3); err != nil {
		t.Fatalf("SaveGif повторно: %v", err)
	}
	if gifs, _ = r.SavedGifs(ctx, user); len(gifs) != 3 || gifs[0].MediaID != ids[2] {
		t.Fatalf("SavedGifs после upsert: %+v", gifs)
	}
	if err := r.DeleteGif(ctx, user, ids[2]); err != nil {
		t.Fatalf("DeleteGif: %v", err)
	}
	if gifs, _ = r.SavedGifs(ctx, user); len(gifs) != 2 {
		t.Fatalf("SavedGifs после Delete: %+v", gifs)
	}
}

func TestStickersRepo_IsStickerMediaAndExists(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7811")

	set, _ := seedFullSet(t, pool, r, owner, "media_set", 1)
	sts, _ := r.Stickers(ctx, set.ID)
	plainMedia := seedStickerMedia(t, pool, owner, "plain")

	if ok, err := r.IsStickerMedia(ctx, sts[0].MediaID); err != nil || !ok {
		t.Fatalf("IsStickerMedia(стикер): %v, %v", ok, err)
	}
	if ok, _ := r.IsStickerMedia(ctx, plainMedia); ok {
		t.Fatalf("IsStickerMedia(обычное медиа): want false")
	}
	if ok, err := r.MediaExists(ctx, plainMedia); err != nil || !ok {
		t.Fatalf("MediaExists: %v, %v", ok, err)
	}
	if ok, _ := r.MediaExists(ctx, 999999); ok {
		t.Fatalf("MediaExists(нет): want false")
	}
}
