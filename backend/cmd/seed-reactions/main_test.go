package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// reactions.json — индекс выгрузки (tools/fetch_stickers.py --reactions):
// какой файл какой роли соответствует.
func TestLoadIndex(t *testing.T) {
	dir := t.TempDir()
	body := `[{"reaction":"❤","title":"Red Heart","slug":"2764","premium":false,"inactive":false,
	           "files":{"static":"static.webp","select":"select.tgs","around":"around.tgs"}}]`
	if err := os.WriteFile(filepath.Join(dir, "reactions.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	list, err := loadIndex(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("реакций %d, ожидалась 1", len(list))
	}
	if list[0].Reaction != "❤" || list[0].Files["select"] != "select.tgs" {
		t.Errorf("разобрано неверно: %+v", list[0])
	}
}

// reactionMime решает Content-Type файла роли реакции: у выгрузки реакций
// только два формата, в отличие от стикеров (see stickerMime в seed-stickers).
func TestReactionMime(t *testing.T) {
	cases := map[string]string{
		"static.webp": "image/webp",
		"select.TGS":  "application/x-tgsticker",
		"around.tgs":  "application/x-tgsticker",
	}
	for file, want := range cases {
		got, err := reactionMime(file)
		if err != nil {
			t.Errorf("reactionMime(%q): %v", file, err)
			continue
		}
		if got != want {
			t.Errorf("reactionMime(%q) = %q, want %q", file, got, want)
		}
	}

	if _, err := reactionMime("cover.png"); err == nil {
		t.Error("reactionMime(cover.png) должна вернуть ошибку — такого расширения выгрузка реакций не производит")
	}
}

// fakeReactionsRepo — reactionsRepo в памяти: List отдаёт то, что уже «залито»
// (для проверки идемпотентности), Upsert копит записи, которые сид реально
// отправил в БД.
type fakeReactionsRepo struct {
	existing []domain.AvailableReaction
	upserted []domain.AvailableReaction
}

func (f *fakeReactionsRepo) List(_ context.Context) ([]domain.AvailableReaction, error) {
	return f.existing, nil
}

func (f *fakeReactionsRepo) Upsert(_ context.Context, rc domain.AvailableReaction) error {
	f.upserted = append(f.upserted, rc)
	return nil
}

// recordingUpload — заливка-счётчик, которая ещё и запоминает путь каждого
// вызова: нужно проверить, что заливаются только присутствующие в files роли,
// а не воображаемые.
func recordingUpload(paths *[]string) uploadFunc {
	n := 0
	return func(_ context.Context, path string) (int64, error) {
		n++
		*paths = append(*paths, path)
		return int64(100 + n), nil
	}
}

// writeReactionsDir раскладывает каталог реакций так же, как это делает
// tools/fetch_stickers.py --reactions: reactions.json в корне + файлы ролей в
// <slug>/.
func writeReactionsDir(t *testing.T, dir string, entries []reactionEntry) {
	t.Helper()
	for _, e := range entries {
		sub := filepath.Join(dir, e.Slug)
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, file := range e.Files {
			ext := filepath.Ext(file)
			content := []byte("x")
			if ext == ".webp" {
				content = []byte("y")
			}
			if err := os.WriteFile(filepath.Join(sub, file), content, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	raw, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "reactions.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// Новая реакция: заливаются ровно присутствующие в files роли, позиция —
// индекс в reactions.json, отсутствующие роли остаются нулями.
func TestSeedReactionsNewEntry(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "❤", Title: "Red Heart", Slug: "2764",
		Files: map[string]string{"static": "static.webp", "select": "select.tgs", "around": "around.tgs"},
	}}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 3 {
		t.Fatalf("заливок = %d, ожидалось 3 (static+select+around): %v", len(paths), paths)
	}
	if len(repo.upserted) != 1 {
		t.Fatalf("upsert-ов = %d, ожидался 1", len(repo.upserted))
	}
	got := repo.upserted[0]
	if got.Emoji != "❤" || got.Position != 0 {
		t.Errorf("emoji/position = %q/%d, ожидалось ❤/0", got.Emoji, got.Position)
	}
	if got.StaticMediaID == 0 || got.SelectMediaID == 0 || got.AroundMediaID == 0 {
		t.Errorf("не все присутствующие роли заполнены: %+v", got)
	}
	if got.AppearMediaID != 0 || got.ActivateMediaID != 0 || got.EffectMediaID != 0 || got.CenterMediaID != 0 {
		t.Errorf("отсутствующие в files роли не должны заполняться: %+v", got)
	}
}

// Позиция реакций — это её индекс в reactions.json, а не в алфавите/emoji.
func TestSeedReactionsPositionFollowsIndexOrder(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{
		{Reaction: "🔥", Title: "Fire", Slug: "1f525", Files: map[string]string{"static": "static.webp"}},
		{Reaction: "❤", Title: "Red Heart", Slug: "2764", Files: map[string]string{"static": "static.webp"}},
	}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(repo.upserted) != 2 {
		t.Fatalf("upsert-ов = %d, ожидалось 2", len(repo.upserted))
	}
	if repo.upserted[0].Emoji != "🔥" || repo.upserted[0].Position != 0 {
		t.Errorf("первая запись = %+v, ожидалась 🔥/0", repo.upserted[0])
	}
	if repo.upserted[1].Emoji != "❤" || repo.upserted[1].Position != 1 {
		t.Errorf("вторая запись = %+v, ожидалась ❤/1", repo.upserted[1])
	}
}

// Идемпотентность: реакция с уже проставленным static_media_id пропускается
// целиком — повторный прогон не должен ни заливать файлы заново (дубли в
// MinIO), ни звать Upsert.
func TestSeedReactionsSkipsAlreadySeeded(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "❤", Title: "Red Heart", Slug: "2764",
		Files: map[string]string{"static": "static.webp", "select": "select.tgs"},
	}}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{existing: []domain.AvailableReaction{{Emoji: "❤", StaticMediaID: 42}}}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 0 {
		t.Errorf("заливок = %d, ожидалось 0 — реакция уже засеяна", len(paths))
	}
	if len(repo.upserted) != 0 {
		t.Errorf("upsert-ов = %d, ожидалось 0 — реакция уже засеяна", len(repo.upserted))
	}
}

// Реакция, у которой в БД есть строка, но без static_media_id (прерванный
// прогон до неё не дошёл), не считается засеянной — досеивается заново, а не
// пропускается навсегда.
func TestSeedReactionsRetriesIncompleteEntry(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "🔥", Title: "Fire", Slug: "1f525",
		Files: map[string]string{"static": "static.webp"},
	}}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{existing: []domain.AvailableReaction{{Emoji: "🔥", Title: "Fire", Position: 0}}}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 1 {
		t.Errorf("заливок = %d, ожидалась 1 — незасеянная реакция должна досеяться", len(paths))
	}
	if len(repo.upserted) != 1 {
		t.Errorf("upsert-ов = %d, ожидался 1", len(repo.upserted))
	}
}
