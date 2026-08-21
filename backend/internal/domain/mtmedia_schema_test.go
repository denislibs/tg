package domain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
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

// Обязательные параметры схемы, которых мы сознательно не производим. Каждая
// строка — утверждение «предмета нет», а не забывчивость; развёрнутое основание
// стоит в докблоке соответствующего конструктора.
var omittedWithoutSubject = map[string][]string{
	// Реквизиты MTProto-транспорта: файл адресуется числовым id через свой
	// эндпоинт (шапка mtmedia.go).
	"photo":                    {"access_hash", "file_reference", "date", "dc_id"},
	"document":                 {"access_hash", "file_reference", "date", "dc_id"},
	"documentAttributeSticker": {"stickerset"},
	// Тот же транспортный токен, но у точки на карте: картинку карты оригинал
	// просит у своего прокси с подписью, а у нас карту рисует клиент.
	"geoPoint": {"access_hash"},
	// Реквизиты СПРАВОЧНИКА мест (foursquare/gplaces): справочника у нас нет,
	// точку с подписью присылает сам отправитель.
	"messageMediaVenue": {"provider", "venue_id", "venue_type"},
	// Хэш для кэширования запроса; хэш-кэширования запросов у нас нет вовсе.
	"poll": {"hash"},
	// Внешность подарка у нас — unicode-символ (наш параметр emoji), а не
	// анимированный стикер: тот же случай, что emoji_status у пира.
	"starGift": {"sticker"},
	// Превью ссылки у нас — СНИМОК на сообщении, а не самостоятельный объект
	// хранилища: адресовать его нечем, и хэша кэша у запросов нет.
	"webPage": {"id", "hash"},
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
		names := out[e.Predicate]
		if names == nil {
			names = map[string]bool{}
			out[e.Predicate] = names
		}
		for _, p := range e.Params {
			names[p.Name] = true
		}
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
	omittedOK map[string][]string
	// pendingSubject — ключи, у которых предмет в схеме ЕСТЬ, но объединение до
	// него у нас ещё не доведено. НЕ то же самое, что additional: там наш
	// собственный параметр (предмета в схеме нет вовсе), здесь — названный ДОЛГ.
	// Разводить их обязательно: объявить долг клиентским параметром значило бы
	// закрыть его на бумаге.
	pendingSubject map[string][]string
	unexpected     []string
	omitted        []string
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
				// Клиентские булевы флаги оригинала (is_scheduled, unread и
				// прочие из schema_additional_params.json) живут там же, где
				// схемные, — сверщик обязан их признавать.
				if !booleanFlags[flag] && !c.additional[predicate][flag] {
					c.unexpected = append(c.unexpected,
						fmt.Sprintf("%s.pFlags: %q не булев флаг конструктора %q", path, flag, predicate))
				}
			}
			continue
		}

		if contains(c.pendingSubject[predicate], key) {
			c.walk(val, path+"."+key)
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

func checkAgainstSchema(t *testing.T, media any) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(media)
	if err != nil {
		t.Fatalf("вложение не сериализуется: %v", err)
	}

	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("вложение не разбирается обратно: %v", err)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    omittedWithoutSubject,
	}
	c.walk(decoded, "media")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// mediaCases — по одному экземпляру КАЖДОГО конструктора объединения, который мы
// производим, плюс вложенные в них структуры. Список продублирован проверкой
// полноты ниже: конструктор без строки здесь просто не был бы сверен со схемой.
func mediaCases() []struct {
	name  string
	media MessageMedia
} {
	return []struct {
		name  string
		media MessageMedia
	}{
		{
			name: "видео с превью и заслонкой",
			media: NewMessageMediaDocument(&Document{
				Underscore: DocumentTag,
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
			}, true),
		},
		{
			name: "стикер с векторным контуром",
			media: NewMessageMediaDocument(&Document{
				Underscore: DocumentTag,
				ID:         48,
				MimeType:   "image/webp",
				Size:       30000,
				Thumbs:     []PhotoSize{NewPhotoPathSize([]byte("M0 0"))},
				Attributes: []DocumentAttribute{
					DocumentAttributeSticker{Underscore: AttrSticker, Alt: "🔥"},
					DocumentAttributeImageSize{Underscore: AttrImageSize, W: 512, H: 512},
				},
			}, false),
		},
		{
			name: "голосовое",
			media: NewMessageMediaDocument(&Document{
				Underscore: DocumentTag,
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
			}, false),
		},
		{
			name: "фотография с лестницей размеров",
			media: NewMessageMediaPhoto(NewPhoto(3, []PhotoSize{
				NewPhotoStrippedSize([]byte{1, 2, 3}),
				NewPhotoSize(SizeTypeThumb, 1280, 640, 90000),
				NewPhotoSize(SizeTypeFull, 4000, 2000, 900000),
			}), false),
		},
		{
			name:  "точка на карте",
			media: NewMessageMediaGeo(55.75, 37.61),
		},
		{
			name:  "живая трансляция",
			media: NewMessageMediaGeoLive(55.75, 37.61, 3600, 90),
		},
		{
			// Остановленная трансляция: period укорочен до нуля, и это ЗНАЧЕНИЕ
			// («истекла»), а не отсутствие параметра.
			name:  "остановленная трансляция",
			media: NewMessageMediaGeoLive(55.75, 37.61, 0, 0),
		},
		{
			name:  "место с подписью",
			media: NewMessageMediaVenue(55.75, 37.61, "Кремль", "Москва"),
		},
		{
			// Контакт без фамилии и без vcard: обязательные параметры едут
			// ПУСТЫМИ строками, а не исчезают.
			name:  "визитка",
			media: NewMessageMediaContact(43, "Боб", "+70000000000"),
		},
		{
			name: "опрос-викторина с голосом зрителя",
			media: PollInfo{
				ID: 5, Question: "Столица?", Options: []string{"Москва", "Питер"},
				Quiz: true, CorrectOption: ptr(0), Counts: []int{3, 1},
				TotalVoters: 4, MyVotes: []int{0},
			}.ToMedia(),
		},
		{
			// Никто не голосовал: pFlags у вариантов исчезают целиком.
			name: "опрос без голосов",
			media: PollInfo{
				ID: 6, Question: "?", Options: []string{"да", "нет"},
				Anonymous: true, Counts: []int{0, 0},
			}.ToMedia(),
		},
		{
			name: "чек-лист с отметками",
			media: ChecklistInfo{
				ID: 7, Title: "дела", OthersCanAdd: true, OthersCanMark: true,
				Items: []ChecklistItemInfo{
					{ID: 1, Text: "купить хлеб", Marks: []ChecklistMark{{UserID: 42, At: testNow}}},
					{ID: 2, Text: "выгулять кота"},
				},
			}.ToMedia(),
		},
		{
			name: "идущий розыгрыш",
			media: GiveawayInfo{
				ID: 8, PeerID: ToPeerID(9, true), PrizeKind: "premium", Months: 3,
				WinnersCount: 10, UntilDate: testNow.UnixMilli(), Status: "active",
			}.ToMedia(120),
		},
		{
			name: "состоявшийся розыгрыш звёзд",
			media: GiveawayInfo{
				ID: 8, PeerID: ToPeerID(9, true), PrizeKind: "stars", Stars: 500,
				WinnersCount: 2, UntilDate: testNow.UnixMilli(), Status: "finished",
				WinnerIDs: []int64{42, 43},
			}.ToMedia(120),
		},
		{
			name: "превью ссылки с картинкой",
			media: (&WebPagePreview{
				URL: "https://example.org/a", SiteName: "Example", Title: "Заголовок",
				Description: "Описание", PhotoID: 77, PhotoW: 800, PhotoH: 600,
				PhotoBlur: []byte{1, 2, 3}, PhotoHasThumb: true, HasIV: true,
			}).ToMedia(),
		},
		{
			name:  "превью ссылки без картинки",
			media: (&WebPagePreview{URL: "https://example.org"}).ToMedia(),
		},
		{
			name: "платное медиа: оплачено",
			media: NewMessageMediaPaidMedia(50,
				NewMessageMediaPhoto(NewPhoto(9, []PhotoSize{NewPhotoSize(SizeTypeFull, 800, 600, 12345)}), false),
				false),
		},
		{
			// Не оплачено: настоящего медиа в векторе нет вовсе — только
			// коробка кадра и подложка.
			name: "платное медиа: заблокировано",
			media: NewMessageMediaPaidMedia(50,
				StripLockedMedia(NewMessageMediaPhoto(NewPhoto(9, []PhotoSize{
					NewPhotoStrippedSize([]byte{1, 2, 3}),
					NewPhotoSize(SizeTypeFull, 800, 600, 12345),
				}), true)),
				true),
		},
	}
}

func TestMessageMedia_MatchesSchema(t *testing.T) {
	for _, tc := range mediaCases() {
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

// mediaConstructorTags — все дискриминаторы, объявленные подсистемой медиа.
func mediaConstructorTags() []string {
	return []string{
		MessageMediaPhotoTag, MessageMediaDocumentTag,
		MessageMediaGeoTag, MessageMediaGeoLiveTag, MessageMediaVenueTag,
		MessageMediaContactTag, MessageMediaPollTag, MessageMediaToDoTag,
		MessageMediaGiveawayTag, MessageMediaGiveawayResultsTag,
		MessageMediaWebPageTag, MessageMediaPaidMediaTag,
		MessageExtendedMediaTag, MessageExtendedMediaPreviewTag,
		GeoPointTag, PhotoTag, DocumentTag,
		PhotoSizeTag, PhotoStrippedSizeTag, PhotoPathSizeTag,
		AttrImageSize, AttrAnimated, AttrSticker, AttrVideo, AttrAudio, AttrFilename,
		PollTag, PollAnswerTag, PollResultsTag, PollAnswerVotersTag,
		TodoListTag, TodoItemTag, TodoCompletionTag,
		WebPageTag,
	}
}

// Полнота: каждый объявленный дискриминатор объединения реально есть в схеме И
// реально участвует в сверке. Иначе конструктор можно было бы завести и забыть —
// ровно так гео и опрос прожили порт медиа собственными ключами сообщения.
func TestMessageMedia_EveryConstructorIsChecked(t *testing.T) {
	seen := map[string]bool{}
	var mark func(v any)
	mark = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				mark(item)
			}
		case map[string]any:
			if u, ok := x["_"].(string); ok {
				seen[u] = true
			}
			for k, item := range x {
				if k != "pFlags" {
					mark(item)
				}
			}
		}
	}
	cases := mediaCases()
	all := make([]MessageMedia, 0, len(cases))
	for _, tc := range cases {
		all = append(all, tc.media)
	}
	// Атрибуты, которых нет ни в одном случае выше, но которые модель
	// производит: собираются тем же BuildMessageMedia.
	extra := BuildMessageMedia(MediaSource{Kind: "gif", MediaID: 1, Width: 10, Height: 10, Animated: true})

	raw, err := json.Marshal([]any{all, extra})
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	mark(decoded)

	ctors := loadSchemaConstructors(t)
	for _, tag := range mediaConstructorTags() {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		if _, ok := ctors[tag]; !ok {
			t.Errorf("конструктора %q нет в схеме", tag)
		}
	}
}

// testNow — общая точка отсчёта для случаев подсистемы медиа.
var testNow = time.Unix(1_700_000_000, 0)

// Числовой id конструктора в докблоке — не украшение: на фазе 2 именно он
// уходит в поток четырьмя байтами. Проверяется механически по всем файлам
// подсистемы, потому что глазами не проверяется.
//
// Чем это отличается от общего пина `mtids_test.go`, который сканирует ВСЕ
// файлы подсистемы: тот проверяет слабее — «если id написан, он совпадает со
// схемой» (и однажды поймал устаревший `documentAttributeVideo`). Здесь
// утверждение сильнее и посубсистемное: у КАЖДОГО объявленного конструктора
// медиа докблок с id обязан быть. Именно полноты у медиа и не хватало —
// конструктор можно было завести совсем без id, и общий пин молчал бы.
func TestMessageMedia_ConstructorIDsMatchSchema(t *testing.T) {
	want := map[string]string{}
	for predicate, ctor := range loadSchemaConstructorIDs(t) {
		want[predicate] = hexCtorID(t, predicate, ctor)
	}

	found := map[string]bool{}
	re := regexp.MustCompile(`(?m)^//\s*([A-Za-z][A-Za-z0-9_.]*)#([0-9a-f]{8})\b`)
	for _, file := range []string{"mtmedia.go", "mtpoll.go", "mttodo.go", "mtgiveaway.go", "mtwebpage.go"} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("исходник подсистемы не читается (%s): %v", file, err)
		}
		for _, m := range re.FindAllStringSubmatch(string(src), -1) {
			predicate, id := m[1], m[2]
			schemaID, ok := want[predicate]
			if !ok {
				t.Errorf("%s: докблок ссылается на конструктор %q, которого нет в схеме", file, predicate)
				continue
			}
			found[predicate] = true
			if schemaID != id {
				t.Errorf("%s: id в докблоке #%s, а в схеме #%s", predicate, id, schemaID)
			}
		}
	}
	// Иначе тест «проходил» бы и на файлах без единого докблока.
	for _, tag := range mediaConstructorTags() {
		if !found[tag] {
			t.Errorf("у конструктора %q нет докблока с числовым id", tag)
		}
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
			"_":     DocumentTag,
			"flags": float64(1),
		}, "media.document")
		if len(c.unexpected) == 0 {
			t.Fatal("маска flags не должна попадать в объект — она живёт только на проводе")
		}
	})

	t.Run("пропущенный обязательный параметр", func(t *testing.T) {
		c := &schemaChecker{constructors: ctors, additional: add}
		// messageMediaContact без last_name: у оригинала это пустая СТРОКА, а не
		// отсутствие ключа.
		c.walk(map[string]any{
			"_":            MessageMediaContactTag,
			"phone_number": "+7",
			"first_name":   "Боб",
			"vcard":        "",
			"user_id":      float64(43),
		}, "media")
		if len(c.omitted) == 0 {
			t.Fatal("пропущенный обязательный параметр должен считаться расхождением")
		}
	})
}
