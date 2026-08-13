package ffmpeg

import (
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTemp кладёт байты во временный файл и отдаёт путь (lottieDims читает файл,
// как и остальной процессинг — оригинал уже лежит на диске).
func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	return path
}

func gzipped(t *testing.T, s string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(s)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

// lottieDims достаёт w/h из хедера lottie-анимации: ffprobe про .tgs/json ничего
// не знает, а без размеров фронт не может вписать стикер в бокс (aspectFitted).
func TestLottieDims(t *testing.T) {
	const anim = `{"v":"5.5.7","fr":60,"ip":0,"op":180,"w":512,"h":512,"nm":"s","layers":[]}`

	tests := []struct {
		name       string
		data       []byte
		wantW      int
		wantH      int
		wantParsed bool
	}{
		{name: "обычный lottie-json", data: []byte(anim), wantW: 512, wantH: 512, wantParsed: true},
		{name: "gzip (.tgs)", data: gzipped(t, anim), wantW: 512, wantH: 512, wantParsed: true},
		{
			name:  "порядок ключей произвольный, w/h в конце",
			data:  []byte(`{"layers":[{"ty":4,"nm":"x"}],"v":"5.5.7","w":256,"h":128}`),
			wantW: 256, wantH: 128, wantParsed: true,
		},
		{name: "не json", data: []byte("\x89PNG\r\n"), wantParsed: false},
		{name: "json без размеров", data: []byte(`{"v":"5.5.7","layers":[]}`), wantParsed: false},
		{name: "нулевые размеры не считаются найденными", data: []byte(`{"w":0,"h":0}`), wantParsed: false},
		{name: "неправдоподобные размеры отбрасываются", data: []byte(`{"w":100000,"h":512}`), wantParsed: false},
		{name: "обрезанный файл", data: []byte(`{"v":"5.5.7","w":512`), wantParsed: false},
		{name: "пустой файл", data: []byte{}, wantParsed: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, h, ok := lottieDims(writeTemp(t, "anim", tt.data))
			if ok != tt.wantParsed {
				t.Fatalf("lottieDims ok = %v, want %v", ok, tt.wantParsed)
			}
			if ok && (w != tt.wantW || h != tt.wantH) {
				t.Fatalf("lottieDims = %dx%d, want %dx%d", w, h, tt.wantW, tt.wantH)
			}
		})
	}
}

// Огромный json не должен утащить в память весь файл целиком: декодер читает
// потоком и держит только два числа.
func TestLottieDimsLargeFile(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"w":480,"h":320,"layers":[`)
	for i := 0; i < 20000; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"ty":4,"nm":"layer","ks":{"o":{"a":0,"k":100}}}`)
	}
	b.WriteString(`]}`)

	w, h, ok := lottieDims(writeTemp(t, "big.json", []byte(b.String())))
	if !ok || w != 480 || h != 320 {
		t.Fatalf("lottieDims = %dx%d ok=%v, want 480x320 ok=true", w, h, ok)
	}
}

// Process для lottie-стикера обязан вернуть размеры: ffprobe их не даёт, и без
// этой ветки стикер приезжает на фронт с width=height=0.
func TestProcessLottieDimensions(t *testing.T) {
	const anim = `{"v":"5.5.7","fr":60,"ip":0,"op":180,"w":512,"h":384,"layers":[]}`

	for _, mime := range []string{"application/json", "application/gzip", "application/x-tgsticker", ""} {
		t.Run("mime="+mime, func(t *testing.T) {
			src := []byte(anim)
			if mime != "application/json" {
				src = gzipped(t, anim)
			}
			res, err := (&Processor{}).Process(context.Background(), bytes.NewReader(src), mime)
			if err != nil {
				t.Fatalf("Process: %v", err)
			}
			if res.Width != 512 || res.Height != 384 {
				t.Fatalf("Process = %dx%d, want 512x384", res.Width, res.Height)
			}
			if len(res.Thumb) != 0 || len(res.Stripped) != 0 {
				t.Fatalf("lottie не растеризуется на бэке, а превью сгенерированы")
			}
		})
	}
}

// Картинки/видео разбираются по-прежнему через ffprobe — lottie-ветка не должна
// перехватывать чужие mime и не должна затирать уже найденные размеры.
func TestProcessImageMimeUnaffected(t *testing.T) {
	// Файл заведомо не lottie: если бы ветка сработала, размеры бы не изменились,
	// но и упасть она не имеет права.
	res, err := (&Processor{}).Process(context.Background(), bytes.NewReader([]byte("\x89PNG\r\n\x1a\n")), "image/png")
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Width != 0 || res.Height != 0 {
		t.Fatalf("битый png дал размеры %dx%d, want 0x0", res.Width, res.Height)
	}
}
