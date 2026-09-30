package imagecrop

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

var (
	blue  = color.RGBA{0, 0, 255, 255}
	green = color.RGBA{0, 255, 0, 255}
	red   = color.RGBA{255, 0, 0, 255}
)

// halves — картинка w×h: при vertical верхняя половина a, нижняя b, иначе
// левая a, правая b.
func halves(w, h int, vertical bool, a, b color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := b
			if (vertical && y < h/2) || (!vertical && x < w/2) {
				c = a
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// withOrientation вклеивает сразу за SOI сегмент APP1 «Exif» с одним тегом
// Orientation (0x0112) в IFD0 — так его пишут камеры телефонов.
func withOrientation(jpg []byte, orientation uint16) []byte {
	var tiff bytes.Buffer
	tiff.WriteString("MM")
	_ = binary.Write(&tiff, binary.BigEndian, uint16(42))
	_ = binary.Write(&tiff, binary.BigEndian, uint32(8)) // IFD0 сразу за заголовком
	_ = binary.Write(&tiff, binary.BigEndian, uint16(1)) // одна запись
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0x0112))
	_ = binary.Write(&tiff, binary.BigEndian, uint16(3)) // SHORT
	_ = binary.Write(&tiff, binary.BigEndian, uint32(1))
	_ = binary.Write(&tiff, binary.BigEndian, orientation)
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0))
	_ = binary.Write(&tiff, binary.BigEndian, uint32(0)) // следующего IFD нет
	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)

	var out bytes.Buffer
	out.Write(jpg[:2]) // SOI
	out.Write([]byte{0xFF, 0xE1})
	_ = binary.Write(&out, binary.BigEndian, uint16(len(payload)+2))
	out.Write(payload)
	out.Write(jpg[2:])
	return out.Bytes()
}

func decode(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("результат не JPEG: %v", err)
	}
	return img
}

// near — цвет пикселя совпадает с want с допуском JPEG-сжатия.
func near(t *testing.T, img image.Image, x, y int, want color.RGBA, what string) {
	t.Helper()
	r, g, b, _ := img.At(x, y).RGBA()
	d := func(a uint32, w uint8) int {
		v := int(a>>8) - int(w)
		if v < 0 {
			v = -v
		}
		return v
	}
	if d(r, want.R) > 40 || d(g, want.G) > 40 || d(b, want.B) > 40 {
		t.Fatalf("%s: пиксель (%d,%d) = %v,%v,%v; want %v", what, x, y, r>>8, g>>8, b>>8, want)
	}
}

// Фото профиля у Telegram квадратное: неквадратный исходник обрезается по
// центру в квадрат по меньшей стороне (tweb кадрирует его на клиенте в
// PopupAvatar, сервер Telegram хранит только квадрат). Портрет 40×80 с
// четвертями красный/синий/зелёный/красный по высоте → квадрат 40×40 из
// средней половины: сверху синий, снизу зелёный.
func TestCropSquare_PortraitCenter(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 40, 80))
	for y := 0; y < 80; y++ {
		c := []color.RGBA{red, blue, green, red}[y/20]
		for x := 0; x < 40; x++ {
			img.Set(x, y, c)
		}
	}
	out, side, err := Cropper{}.CropSquare(bytes.NewReader(encodeJPEG(t, img)), "image/jpeg")
	if err != nil || out == nil {
		t.Fatalf("CropSquare: out=%v err=%v", out != nil, err)
	}
	got := decode(t, out)
	if side != 40 || got.Bounds().Dx() != 40 || got.Bounds().Dy() != 40 {
		t.Fatalf("side=%d bounds=%v; want 40×40", side, got.Bounds())
	}
	near(t, got, 20, 5, blue, "верх квадрата")
	near(t, got, 20, 34, green, "низ квадрата")
}

func TestCropSquare_LandscapePNG(t *testing.T) {
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 80, 40))
	for x := 0; x < 80; x++ {
		c := []color.RGBA{red, blue, green, red}[x/20]
		for y := 0; y < 40; y++ {
			img.Set(x, y, c)
		}
	}
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, side, err := Cropper{}.CropSquare(&buf, "image/png")
	if err != nil || out == nil || side != 40 {
		t.Fatalf("CropSquare png: out=%v side=%d err=%v", out != nil, side, err)
	}
	got := decode(t, out)
	near(t, got, 5, 20, blue, "левый край")
	near(t, got, 34, 20, green, "правый край")
}

// Фото с камеры телефона: пиксели лежат «лёжа», а вертикаль задаёт EXIF
// Orientation — браузер (и превью в чате) показывает его повёрнутым. Кроп
// обязан резать то, что видит человек, иначе аватар встанет на бок.
// Сырые 60×40: слева синий, справа зелёный; Orientation=6 (поворот на 90° по
// часовой) → на экране 40×60, синий сверху, зелёный снизу.
func TestCropSquare_HonoursEXIFOrientation(t *testing.T) {
	raw := encodeJPEG(t, halves(60, 40, false, blue, green))
	out, side, err := Cropper{}.CropSquare(bytes.NewReader(withOrientation(raw, 6)), "image/jpeg")
	if err != nil || out == nil || side != 40 {
		t.Fatalf("CropSquare: out=%v side=%d err=%v", out != nil, side, err)
	}
	got := decode(t, out)
	near(t, got, 5, 5, blue, "верх-лево")
	near(t, got, 34, 5, blue, "верх-право")
	near(t, got, 5, 34, green, "низ-лево")
}

// Ориентации 1..8 → размеры и угол, который человек видит сверху-слева.
func TestCropSquare_AllOrientations(t *testing.T) {
	// Сырые 60×40, четыре угла разного цвета: TL красный, TR синий, BL зелёный,
	// BR белый. Для каждой ориентации — какой сырой угол оказывается на экране
	// сверху-слева.
	white := color.RGBA{255, 255, 255, 255}
	img := image.NewRGBA(image.Rect(0, 0, 60, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 60; x++ {
			switch {
			case x < 30 && y < 20:
				img.Set(x, y, red)
			case y < 20:
				img.Set(x, y, blue)
			case x < 30:
				img.Set(x, y, green)
			default:
				img.Set(x, y, white)
			}
		}
	}
	raw := encodeJPEG(t, img)
	topLeft := map[uint16]color.RGBA{1: red, 2: blue, 3: white, 4: green, 5: red, 6: green, 7: white, 8: blue}
	for o, want := range topLeft {
		out, side, err := Cropper{}.CropSquare(bytes.NewReader(withOrientation(raw, o)), "image/jpeg")
		if err != nil || out == nil || side != 40 {
			t.Fatalf("orientation %d: out=%v side=%d err=%v", o, out != nil, side, err)
		}
		near(t, decode(t, out), 2, 2, want, "orientation "+string(rune('0'+o)))
	}
}

// Уже квадратное фото и то, что кропом не декодируется, не трогаются:
// nil — «оставить исходник как есть».
func TestCropSquare_NoOp(t *testing.T) {
	square := encodeJPEG(t, halves(40, 40, true, blue, green))
	if out, _, err := (Cropper{}).CropSquare(bytes.NewReader(square), "image/jpeg"); out != nil || err != nil {
		t.Fatalf("квадрат: out=%v err=%v; want nil,nil", out != nil, err)
	}
	if out, _, err := (Cropper{}).CropSquare(bytes.NewReader([]byte("GIF89a")), "image/gif"); out != nil || err != nil {
		t.Fatalf("gif: out=%v err=%v; want nil,nil", out != nil, err)
	}
	if out, _, err := (Cropper{}).CropSquare(bytes.NewReader([]byte("RIFF....WEBP")), "image/webp"); out != nil || err != nil {
		t.Fatalf("webp: out=%v err=%v; want nil,nil", out != nil, err)
	}
}
