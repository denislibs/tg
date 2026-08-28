package domain

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

// Механическая сверка модели наборов стикеров со схемой TL — зеркало
// `mtmedia_schema_test.go` (тот же `schemaChecker`, те же два утверждения:
// лишнего нет, пропущенное названо).
//
// Отдельный файл, а не строки в сверке медиа, по той же причине, по какой у
// сущностей и разметки свои: список «нет предмета» у каждой подсистемы свой, и
// смешав их, мы получили бы разрешение молчать там, где молчать нельзя.
//
// САМ СТИКЕР здесь не сверяется, и это не пропуск: стикер — `Document`, его
// сверяет `mtmedia_schema_test.go`. Здесь проверяются контейнеры и то, что
// документ лежит в них тем же конструктором.

// stickerSetCases — по одному экземпляру КАЖДОГО конструктора, который мы
// производим. Полнота списка проверяется отдельным тестом ниже: конструктор
// без строки здесь просто не был бы сверен со схемой — ровно тот способ, каким
// из модели уходили ступени превью и контур стикера.
func stickerSetCases() []struct {
	name  string
	value any
} {
	doc := &Document{
		Underscore: DocumentTag,
		ID:         77,
		MimeType:   "image/webp",
		Size:       4096,
		Thumbs: []PhotoSize{
			NewPhotoStrippedSize([]byte{1, 2, 3}),
			NewPhotoPathSize([]byte{4, 5, 6}),
		},
		Attributes: []DocumentAttribute{
			DocumentAttributeSticker{
				Underscore: AttrSticker,
				Alt:        "🙂",
				Stickerset: NewInputStickerSetID(9),
			},
			DocumentAttributeImageSize{Underscore: AttrImageSize, W: 512, H: 512},
		},
	}
	set := StickerSet{
		Underscore:      StickerSetTag,
		PFlags:          map[string]bool{"emojis": true},
		InstalledDate:   1787334148,
		ID:              9,
		Title:           "Котики",
		ShortName:       "cats",
		Thumbs:          []PhotoSize{NewPhotoStrippedSize([]byte{7, 8})},
		ThumbDocumentID: 77,
		Count:           1,
	}
	packs := []StickerPack{NewStickerPack("🙂", []int64{77})}

	return []struct {
		name  string
		value any
	}{
		{"набор", set},
		{"обратный индекс эмодзи", packs[0]},
		{"слова поиска", StickerKeyword{Underscore: StickerKeywordTag, DocumentID: 77, Keyword: []string{"кот"}}},
		{"адрес набора — пусто", NewInputStickerSetEmpty()},
		{"адрес набора — по id", NewInputStickerSetID(9)},
		{"тренды: набор с одной обложкой", StickerSetCoveredOne{
			Underscore: StickerSetCoveredTag, Set: set, Cover: doc,
		}},
		{"тренды: набор целиком", StickerSetFullCovered{
			Underscore: StickerSetFullCoveredTag, Set: set,
			Packs: packs, Keywords: []StickerKeyword{}, Documents: []*Document{doc},
		}},
		{"мои наборы", NewMessagesAllStickers([]StickerSet{set})},
		{"набор со стикерами", NewMessagesStickerSet(set, packs, []*Document{doc})},
		{"недавние", NewMessagesRecentStickers([]*Document{doc}, []int64{1787334148})},
		{"избранные", NewMessagesFavedStickers([]*Document{doc}, packs)},
		{"тренды", NewMessagesFeaturedStickers(1, []StickerSetCovered{
			StickerSetCoveredOne{Underscore: StickerSetCoveredTag, Set: set, Cover: doc},
		})},
		{"поиск наборов", NewMessagesFoundStickerSets([]StickerSetCovered{
			StickerSetCoveredOne{Underscore: StickerSetCoveredTag, Set: set, Cover: doc},
		})},
		{"поиск по эмодзи", NewMessagesStickers([]*Document{doc})},
		{"сохранённые GIF", NewMessagesSavedGifs([]*Document{doc})},
	}
}

func TestStickerSets_MatchSchema(t *testing.T) {
	for _, tc := range stickerSetCases() {
		t.Run(tc.name, func(t *testing.T) {
			unexpected, omitted := checkStickerSetsAgainstSchema(t, tc.value)
			for _, s := range unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// checkStickerSetsAgainstSchema — тот же сверщик, что у медиа, но со СВОИМ
// списком «нет предмета».
func checkStickerSetsAgainstSchema(t *testing.T, value any) (unexpected, omitted []string) {
	t.Helper()

	decoded := roundTripJSON(t, value)

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    OmittedWithoutSubject,
	}
	c.walk(decoded, "stickers")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// Полнота: каждый конструктор, объявленный в mtstickerset.go, обязан иметь
// строку в stickerSetCases. Без этого теста новый конструктор проехал бы мимо
// сверки молча — а молчаливый пропуск и есть та болезнь, ради которой сверка
// написана.
func TestStickerSets_EveryConstructorIsCovered(t *testing.T) {
	declared := map[string]bool{
		StickerSetTag:               true,
		StickerPackTag:              true,
		StickerKeywordTag:           true,
		StickerSetCoveredTag:        true,
		StickerSetFullCoveredTag:    true,
		InputStickerSetEmptyTag:     true,
		InputStickerSetIDTag:        true,
		MessagesAllStickersTag:      true,
		MessagesStickerSetTag:       true,
		MessagesRecentStickersTag:   true,
		MessagesFavedStickersTag:    true,
		MessagesFeaturedStickersTag: true,
		MessagesFoundStickerSetsTag: true,
		MessagesStickersTag:         true,
		MessagesSavedGifsTag:        true,
	}

	covered := map[string]bool{}
	for _, tc := range stickerSetCases() {
		decoded := roundTripJSON(t, tc.value)
		collectPredicates(decoded, covered)
	}

	var missing []string
	for tag := range declared {
		if !covered[tag] {
			missing = append(missing, tag)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("конструкторы объявлены, но не сверяются со схемой: %s", strings.Join(missing, ", "))
	}
}

// collectPredicates собирает все встреченные `_` — включая вложенные, чтобы
// конструктор, который производится только внутри контейнера, тоже считался
// покрытым.
func collectPredicates(value any, out map[string]bool) {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			collectPredicates(item, out)
		}
	case map[string]any:
		if p, ok := v["_"].(string); ok {
			out[p] = true
		}
		for _, item := range v {
			collectPredicates(item, out)
		}
	}
}

// roundTripJSON — то же, что делает сверщик у медиа: сериализуем и разбираем
// обратно, чтобы смотреть на РЕАЛЬНЫЙ вывод (с учётом omitempty и тегов), а не
// на структуру Go.
func roundTripJSON(t *testing.T, value any) any {
	t.Helper()

	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("не разбирается обратно: %v", err)
	}
	return decoded
}
