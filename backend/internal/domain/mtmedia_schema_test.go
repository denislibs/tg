package domain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Механическая сверка модели медиа со схемой TL — со стороны ПРОИЗВОДИТЕЛЯ
// витрины. Зеркало фронтового `messageMedia.schema.test.ts`, и вместе они
// закрывают обе стороны провода: там проверяется то, что клиент готов принять,
// здесь — то, что сервер реально отдаёт.
//
// Проверяются два утверждения:
//
//  1. Лишнего нет. Каждый ключ сериализованного объекта — либо параметр
//     конструктора из схемы, либо клиентский параметр из
//     schema_additional_params.json (механизм оригинала: префикс `flags.-1?`).
//     Придуманное поле не пройдёт.
//
//  2. Пропущенное названо. Обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета». Новый молчаливый пропуск красит
//     тест — а молчаливый пропуск и есть тот способ, которым из модели уходили
//     ступени превью и контур стикера.
//
// Тест НЕ проверяет типы значений и порядок полей: это работа кодека (фаза 2),
// там расхождение видно побайтово.

type schemaParam struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type schemaConstructor struct {
	Predicate string        `json:"predicate"`
	Params    []schemaParam `json:"params"`
	Type      string        `json:"type"`
}

// Обязательные параметры схемы, которых мы сознательно не производим: реквизиты
// MTProto-транспорта, у которых нет предмета в нашей схеме доступа. Список
// обязан совпадать с тем, что перечислен в шапке mtmedia.go и в зеркальном
// фронтовом тесте.
var omittedWithoutSubject = map[string][]string{
	"photo":                    {"access_hash", "file_reference", "date", "dc_id"},
	"document":                 {"access_hash", "file_reference", "date", "dc_id"},
	"documentAttributeSticker": {"stickerset"},
}

func loadSchemaConstructors(t *testing.T) map[string]schemaConstructor {
	t.Helper()

	// backend/internal/domain → корень репозитория.
	path := filepath.Join("..", "..", "..", "schema", "schema.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("схема не читается (%s): %v", path, err)
	}

	var doc struct {
		API struct {
			Constructors []schemaConstructor `json:"constructors"`
		} `json:"API"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("схема не разбирается: %v", err)
	}

	out := make(map[string]schemaConstructor, len(doc.API.Constructors))
	for _, c := range doc.API.Constructors {
		out[c.Predicate] = c
	}
	return out
}

func loadAdditionalParams(t *testing.T) map[string]map[string]bool {
	t.Helper()

	path := filepath.Join("..", "..", "..", "schema", "schema_additional_params.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("надстройки схемы не читаются (%s): %v", path, err)
	}

	var entries []struct {
		Predicate string        `json:"predicate"`
		Params    []schemaParam `json:"params"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("надстройки схемы не разбираются: %v", err)
	}

	out := make(map[string]map[string]bool, len(entries))
	for _, e := range entries {
		names := make(map[string]bool, len(e.Params))
		for _, p := range e.Params {
			names[p.Name] = true
		}
		out[e.Predicate] = names
	}
	return out
}

// loadOwnConstructors — конструкторы, объявленные ЦЕЛИКОМ в надстройках
// (запись с полем `type`), а не в schema.json. Их два вида, и различает их
// наличие `id`: клиентские синтетические конструкторы оригинала
// (messageActionChatLeave и десяток других — на провод не идут, id им не
// нужен) и НАШИ собственные, у которых предмета в схеме нет вовсе
// (messageActionRestrict). Сверщик обязан признавать и те и другие: иначе
// собственный конструктор выглядел бы как «предиката нет в схеме», то есть
// как ошибка.
func loadOwnConstructors(t *testing.T) map[string]schemaConstructor {
	t.Helper()

	path := filepath.Join("..", "..", "..", "schema", "schema_additional_params.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("надстройки схемы не читаются (%s): %v", path, err)
	}

	var entries []schemaConstructor
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("надстройки схемы не разбираются: %v", err)
	}

	out := map[string]schemaConstructor{}
	for _, e := range entries {
		if e.Type != "" {
			out[e.Predicate] = e
		}
	}
	return out
}

// Булев флаг схемы: его место — только в pFlags, на верхнем уровне быть не должно.
func isBooleanFlag(t string) bool { return strings.HasSuffix(t, "?true") }

// Сама битовая маска: в объекте её быть не должно, она живёт только на проводе.
func isFlagsHolder(t string) bool { return t == "#" }

func isRequiredParam(t string) bool { return !strings.Contains(t, "?") && !isFlagsHolder(t) }

type schemaChecker struct {
	constructors map[string]schemaConstructor
	additional   map[string]map[string]bool
	// own — конструкторы, объявленные целиком в надстройках (loadOwnConstructors).
	// Пустое значение допустимо: подсистема, у которой своих конструкторов нет,
	// поле не заполняет, и незнакомый предикат остаётся расхождением.
	own map[string]schemaConstructor
	// omittedOK — обязательные параметры схемы, которых мы сознательно не
	// производим (см. omittedWithoutSubject у медиа). Поле, а не глобальная
	// карта: у каждой подсистемы свой список.
	omittedOK  map[string][]string
	unexpected []string
	omitted    []string
}

func (c *schemaChecker) walk(value any, path string) {
	switch v := value.(type) {
	case []any:
		for i, item := range v {
			c.walk(item, fmt.Sprintf("%s[%d]", path, i))
		}
	case map[string]any:
		c.walkObject(v, path)
	}
}

func (c *schemaChecker) walkObject(obj map[string]any, path string) {
	predicate, ok := obj["_"].(string)
	if !ok {
		// Не конструктор — обходим вложенное на случай контейнеров.
		for k, v := range obj {
			c.walk(v, path+"."+k)
		}
		return
	}

	ctor, ok := c.constructors[predicate]
	if !ok {
		ctor, ok = c.own[predicate]
	}
	if !ok {
		c.unexpected = append(c.unexpected, fmt.Sprintf("%s: конструктора %q нет в схеме", path, predicate))
		return
	}

	wireParams := map[string]bool{}
	booleanFlags := map[string]bool{}
	for _, p := range ctor.Params {
		switch {
		case isFlagsHolder(p.Type):
			// в объект не попадает вовсе
		case isBooleanFlag(p.Type):
			booleanFlags[p.Name] = true
		default:
			wireParams[p.Name] = true
		}
	}

	for key, val := range obj {
		if key == "_" {
			continue
		}

		if key == "pFlags" {
			flags, _ := val.(map[string]any)
			for flag := range flags {
				if !booleanFlags[flag] {
					c.unexpected = append(c.unexpected,
						fmt.Sprintf("%s.pFlags: %q не булев флаг конструктора %q", path, flag, predicate))
				}
			}
			continue
		}

		if !wireParams[key] && !c.additional[predicate][key] {
			c.unexpected = append(c.unexpected,
				fmt.Sprintf("%s: ключ %q не описан ни схемой, ни надстройками конструктора %q", path, key, predicate))
		}

		c.walk(val, path+"."+key)
	}

	for _, p := range ctor.Params {
		if !isRequiredParam(p.Type) {
			continue
		}
		if _, present := obj[p.Name]; present {
			continue
		}
		if contains(c.omittedOK[predicate], p.Name) {
			continue
		}
		c.omitted = append(c.omitted,
			fmt.Sprintf("%s: обязательный параметр %q конструктора %q не выведен и не объявлен как «нет предмета»",
				path, p.Name, predicate))
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func checkAgainstSchema(t *testing.T, media *MessageMedia) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(media)
	if err != nil {
		t.Fatalf("вложение не сериализуется: %v", err)
	}

	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("вложение не разбирается обратно: %v", err)
	}

	c := &schemaChecker{constructors: loadSchemaConstructors(t), additional: loadAdditionalParams(t), omittedOK: omittedWithoutSubject}
	c.walk(decoded, "media")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

func TestMessageMedia_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		media *MessageMedia
	}{
		{
			name: "видео с превью и заслонкой",
			media: &MessageMedia{
				Underscore: MessageMediaDocumentTag,
				PFlags:     map[string]bool{"spoiler": true},
				Document: &Document{
					Underscore: "document",
					ID:         12,
					MimeType:   "video/mp4",
					Size:       1024,
					Thumbs: []PhotoSize{
						NewPhotoStrippedSize([]byte{1, 2, 3}),
						NewPhotoSize(SizeTypeThumb, 320, 180, 4096),
					},
					Attributes: []DocumentAttribute{
						DocumentAttributeVideo{Underscore: AttrVideo, Duration: 7, W: 1280, H: 720},
						DocumentAttributeFilename{Underscore: AttrFilename, FileName: "clip.mp4"},
					},
				},
			},
		},
		{
			name: "стикер с векторным контуром",
			media: &MessageMedia{
				Underscore: MessageMediaDocumentTag,
				Document: &Document{
					Underscore: "document",
					ID:         48,
					MimeType:   "image/webp",
					Size:       30000,
					Thumbs:     []PhotoSize{NewPhotoPathSize([]byte("M0 0"))},
					Attributes: []DocumentAttribute{
						DocumentAttributeSticker{Underscore: AttrSticker, Alt: "🔥"},
						DocumentAttributeImageSize{Underscore: AttrImageSize, W: 512, H: 512},
					},
				},
			},
		},
		{
			name: "голосовое",
			media: &MessageMedia{
				Underscore: MessageMediaDocumentTag,
				Document: &Document{
					Underscore: "document",
					ID:         46,
					MimeType:   "audio/ogg",
					Size:       4200,
					Attributes: []DocumentAttribute{
						DocumentAttributeAudio{
							Underscore: AttrAudio,
							PFlags:     map[string]bool{"voice": true},
							Duration:   7,
							Waveform:   []byte{31, 0, 42},
						},
						DocumentAttributeFilename{Underscore: AttrFilename, FileName: "voice.ogg"},
					},
				},
			},
		},
		{
			name: "фотография с лестницей размеров",
			media: &MessageMedia{
				Underscore: MessageMediaPhotoTag,
				Photo: NewPhoto(3, []PhotoSize{
					NewPhotoStrippedSize([]byte{1, 2, 3}),
					NewPhotoSize(SizeTypeThumb, 1280, 640, 90000),
					NewPhotoSize(SizeTypeFull, 4000, 2000, 900000),
				}),
			},
		},
		{
			name:  "плейсхолдер неоплаченного платного медиа",
			media: LockedPlaceholder(&MessageMedia{Underscore: MessageMediaPhotoTag, Photo: NewPhoto(9, []PhotoSize{NewPhotoStrippedSize([]byte{1, 2, 3}), NewPhotoSize(SizeTypeFull, 800, 600, 12345)})}),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			unexpected, omitted := checkAgainstSchema(t, tc.media)
			for _, v := range unexpected {
				t.Errorf("лишнее поле: %s", v)
			}
			for _, v := range omitted {
				t.Errorf("молчаливый пропуск: %s", v)
			}
		})
	}
}

// Негативные случаи: проверяем, что сам сверщик ловит те два расхождения, ради
// которых он и написан. Без этого «зелено» ничего не значило бы.
func TestMessageMedia_SchemaCheckerCatchesDrift(t *testing.T) {
	ctors := loadSchemaConstructors(t)
	add := loadAdditionalParams(t)

	t.Run("булев флаг на верхнем уровне вместо pFlags", func(t *testing.T) {
		c := &schemaChecker{constructors: ctors, additional: add}
		c.walk(map[string]any{
			"_":       MessageMediaDocumentTag,
			"spoiler": true,
		}, "media")
		if len(c.unexpected) == 0 {
			t.Fatal("плоский булев флаг должен считаться расхождением")
		}
	})

	t.Run("поле flags в объекте", func(t *testing.T) {
		c := &schemaChecker{constructors: ctors, additional: add}
		c.walk(map[string]any{
			"_":     "document",
			"flags": float64(1),
		}, "media.document")
		if len(c.unexpected) == 0 {
			t.Fatal("маска flags не должна попадать в объект — она живёт только на проводе")
		}
	})
}
