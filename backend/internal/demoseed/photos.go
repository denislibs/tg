package demoseed

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
)

// Картинки для демо-постов рисуются здесь, а не тянутся из сети: стенду нужен
// не «настоящий» кадр, а настоящий путь медиа — объект в MinIO, строка media,
// размеры и blur_preview, посчитанные тем же фоновым процессингом.

// palette — пары цветов (верх/низ) вертикальной заливки.
var palette = [][2]color.RGBA{
	{{R: 32, G: 64, B: 120, A: 255}, {R: 96, G: 168, B: 214, A: 255}},
	{{R: 120, G: 40, B: 60, A: 255}, {R: 220, G: 132, B: 96, A: 255}},
	{{R: 26, G: 88, B: 66, A: 255}, {R: 148, G: 196, B: 108, A: 255}},
	{{R: 70, G: 44, B: 110, A: 255}, {R: 186, G: 140, B: 214, A: 255}},
	{{R: 128, G: 96, B: 24, A: 255}, {R: 226, G: 200, B: 110, A: 255}},
	{{R: 34, G: 34, B: 42, A: 255}, {R: 130, G: 138, B: 152, A: 255}},
}

const (
	photoWidth  = 1280
	photoHeight = 720
)

// drawPhoto рисует JPEG-заглушку: вертикальный градиент плюс несколько
// прямоугольников, чтобы соседние картинки не сливались в одну. Возвращает
// байты и размеры оригинала.
func drawPhoto(idx int) ([]byte, int, int, error) {
	p := palette[((idx%len(palette))+len(palette))%len(palette)]
	img := image.NewRGBA(image.Rect(0, 0, photoWidth, photoHeight))
	for y := 0; y < photoHeight; y++ {
		t := float64(y) / float64(photoHeight-1)
		c := color.RGBA{
			R: mix(p[0].R, p[1].R, t),
			G: mix(p[0].G, p[1].G, t),
			B: mix(p[0].B, p[1].B, t),
			A: 255,
		}
		draw.Draw(img, image.Rect(0, y, photoWidth, y+1), image.NewUniform(c), image.Point{}, draw.Src)
	}
	bars := 3 + idx%4
	accent := color.RGBA{R: 255, G: 255, B: 255, A: 40}
	for i := 0; i < bars; i++ {
		x := 80 + i*(photoWidth-160)/bars
		top := 120 + (i*97)%320
		draw.Draw(img, image.Rect(x, top, x+90, photoHeight-100), image.NewUniform(accent), image.Point{}, draw.Over)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 82}); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), photoWidth, photoHeight, nil
}

func mix(a, b uint8, t float64) uint8 {
	return uint8(float64(a)*(1-t) + float64(b)*t)
}
