package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// stickerMime решает, с каким Content-Type файл ляжет в media: по нему фронт
// выбирает движок (lottie/видео/картинка), поэтому ошибка здесь ломает рендер.
func TestStickerMime(t *testing.T) {
	cases := map[string]string{
		"1.tgs":     "application/x-tgsticker",
		"1.TGS":     "application/x-tgsticker",
		"2.webm":    "video/webm",
		"3.webp":    "image/webp",
		"4.png":     "image/png",
		"5.json":    "application/json",
		"cover.tgs": "application/x-tgsticker",
	}
	for file, want := range cases {
		if got := stickerMime(file); got != want {
			t.Errorf("stickerMime(%q) = %q, want %q", file, got, want)
		}
	}
}

// loadRanks превращает выдачу трендов в позиции: первый набор индекса — rank 1.
// Набора нет в индексе → 0, то есть «вне трендов».
func TestLoadRanks(t *testing.T) {
	dir := t.TempDir()
	body := `{"order": ["utyaduck", "hotcherry", "mrcroco"]}`
	if err := os.WriteFile(filepath.Join(dir, "_index.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	ranks := loadRanks(dir)
	if ranks["utyaduck"] != 1 {
		t.Errorf("utyaduck rank = %d, want 1", ranks["utyaduck"])
	}
	if ranks["mrcroco"] != 3 {
		t.Errorf("mrcroco rank = %d, want 3", ranks["mrcroco"])
	}
	if ranks["unknown"] != 0 {
		t.Errorf("unknown rank = %d, want 0", ranks["unknown"])
	}
}

// Индекса может не быть (свой каталог наборов) — это не ошибка, все наборы
// просто оказываются вне трендов.
func TestLoadRanksNoFile(t *testing.T) {
	if got := loadRanks(t.TempDir()); len(got) != 0 {
		t.Errorf("ranks = %v, want empty", got)
	}
}

// fakeSeeder — setSeeder в памяти: хранит один набор по slug и пишет, что с ним
// делали. Больше от usecase сиду ничего не нужно, поэтому ни Postgres, ни MinIO
// в этих тестах нет.
type fakeSeeder struct {
	sets map[string]domain.StickerSet

	created  []string
	stickers []int64
	ranks    map[int64]int
	covers   map[int64]int64
}

func newFakeSeeder() *fakeSeeder {
	return &fakeSeeder{sets: map[string]domain.StickerSet{}, ranks: map[int64]int{}, covers: map[int64]int64{}}
}

func (f *fakeSeeder) SetBySlug(_ context.Context, slug string) (domain.StickerSet, []domain.Sticker, error) {
	set, ok := f.sets[slug]
	if !ok {
		return domain.StickerSet{}, nil, domain.ErrNotFound
	}
	return set, nil, nil
}

func (f *fakeSeeder) CreateSet(_ context.Context, ownerID int64, slug, title, kind string) (domain.StickerSet, error) {
	set := domain.StickerSet{ID: int64(len(f.sets) + 1), Slug: slug, Title: title, Kind: kind, CreatedBy: ownerID}
	f.sets[slug] = set
	f.created = append(f.created, slug)
	return set, nil
}

func (f *fakeSeeder) AddSticker(_ context.Context, _, setID, mediaID int64, _ string) (domain.Sticker, error) {
	f.stickers = append(f.stickers, mediaID)
	return domain.Sticker{ID: int64(len(f.stickers)), SetID: setID, MediaID: mediaID}, nil
}

func (f *fakeSeeder) SetRank(_ context.Context, setID int64, rank int) error {
	f.ranks[setID] = rank
	return nil
}

func (f *fakeSeeder) SetCover(_ context.Context, setID, mediaID int64) error {
	f.covers[setID] = mediaID
	return nil
}

// writeSetDir раскладывает каталог набора так же, как это делает выгрузка
// tools/fetch_stickers.py: meta.json + файлы стикеров + файл обложки.
func writeSetDir(t *testing.T, dir, slug string) {
	t.Helper()
	sub := filepath.Join(dir, slug)
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	meta := setMeta{Title: "Утята", Kind: "sticker", Cover: "cover.tgs"}
	meta.Stickers = append(meta.Stickers, struct {
		File  string `json:"file"`
		Emoji string `json:"emoji"`
	}{File: "1.tgs", Emoji: "🦆"})
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "meta.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"1.tgs", "cover.tgs"} {
		if err := os.WriteFile(filepath.Join(sub, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// countingUpload — заливка-счётчик: каждый вызов отдаёт новый media id.
func countingUpload(n *int) uploadFunc {
	return func(_ context.Context, _ string) (int64, error) {
		*n++
		return int64(100 + *n), nil
	}
}

// Новый набор: создаётся целиком и сразу получает и rank, и обложку.
func TestSeedSetNew(t *testing.T) {
	dir := t.TempDir()
	writeSetDir(t, dir, "utyaduck")
	seeder := newFakeSeeder()
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if len(seeder.created) != 1 || len(seeder.stickers) != 1 {
		t.Fatalf("created=%v stickers=%v — ожидались один набор и один стикер", seeder.created, seeder.stickers)
	}
	if seeder.ranks[1] != 3 {
		t.Errorf("rank = %d, ожидался 3", seeder.ranks[1])
	}
	if seeder.covers[1] == 0 {
		t.Error("обложка не проставлена")
	}
}

// Регрессия: набор, созданный прерванным прогоном (rank 0, обложки нет),
// на повторном прогоне ДОЛЖЕН их получить. Ранний return «набор уже есть»
// оставлял такие наборы без порядка трендов и без обложки навсегда.
func TestSeedSetExistingGetsRankAndCover(t *testing.T) {
	dir := t.TempDir()
	writeSetDir(t, dir, "utyaduck")
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Title: "Утята", Kind: "sticker"}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 5); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if seeder.ranks[7] != 5 {
		t.Errorf("rank = %d, ожидался 5 — существующему набору ранг не проставили", seeder.ranks[7])
	}
	if seeder.covers[7] == 0 {
		t.Error("обложка не проставлена существующему набору")
	}
	// Стикеры существующего набора не перезаливаются: единственная заливка —
	// файл обложки.
	if len(seeder.created) != 0 || len(seeder.stickers) != 0 {
		t.Errorf("created=%v stickers=%v — существующий набор перезалит", seeder.created, seeder.stickers)
	}
	if uploads != 1 {
		t.Errorf("uploads = %d, ожидалась только обложка", uploads)
	}
}

// Второй прогон по уже полному набору не должен ни перезаливать обложку
// (иначе копия media на каждом деплое), ни трогать совпадающий ранг.
func TestSeedSetCompleteSetUntouched(t *testing.T) {
	dir := t.TempDir()
	writeSetDir(t, dir, "utyaduck")
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 5, CoverMediaID: 42}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 5); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if uploads != 0 {
		t.Errorf("uploads = %d, ожидался 0 — обложка уже есть", uploads)
	}
	if len(seeder.covers) != 0 || len(seeder.ranks) != 0 {
		t.Errorf("covers=%v ranks=%v — набор уже в нужном виде, записи лишние", seeder.covers, seeder.ranks)
	}
}
