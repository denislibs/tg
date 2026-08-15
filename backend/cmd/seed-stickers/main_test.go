package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	// positions — занятые позиции набора по его id; наполняется тестом заранее
	// (существующий набор) и через AddSticker (досидированные позиции).
	positions map[int64]map[int]struct{}
	// thumbs — контуры стикеров по (setID, position): пишутся и вставкой
	// (AddStickerAt), и досидированием (BackfillPathThumbs), чтобы тест мог
	// проверить итоговое состояние независимо от того, каким путём контур
	// доехал.
	thumbs map[int64]map[int][]byte

	created  []string
	stickers []int64
	ranks    map[int64]int
	covers   map[int64]int64
	// backfillCalls — сколько раз позвали BackfillPathThumbs (для проверки,
	// что уже полностью контурный набор второй раз не дёргает Backfill).
	backfillCalls int
}

func newFakeSeeder() *fakeSeeder {
	return &fakeSeeder{
		sets:      map[string]domain.StickerSet{},
		positions: map[int64]map[int]struct{}{},
		thumbs:    map[int64]map[int][]byte{},
		ranks:     map[int64]int{},
		covers:    map[int64]int64{},
	}
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

// AddStickerAt — позиция берётся из аргумента буквально, не пересчитывается
// (как и у реального StickersRepo.AddStickerAt): именно это делает
// досидирование дыры в середине набора идемпотентным на повторном прогоне.
func (f *fakeSeeder) AddStickerAt(_ context.Context, _, setID, mediaID int64, _ string, position int, pathThumb []byte) (domain.Sticker, error) {
	f.stickers = append(f.stickers, mediaID)
	occ := f.positions[setID]
	if occ == nil {
		occ = map[int]struct{}{}
		f.positions[setID] = occ
	}
	occ[position] = struct{}{}
	if len(pathThumb) > 0 {
		th := f.thumbs[setID]
		if th == nil {
			th = map[int][]byte{}
			f.thumbs[setID] = th
		}
		th[position] = pathThumb
	}
	return domain.Sticker{ID: int64(len(f.stickers)), SetID: setID, MediaID: mediaID, Position: position, PathThumb: pathThumb}, nil
}

func (f *fakeSeeder) StickerPositions(_ context.Context, setID int64) (map[int]struct{}, error) {
	out := make(map[int]struct{}, len(f.positions[setID]))
	for pos := range f.positions[setID] {
		out[pos] = struct{}{}
	}
	return out, nil
}

// BackfillPathThumbs — как реальный StickersRepo.BackfillPathThumbs: не
// трогает позиции, у которых контур уже есть.
func (f *fakeSeeder) BackfillPathThumbs(_ context.Context, setID int64, incoming map[int][]byte) error {
	f.backfillCalls++
	if len(incoming) == 0 {
		return nil
	}
	th := f.thumbs[setID]
	if th == nil {
		th = map[int][]byte{}
		f.thumbs[setID] = th
	}
	for pos, thumb := range incoming {
		if _, ok := th[pos]; ok {
			continue
		}
		th[pos] = thumb
	}
	return nil
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
	meta.Stickers = append(meta.Stickers, stickerMetaEntry{File: "1.tgs", Emoji: "🦆"})
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
	// Единственный стикер из writeSetDir (позиция 0) уже залит — тест проверяет
	// именно доставку rank/обложки, а не досидирование стикеров (для него своя
	// проверка — TestSeedSetFillsMissingPositions).
	seeder.positions[7] = map[int]struct{}{0: {}}
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
	// Стикеры набора уже все на месте — единственная заливка — файл обложки.
	if len(seeder.created) != 0 || len(seeder.stickers) != 0 {
		t.Errorf("created=%v stickers=%v — существующий набор перезалит", seeder.created, seeder.stickers)
	}
	if uploads != 1 {
		t.Errorf("uploads = %d, ожидалась только обложка", uploads)
	}
}

// Второй прогон по уже полному набору не должен ни перезаливать обложку
// (иначе копия media на каждом деплое), ни трогать совпадающий ранг, ни
// пытаться залить уже занятые позиции стикеров.
func TestSeedSetCompleteSetUntouched(t *testing.T) {
	dir := t.TempDir()
	writeSetDir(t, dir, "utyaduck")
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 5, CoverMediaID: 42}
	seeder.positions[7] = map[int]struct{}{0: {}}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 5); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if uploads != 0 {
		t.Errorf("uploads = %d, ожидался 0 — набор уже полон", uploads)
	}
	if len(seeder.stickers) != 0 {
		t.Errorf("stickers=%v — набор уже полон, лишних стикеров быть не должно", seeder.stickers)
	}
	if len(seeder.covers) != 0 || len(seeder.ranks) != 0 {
		t.Errorf("covers=%v ranks=%v — набор уже в нужном виде, записи лишние", seeder.covers, seeder.ranks)
	}
}

// writeSetDirN раскладывает каталог набора с n стикерами (meta.json + файлы,
// без обложки) — для проверки досидирования недостающих позиций.
func writeSetDirN(t *testing.T, dir, slug string, n int) {
	t.Helper()
	writeSetDirNWithPaths(t, dir, slug, n, nil)
}

// writeSetDirNWithPaths — как writeSetDirN, но с контуром (base64) у
// перечисленных в paths позиций — для проверки чтения/backfill path_thumb.
func writeSetDirNWithPaths(t *testing.T, dir, slug string, n int, paths map[int]string) {
	t.Helper()
	sub := filepath.Join(dir, slug)
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	meta := setMeta{Title: "Утята", Kind: "sticker"}
	for k := 0; k < n; k++ {
		file := fmt.Sprintf("%d.tgs", k)
		meta.Stickers = append(meta.Stickers, stickerMetaEntry{File: file, Emoji: "🦆", Path: paths[k]})
		if err := os.WriteFile(filepath.Join(sub, file), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "meta.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// Главный сценарий Task 11: набор уже есть в БД, но неполон (например, в него
// на бою досидировали только часть Telegram-набора). Сид должен залить РОВНО
// недостающие позиции, не тронув существующие (на них ссылаются отправленные
// сообщения) и не создав дублей. Раньше seedSet при existing-наборе не заливал
// вообще ничего — так animated_emoji застрял на 6 самодельных стикерах вместо
// 599 приехавших из Telegram.
func TestSeedSetFillsMissingPositions(t *testing.T) {
	dir := t.TempDir()
	writeSetDirN(t, dir, "utyaduck", 4)
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 3, CoverMediaID: 42}
	seeder.positions[7] = map[int]struct{}{0: {}, 1: {}}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if uploads != 2 {
		t.Fatalf("uploads = %d, ожидалось 2 — недостающие позиции 2 и 3", uploads)
	}
	if len(seeder.stickers) != 2 {
		t.Fatalf("stickers=%v — ожидалось 2 новых стикера", seeder.stickers)
	}
	got := seeder.positions[7]
	if len(got) != 4 {
		t.Fatalf("positions = %v, ожидалось 4 занятых позиции", got)
	}
	for _, pos := range []int{2, 3} {
		if _, ok := got[pos]; !ok {
			t.Errorf("позиция %d не залита", pos)
		}
	}
	// Набор уже существует — CreateSet повторно не зовём.
	if len(seeder.created) != 0 {
		t.Errorf("created=%v — существующий набор пересоздан", seeder.created)
	}
	// Обложка уже есть — cover не перезаливаем: 2 заливки — это ровно недостающие
	// стикеры, ни одной лишней.
}

// Регрессия ревью Task 11: дыра НЕ с хвоста набора (стикер удалили из
// середины, а не из конца). AddSticker с автопозицией (max(position)+1)
// не умеет вставлять в дыру — файл дырявой позиции уехал бы в хвост набора,
// из-за чего повторный прогон снова находил бы ту же дыру «недостающей» и
// плодил дубль на КАЖДОМ прогоне (а сид гоняется при каждом деплое).
// AddStickerAt с явной позицией из meta.json чинит это: второй прогон по
// уже дозалитому набору обязан быть строгим no-op.
func TestSeedSetFillsMiddleGapIdempotently(t *testing.T) {
	dir := t.TempDir()
	writeSetDirN(t, dir, "utyaduck", 10) // meta.json на 10 файлов: 0..9
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 3, CoverMediaID: 42}
	// Занято всё, кроме позиции 3 (её стикер как будто удалили из середины).
	seeder.positions[7] = map[int]struct{}{0: {}, 1: {}, 2: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {}, 9: {}}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet (1-й прогон): %v", err)
	}
	if uploads != 1 {
		t.Fatalf("uploads после 1-го прогона = %d, ожидался 1 — недостающая позиция 3", uploads)
	}
	if _, ok := seeder.positions[7][3]; !ok {
		t.Fatalf("позиция 3 не залита: %v", seeder.positions[7])
	}
	if len(seeder.positions[7]) != 10 {
		t.Fatalf("positions = %v, ожидалось 10 занятых позиций", seeder.positions[7])
	}

	// Второй прогон — набор уже полон, ни одной новой заливки быть не должно.
	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet (2-й прогон): %v", err)
	}
	if uploads != 1 {
		t.Errorf("uploads после 2-го прогона = %d, ожидался 1 — повторный прогон не no-op, плодит дубль", uploads)
	}
	if len(seeder.stickers) != 1 {
		t.Errorf("stickers=%v — второй прогон добавил дубль", seeder.stickers)
	}
}

// Новый набор: контур из meta.json (path) едет прямо во вставку.
func TestSeedSetNewCarriesPathThumb(t *testing.T) {
	dir := t.TempDir()
	outline := base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	writeSetDirNWithPaths(t, dir, "utyaduck", 1, map[int]string{0: outline})
	seeder := newFakeSeeder()
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 0); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	got := seeder.thumbs[1][0]
	if string(got) != "\x01\x02\x03" {
		t.Fatalf("PathThumb = %v, want [1 2 3]", got)
	}
}

// Главный сценарий Task 5: набор уже полностью залит на стенде (13.5к таких
// стикеров), но path_thumb у стикеров ещё нет, потому что появилось позже.
// Повторный прогон сида обязан дописать контур существующим стикерам через
// BackfillPathThumbs — иначе поле останется пустым навсегда, ведь
// fillMissingStickers эти позиции не трогает как «уже занятые».
func TestSeedSetBackfillsExistingPathThumb(t *testing.T) {
	dir := t.TempDir()
	outline0 := base64.StdEncoding.EncodeToString([]byte{9, 9})
	outline1 := base64.StdEncoding.EncodeToString([]byte{7, 7})
	writeSetDirNWithPaths(t, dir, "utyaduck", 2, map[int]string{0: outline0, 1: outline1})
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 3, CoverMediaID: 42}
	// Оба стикера уже залиты (как на стенде) — недостающих позиций нет.
	seeder.positions[7] = map[int]struct{}{0: {}, 1: {}}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet: %v", err)
	}

	if uploads != 0 {
		t.Fatalf("uploads = %d, ожидался 0 — новых стикеров нет, только backfill", uploads)
	}
	if got := seeder.thumbs[7][0]; string(got) != "\x09\x09" {
		t.Fatalf("thumbs[0] = %v, want [9 9]", got)
	}
	if got := seeder.thumbs[7][1]; string(got) != "\x07\x07" {
		t.Fatalf("thumbs[1] = %v, want [7 7]", got)
	}
	if seeder.backfillCalls != 1 {
		t.Fatalf("backfillCalls = %d, want 1", seeder.backfillCalls)
	}

	// Второй прогон — контур уже проставлен, но seedSet всё равно должен
	// оставаться идемпотентным (не менять уже записанные значения).
	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet (2-й прогон): %v", err)
	}
	if got := seeder.thumbs[7][0]; string(got) != "\x09\x09" {
		t.Fatalf("thumbs[0] после 2-го прогона = %v, изменился", got)
	}
}

// Пустое поле path (у Telegram-документа контура не было) — не ошибка:
// BackfillPathThumbs не зовётся вовсе, если ни у одной позиции нет контура.
func TestSeedSetNoPathIsNotError(t *testing.T) {
	dir := t.TempDir()
	writeSetDirN(t, dir, "utyaduck", 1) // Path не задан
	seeder := newFakeSeeder()
	seeder.sets["utyaduck"] = domain.StickerSet{ID: 7, Slug: "utyaduck", Rank: 3, CoverMediaID: 42}
	seeder.positions[7] = map[int]struct{}{0: {}}
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 3); err != nil {
		t.Fatalf("seedSet: %v", err)
	}
	if seeder.backfillCalls != 0 {
		t.Errorf("backfillCalls = %d, want 0 — нет ни одного контура, звать Backfill незачем", seeder.backfillCalls)
	}
}

// Битый base64 в meta.json — это порча данных выгрузки, а не штатный случай
// («контура нет»), поэтому seedSet обязан упасть с ошибкой, а не проглотить её.
func TestSeedSetBadPathIsError(t *testing.T) {
	dir := t.TempDir()
	writeSetDirNWithPaths(t, dir, "utyaduck", 1, map[int]string{0: "not-base64!!"})
	seeder := newFakeSeeder()
	uploads := 0

	if err := seedSet(context.Background(), seeder, countingUpload(&uploads), dir, "utyaduck", 0); err == nil {
		t.Fatal("seedSet: want ошибку на битом base64, got nil")
	}
}
