package main

import "testing"

// stickerMime решает, с каким Content-Type файл ляжет в media: по нему фронт
// выбирает движок (lottie/видео/картинка), поэтому ошибка здесь ломает рендер.
func TestStickerMime(t *testing.T) {
	cases := map[string]string{
		"1.tgs":   "application/x-tgsticker",
		"1.TGS":   "application/x-tgsticker",
		"2.webm":  "video/webm",
		"3.webp":  "image/webp",
		"4.png":   "image/png",
		"5.json":  "application/json",
		"cover.tgs": "application/x-tgsticker",
	}
	for file, want := range cases {
		if got := stickerMime(file); got != want {
			t.Errorf("stickerMime(%q) = %q, want %q", file, got, want)
		}
	}
}
