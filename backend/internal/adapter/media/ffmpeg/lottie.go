package ffmpeg

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"strings"
)

// lottieMaxSide — верхняя граница правдоподобного размера кадра анимации.
// Заведомо больше всего, что встречается у стикеров (512x512 у Telegram),
// но отсекает мусорные значения из чужого json, случайно попавшего сюда.
const lottieMaxSide = 4096

// isLottieMime — mime, под которыми к нам приезжает lottie-анимация.
// Наш бэк раздаёт стикеры несжатым json (`application/json`); `.tgs` Telegram —
// это gzip-json, поэтому gzip-mime тоже пускаем. Пустой mime разбирается на
// общих основаниях: сам разбор дешёвый и валится на первом же не-json байте.
func isLottieMime(mime string) bool {
	switch {
	case mime == "", mime == "application/gzip", mime == "application/x-gzip":
		return true
	case mime == "application/x-tgsticker", mime == "application/x-tgs":
		return true
	case strings.HasPrefix(mime, "application/json"), strings.HasSuffix(mime, "+json"):
		return true
	}
	return false
}

// lottieHeader — единственное, что нам нужно от анимации. json.Decoder читает
// файл потоком и пропускает всё остальное, поэтому многомегабайтный стикер не
// оседает в памяти целиком.
type lottieHeader struct {
	W int `json:"w"`
	H int `json:"h"`
}

// lottieDims достаёт размеры кадра из lottie-анимации по пути path (при
// необходимости распаковывая gzip). ok=false — это «не lottie либо размеров нет»,
// и вызывающий просто оставляет размеры ненайденными: ffprobe про такой файл
// ничего не знает, а пустые поля ProcessResult ничего не затирают.
func lottieDims(path string) (w, h int, ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()

	var src io.Reader = f
	magic := make([]byte, 2)
	if n, _ := io.ReadFull(f, magic); n == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return 0, 0, false
		}
		zr, err := gzip.NewReader(f)
		if err != nil {
			return 0, 0, false
		}
		defer zr.Close()
		src = zr
	} else if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}

	var head lottieHeader
	if err := json.NewDecoder(src).Decode(&head); err != nil {
		return 0, 0, false
	}
	if head.W <= 0 || head.H <= 0 || head.W > lottieMaxSide || head.H > lottieMaxSide {
		return 0, 0, false
	}
	return head.W, head.H, true
}
