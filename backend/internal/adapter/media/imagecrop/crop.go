// Package imagecrop реализует порт media.SquareCropper: центральный кроп фото
// профиля в квадрат.
//
// Telegram хранит фото профиля квадратным: tweb кадрирует выбранный файл на
// клиенте (PopupAvatar → canvas), а все размеры фото пира на сервере —
// квадраты. Маленькие аватарки tweb рисует без object-fit (`.avatar-photo` в
// `_avatar.scss` — cover только у `.avatar-full`), поэтому неквадратный
// исходник в строке чата и шапке сплющивается. Сервер обязан хранить квадрат
// сам — независимо от того, кадрировал ли его клиент.
//
// Чистый Go (image/jpeg, image/png), без ffmpeg: кроп обязан резать то, что
// видит человек, а у фото с камеры телефона вертикаль задаёт EXIF Orientation,
// которую декодер стандартной библиотеки игнорирует, — она применяется здесь.
package imagecrop

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png" // регистрирует декодер PNG для image.Decode
	"io"
)

// jpegQuality — качество пережатого квадрата.
const jpegQuality = 90

// maxPixels — предохранитель от декомпрессионной бомбы: больше не декодируем
// (клиент и так ужимает сторону до 2560, tweb scaleImageForTelegram).
const maxPixels = 40_000_000

// Cropper — нулевое значение готово к работе.
type Cropper struct{}

// CropSquare режет изображение по центру в квадрат по меньшей (видимой)
// стороне и отдаёт JPEG со стороной side. nil без ошибки — «трогать нечего»:
// уже квадрат, формат не поддержан (gif — анимация, webp/heic — не наш
// декодер) или картинка слишком большая.
func (Cropper) CropSquare(src io.Reader, mime string) ([]byte, int, error) {
	if mime != "image/jpeg" && mime != "image/png" {
		return nil, 0, nil
	}
	raw, err := io.ReadAll(src)
	if err != nil {
		return nil, 0, err
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPixels {
		return nil, 0, nil
	}
	if cfg.Width == cfg.Height {
		return nil, 0, nil
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, 0, nil
	}
	orientation := 1
	if mime == "image/jpeg" {
		orientation = exifOrientation(raw)
	}
	out := cropOriented(img, orientation)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, 0, err
	}
	return buf.Bytes(), out.Bounds().Dx(), nil
}

// cropOriented — центральный квадрат изображения в том виде, в каком его
// показывает EXIF Orientation (1..8, TIFF 6.0 / EXIF 2.3).
func cropOriented(src image.Image, orientation int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dispW, dispH := w, h
	if orientation >= 5 && orientation <= 8 {
		dispW, dispH = h, w
	}
	side := min(dispW, dispH)
	ox, oy := (dispW-side)/2, (dispH-side)/2
	out := image.NewRGBA(image.Rect(0, 0, side, side))
	if orientation < 2 || orientation > 8 {
		draw.Draw(out, out.Bounds(), src, image.Pt(b.Min.X+ox, b.Min.Y+oy), draw.Src)
		return out
	}
	for j := 0; j < side; j++ {
		for i := 0; i < side; i++ {
			dx, dy := ox+i, oy+j
			var x, y int
			switch orientation {
			case 2: // зеркало по горизонтали
				x, y = w-1-dx, dy
			case 3: // поворот на 180°
				x, y = w-1-dx, h-1-dy
			case 4: // зеркало по вертикали
				x, y = dx, h-1-dy
			case 5: // транспонирование
				x, y = dy, dx
			case 6: // поворот на 90° по часовой
				x, y = dy, h-1-dx
			case 7: // антитранспонирование
				x, y = w-1-dy, h-1-dx
			case 8: // поворот на 90° против часовой
				x, y = w-1-dy, dx
			}
			out.Set(i, j, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return out
}

// exifOrientation читает тег Orientation (0x0112) из IFD0 сегмента APP1
// «Exif». 1 — тега нет или он нечитаем.
func exifOrientation(jpg []byte) int {
	r := bufio.NewReader(bytes.NewReader(jpg))
	var soi [2]byte
	if _, err := io.ReadFull(r, soi[:]); err != nil || soi[0] != 0xFF || soi[1] != 0xD8 {
		return 1
	}
	for {
		var hdr [4]byte
		if _, err := io.ReadFull(r, hdr[:2]); err != nil || hdr[0] != 0xFF {
			return 1
		}
		marker := hdr[1]
		if marker == 0xDA || marker == 0xD9 { // SOS/EOI — метаданные кончились
			return 1
		}
		if _, err := io.ReadFull(r, hdr[2:]); err != nil {
			return 1
		}
		n := int(binary.BigEndian.Uint16(hdr[2:])) - 2
		if n < 0 {
			return 1
		}
		seg := make([]byte, n)
		if _, err := io.ReadFull(r, seg); err != nil {
			return 1
		}
		if marker == 0xE1 && bytes.HasPrefix(seg, []byte("Exif\x00\x00")) {
			return tiffOrientation(seg[6:])
		}
	}
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	off := int(bo.Uint32(t[4:8]))
	if off < 0 || off+2 > len(t) {
		return 1
	}
	count := int(bo.Uint16(t[off:]))
	for k := 0; k < count; k++ {
		e := off + 2 + 12*k
		if e+12 > len(t) {
			return 1
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			if v := int(bo.Uint16(t[e+8:])); v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}
