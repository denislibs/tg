package main

import (
	"os"
	"path/filepath"
	"testing"
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
