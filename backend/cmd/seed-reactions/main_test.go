package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
// индекс в reactions.json, отсутствующие роли остаются нулями. Upsert зовётся
// после КАЖДОЙ роли (не один раз в конце) — так прогресс сохраняется
// инкрементально (см. TestSeedReactionsFailureMidRolesIsRecoverable).
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
	if len(repo.upserted) != 3 {
		t.Fatalf("upsert-ов = %d, ожидалось 3 — по одному после каждой залитой роли", len(repo.upserted))
	}
	got := repo.upserted[len(repo.upserted)-1]
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

// Строгий no-op: реакция, у которой ВСЕ роли из files уже проставлены в БД,
// пропускается целиком на повторном прогоне — ни заливок, ни Upsert-ов.
func TestSeedReactionsSkipsFullyLoadedEntry(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "❤", Title: "Red Heart", Slug: "2764",
		Files: map[string]string{"static": "static.webp", "select": "select.tgs"},
	}}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{existing: []domain.AvailableReaction{
		{Emoji: "❤", Title: "Red Heart", StaticMediaID: 42, SelectMediaID: 43},
	}}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 0 {
		t.Errorf("заливок = %d, ожидалось 0 — все роли реакции уже залиты", len(paths))
	}
	if len(repo.upserted) != 0 {
		t.Errorf("upsert-ов = %d, ожидалось 0 — реакция уже полностью такая, как в индексе", len(repo.upserted))
	}
}

// Ре-ревью R2: у полностью залитой реакции (все роли на месте, заливать
// нечего) Position/Title обязаны догнать reactions.json — Telegram меняет
// порядок пикера, и без этой синхронизации реакция навсегда застревала бы на
// позиции первой заливки. Прямой аналог rank у cmd/seed-stickers.
func TestSeedReactionsSyncsMetadataOfFullyLoadedEntry(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{
		{Reaction: "🔥", Title: "Fire", Slug: "1f525", Files: map[string]string{"static": "static.webp"}},
		// ❤ теперь на позиции 1 (была 0) и с новым заголовком — как будто
		// Telegram переставил пикер и переименовал реакцию.
		{Reaction: "❤", Title: "Red Heart NEW", Slug: "2764", Files: map[string]string{"static": "static.webp"}},
	}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{existing: []domain.AvailableReaction{
		{Emoji: "🔥", Title: "Fire", Position: 1, StaticMediaID: 10},
		{Emoji: "❤", Title: "Red Heart", Position: 0, StaticMediaID: 42},
	}}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 0 {
		t.Fatalf("заливок = %d, ожидалось 0 — все роли уже были залиты, менялись только метаданные: %v", len(paths), paths)
	}
	if len(repo.upserted) != 2 {
		t.Fatalf("upsert-ов = %d, ожидалось 2 — у обеих реакций разошлись метаданные", len(repo.upserted))
	}

	byEmoji := map[string]domain.AvailableReaction{}
	for _, rc := range repo.upserted {
		byEmoji[rc.Emoji] = rc
	}
	fire := byEmoji["🔥"]
	if fire.Position != 0 || fire.StaticMediaID != 10 {
		t.Errorf("🔥: %+v — позиция должна обновиться на 0, static остаться прежним (10)", fire)
	}
	heart := byEmoji["❤"]
	if heart.Position != 1 || heart.Title != "Red Heart NEW" || heart.StaticMediaID != 42 {
		t.Errorf("❤: %+v — позиция 1, новый заголовок, static прежний (42), без перезаливки", heart)
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

// Ревью R2, находка Important 2: реакция, у которой прошлый прогон залил
// только часть ролей (например, потому что API в тот момент не отдал
// остальные — REACTION_ROLES в tools/fetch_stickers.py молча пропускает
// отсутствующую роль), должна дозаливать именно недостающие роли на
// следующем прогоне, а не считаться готовой из-за одного static_media_id.
func TestSeedReactionsFillsMissingRoleOfPartiallySeededEntry(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "❤", Title: "Red Heart", Slug: "2764",
		Files: map[string]string{"static": "static.webp", "select": "select.tgs", "around": "around.tgs"},
	}}
	writeReactionsDir(t, dir, entries)
	// В прошлый раз выгрузка принесла только static — select/around появились
	// в API позже.
	repo := &fakeReactionsRepo{existing: []domain.AvailableReaction{{Emoji: "❤", Title: "Red Heart", StaticMediaID: 42}}}
	var paths []string

	if err := seedReactions(context.Background(), repo, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions: %v", err)
	}

	if len(paths) != 2 {
		t.Fatalf("заливок = %d, ожидалось 2 (select+around, static не трогаем): %v", len(paths), paths)
	}
	for _, p := range paths {
		if strings.Contains(p, "static") {
			t.Errorf("уже залитая роль static перезалита: %v", paths)
		}
	}
	final := repo.upserted[len(repo.upserted)-1]
	if final.StaticMediaID != 42 {
		t.Errorf("static media id изменился при дозаливке: было 42, стало %d", final.StaticMediaID)
	}
	if final.SelectMediaID == 0 || final.AroundMediaID == 0 {
		t.Errorf("недостающие роли не долиты: %+v", final)
	}
}

// Ревью R2, находка Important 1: сбой заливки посреди ролей одной реакции не
// должен ни оставлять сирот в MinIO (уже залитая роль сохранена в БД сразу
// после заливки, а не одним Upsert в конце всей реакции), ни блокировать её
// навсегда — на следующем прогоне недостающие роли доливаются, а уже залитая
// не трогается.
func TestSeedReactionsFailureMidRolesIsRecoverable(t *testing.T) {
	dir := t.TempDir()
	entries := []reactionEntry{{
		Reaction: "❤", Title: "Red Heart", Slug: "2764",
		Files: map[string]string{"static": "static.webp", "select": "select.tgs", "around": "around.tgs"},
	}}
	writeReactionsDir(t, dir, entries)
	repo := &fakeReactionsRepo{}

	// Первый прогон: заливка падает ровно на роли "select" (второй по порядку
	// reactionRoles после static).
	failingUpload := func(_ context.Context, path string) (int64, error) {
		if strings.Contains(path, "select") {
			return 0, errors.New("сеть моргнула")
		}
		return 101, nil
	}
	if err := seedReactions(context.Background(), repo, failingUpload, dir, entries); err == nil {
		t.Fatal("ожидалась ошибка заливки роли select")
	}

	// Не сирота: уже залитая роль static сохранена в БД ровно один раз, без
	// незалитых до конца ролей, «зависших» без ссылки в media/MinIO.
	if len(repo.upserted) != 1 {
		t.Fatalf("upsert-ов после сбоя = %d, ожидался 1 (только static, сохранённая сразу после заливки)", len(repo.upserted))
	}
	saved := repo.upserted[0]
	if saved.StaticMediaID == 0 {
		t.Error("static не сохранён сразу после заливки — на следующем прогоне он будет залит повторно (сирота множится)")
	}
	if saved.SelectMediaID != 0 || saved.AroundMediaID != 0 {
		t.Errorf("незалитые роли не должны попасть в сохранённую строку: %+v", saved)
	}

	// Второй прогон подаёт состояние БД после первого (static уже есть),
	// заливка теперь без сбоев.
	repo2 := &fakeReactionsRepo{existing: []domain.AvailableReaction{saved}}
	var paths []string
	if err := seedReactions(context.Background(), repo2, recordingUpload(&paths), dir, entries); err != nil {
		t.Fatalf("seedReactions (2-й прогон): %v", err)
	}

	// Долиты ровно недостающие роли — select и around, static не трогали.
	if len(paths) != 2 {
		t.Fatalf("заливок на 2-м прогоне = %d, ожидалось 2 (select+around): %v", len(paths), paths)
	}
	for _, p := range paths {
		if strings.Contains(p, "static") {
			t.Errorf("static перезалит повторно: %v", paths)
		}
	}
	final := repo2.upserted[len(repo2.upserted)-1]
	if final.StaticMediaID != saved.StaticMediaID {
		t.Errorf("static media id изменился при досидировании: было %d, стало %d", saved.StaticMediaID, final.StaticMediaID)
	}
	if final.SelectMediaID == 0 || final.AroundMediaID == 0 {
		t.Errorf("недостающие роли не долиты: %+v", final)
	}
}
