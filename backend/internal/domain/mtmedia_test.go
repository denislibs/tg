package domain_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// wire — вложение, сериализованное так же, как его увидит клиент.
func wire(t *testing.T, s domain.MediaSource) map[string]any {
	t.Helper()
	b, err := json.Marshal(domain.BuildMessageMedia(s))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

// Правило фазы 0: булев флаг схемы (flags.N?true) присутствует ТОЛЬКО когда
// включён и всегда равен true. `false` на проводе означал бы, что бит выставлен,
// — на фазе бинарного кодека это прямое расхождение, а до неё портируемый код
// оригинала (`pFlags.round_message`, `pFlags.voice`, `pFlags.spoiler`) читает
// именно присутствие ключа.
func TestPFlagsNeverFalse(t *testing.T) {
	for _, s := range []domain.MediaSource{
		{Kind: "photo", MediaID: 1, Width: 10, Height: 10},
		{Kind: "photo", MediaID: 1, Width: 10, Height: 10, Spoiler: true},
		{Kind: "video", MediaID: 1, Width: 10, Height: 10, Duration: 5},
		{Kind: "round", MediaID: 1, Width: 10, Height: 10, Duration: 5},
		{Kind: "voice", MediaID: 1, Duration: 5},
		{Kind: "audio", MediaID: 1, Duration: 5},
		{Kind: "sticker", MediaID: 1, Width: 512, Height: 512},
		{Kind: "document", MediaID: 1, FileName: "a.bin"},
	} {
		b, _ := json.Marshal(domain.BuildMessageMedia(s))
		var walk func(v any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				if pf, ok := x["pFlags"].(map[string]any); ok {
					if len(pf) == 0 {
						t.Fatalf("%s: пустой pFlags сериализован — должен отсутствовать: %s", s.Kind, b)
					}
					for k, val := range pf {
						if val != true {
							t.Fatalf("%s: pFlags[%q] = %v, а «выключено» — это отсутствие ключа: %s", s.Kind, k, val, b)
						}
					}
				}
				for _, v2 := range x {
					walk(v2)
				}
			case []any:
				for _, v2 := range x {
					walk(v2)
				}
			}
		}
		var parsed any
		_ = json.Unmarshal(b, &parsed)
		walk(parsed)
	}
}

// Поля `flags` в объекте нет вовсе: битовая маска живёт только на проводе TL и
// считается кодеком из присутствия полей. Если она просочится в модель, на
// фазе 2 появится второй, расходящийся источник необязательности.
func TestNoFlagsField(t *testing.T) {
	b, _ := json.Marshal(domain.BuildMessageMedia(domain.MediaSource{
		Kind: "video", MediaID: 1, Width: 10, Height: 10, Duration: 5,
		FileName: "a.mp4", Blur: []byte{1}, HasThumb: true, Spoiler: true,
	}))
	if strings.Contains(string(b), `"flags"`) {
		t.Fatalf("поле flags просочилось в модель: %s", b)
	}
}

// Обязательные по схеме поля сериализуются ВСЕГДА, даже нулевые: photoSize.size
// — не flags-поле, и его отсутствие кодек фазы 2 прочитать не сможет.
func TestRequiredFieldsAlwaysPresent(t *testing.T) {
	m := wire(t, domain.MediaSource{Kind: "photo", MediaID: 7, Width: 100, Height: 50})
	photo := m["photo"].(map[string]any)
	sizes := photo["sizes"].([]any)
	full := sizes[len(sizes)-1].(map[string]any)
	for _, k := range []string{"_", "type", "w", "h", "size"} {
		if _, ok := full[k]; !ok {
			t.Fatalf("photoSize без обязательного %q: %#v", k, full)
		}
	}
	if full["size"] != float64(0) {
		t.Fatalf("size = %v, want 0 (обязательное поле сериализуется и нулевым)", full["size"])
	}
	// А у stripped-ступени этих полей нет вовсе — у неё их нет в схеме.
	stripped := wire(t, domain.MediaSource{Kind: "photo", MediaID: 7, Blur: []byte{1, 2}})
	s0 := stripped["photo"].(map[string]any)["sizes"].([]any)[0].(map[string]any)
	if s0["_"] != "photoStrippedSize" {
		t.Fatalf("первая ступень = %#v", s0)
	}
	for _, k := range []string{"w", "h", "size"} {
		if _, ok := s0[k]; ok {
			t.Fatalf("photoStrippedSize несёт чужое поле %q: %#v", k, s0)
		}
	}
}

// Дискриминатор `_` есть у КАЖДОГО объекта модели — именно на нём ветвится весь
// портируемый код. Без него мы снова начнём подделывать флаги.
func TestEveryObjectHasDiscriminator(t *testing.T) {
	b, _ := json.Marshal(domain.BuildMessageMedia(domain.MediaSource{
		Kind: "sticker", MediaID: 5, Width: 512, Height: 512, Mime: "image/webp",
		Blur: []byte{1}, PathThumb: []byte("M0"), StickerAlt: "🔥", HasThumb: true,
	}))
	var parsed any
	_ = json.Unmarshal(b, &parsed)
	var walk func(v any, path string)
	walk = func(v any, path string) {
		switch x := v.(type) {
		case map[string]any:
			// pFlags — под-объект флагов, а не конструктор: у него `_` нет.
			if path != "pFlags" {
				if _, ok := x["_"]; !ok {
					t.Fatalf("объект без дискриминатора по пути %q: %#v", path, x)
				}
			}
			for k, v2 := range x {
				walk(v2, k)
			}
		case []any:
			for _, v2 := range x {
				walk(v2, path)
			}
		}
	}
	walk(parsed, "root")
}

// Лестница превью: stripped → контур → серверное превью → оригинал. Порядок
// значим — choosePhotoSize идёт по ней снизу вверх и берёт первую, что покрыла
// бокс; серверное превью вписано в квадрат ThumbMaxSide с сохранением пропорции.
func TestSizeLadder(t *testing.T) {
	m := wire(t, domain.MediaSource{
		Kind: "photo", MediaID: 1, Width: 4000, Height: 2000, Size: 123,
		Blur: []byte{1}, HasThumb: true,
	})
	sizes := m["photo"].(map[string]any)["sizes"].([]any)
	var got []string
	for _, s := range sizes {
		o := s.(map[string]any)
		got = append(got, o["_"].(string)+"/"+o["type"].(string))
	}
	want := "photoStrippedSize/i,photoSize/y,photoSize/w"
	if strings.Join(got, ",") != want {
		t.Fatalf("лестница = %v, want %s", got, want)
	}
	y := sizes[1].(map[string]any)
	if y["w"] != float64(domain.ThumbMaxSide) || y["h"] != float64(640) {
		t.Fatalf("ступень 'y' = %vx%v, want %dx640", y["w"], y["h"], domain.ThumbMaxSide)
	}
}

// Медиа нет вовсе — вложения нет (а не пустой объект): у текстового сообщения
// клиенту нечего рисовать, и «пустое вложение» завело бы ему вторую ветку.
func TestNoMediaNoObject(t *testing.T) {
	if md := domain.BuildMessageMedia(domain.MediaSource{Kind: "text"}); md != nil {
		t.Fatalf("вложение без медиа: %#v", md)
	}
}
