package domain

import (
	"sort"
	"strings"
	"testing"
)

// Механическая сверка модели ИСТОРИЙ со схемой TL — зеркало
// `mtstickerset_schema_test.go` (тот же `schemaChecker`, те же два утверждения:
// лишнего нет, пропущенное названо).
//
// Отдельный файл, а не строки в сверке медиа, по той же причине, что у
// стикеров и разметки: список «нет предмета» у каждой подсистемы свой, и
// смешав их, мы получили бы разрешение молчать там, где молчать нельзя.
//
// МЕДИА самой истории здесь не сверяется, и это не пропуск: `storyItem.media`
// — обычный `MessageMedia`, его сверяет `mtmedia_schema_test.go`. Здесь
// проверяется, что история кладёт в этот параметр ту же ступень, а не ссылку.

// storyCases — по одному экземпляру КАЖДОГО конструктора, который мы
// производим. Полнота списка проверяется отдельным тестом ниже: конструктор
// без строки здесь просто не был бы сверен со схемой — ровно тот способ, каким
// из модели уходили ступени превью и контур стикера.
func storyCases() []struct {
	name  string
	value any
} {
	coords := NewMediaAreaCoordinates(10, 20, 30, 40, 0)
	media := MessageMediaPhoto{
		Underscore: MessageMediaPhotoTag,
		Photo: &Photo{
			Underscore: PhotoTag,
			ID:         42,
			Sizes:      []PhotoSize{NewPhotoStrippedSize([]byte{1, 2, 3})},
		},
	}
	story := StoryItemReal{
		Underscore: StoryItemTag,
		PFlags:     StoryPrivacyPFlags("close"),
		ID:         7,
		Date:       1787334148,
		FwdFrom:    ptrOf(NewStoryFwdHeader(NewPeer(5), 3)),
		ExpireDate: 1787420548,
		Caption:    "жирный",
		Entities:   []MessageEntity{NewMessageEntityBold(0, 6)},
		Media:      media,
		MediaAreas: []MediaArea{
			NewMediaAreaGeoPoint(coords, 55.75, 37.61),
			NewMediaAreaVenue(coords, 55.75, 37.61, "Кафе", "Тверская, 1"),
			NewMediaAreaSuggestedReaction(coords, "👍", true, true),
			NewMediaAreaURL(coords, "https://example.org"),
		},
		Privacy:      StoryPrivacyRules("selected", []int64{5, 6}),
		Views:        ptrOf(NewStoryViews(12, []MTReactionCount{NewReactionCount(NewReactionEmoji("👍"), 3, true)}, 3)),
		SentReaction: NewReactionEmoji("👍"),
		Viewed:       true,
	}

	return []struct {
		name  string
		value any
	}{
		{"история целиком", story},
		{"история удалена", NewStoryItemDeleted(7)},
		{"аудитория: все", StoryPrivacyRules("everyone", nil)},
		{"аудитория: контакты", StoryPrivacyRules("contacts", nil)},
		{"аудитория: близкие друзья", StoryPrivacyRules("close", nil)},
		{"группа автора", NewPeerStories(NewPeer(5), []StoryItem{story})},
		{"stealth-окно", NewStoriesStealthMode(1787334148, 1787420548)},
		{"лента историй", NewStoriesAllStories(
			[]PeerStories{NewPeerStories(NewPeer(5), []StoryItem{story})},
			[]User{&UserReal{Underscore: UserTag, ID: 5, FirstName: "Аня"}},
			NewStoriesStealthMode(0, 0),
		)},
		{"плоский список (архив/закреплённые)", NewStoriesStories(
			[]StoryItem{story},
			[]User{&UserReal{Underscore: UserTag, ID: 5, FirstName: "Аня"}},
		)},
		{"кто посмотрел", NewStoriesStoryViewsList(
			[]StoryView{NewStoryView(6, 1787334148, NewReactionEmoji("👍"))},
			[]User{&UserReal{Underscore: UserTag, ID: 6, FirstName: "Боб"}},
			3,
		)},
	}
}

func ptrOf[T any](v T) *T { return &v }

func TestStories_MatchSchema(t *testing.T) {
	for _, tc := range storyCases() {
		t.Run(tc.name, func(t *testing.T) {
			unexpected, omitted := checkStoriesAgainstSchema(t, tc.value)
			for _, s := range unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// checkStoriesAgainstSchema — тот же сверщик, что у медиа и стикеров, с общим
// списком заглушек `OmittedWithoutSubject`: истории пользуются им наравне с
// остальными подсистемами (`mediaAreaVenue`, `stories.allStories.state`).
func checkStoriesAgainstSchema(t *testing.T, value any) (unexpected, omitted []string) {
	t.Helper()

	decoded := roundTripJSON(t, value)

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    OmittedWithoutSubject,
	}
	c.walk(decoded, "stories")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// Полнота: каждый конструктор, объявленный в mtstory.go, обязан иметь строку в
// storyCases. Без этого теста новый конструктор проехал бы мимо сверки молча —
// а молчаливый пропуск и есть та болезнь, ради которой сверка написана.
func TestStories_EveryConstructorIsCovered(t *testing.T) {
	declared := map[string]bool{
		StoryItemTag:                     true,
		StoryItemDeletedTag:              true,
		StoryViewsTag:                    true,
		StoryFwdHeaderTag:                true,
		StoryViewTag:                     true,
		PeerStoriesTag:                   true,
		MediaAreaCoordinatesTag:          true,
		MediaAreaGeoPointTag:             true,
		MediaAreaVenueTag:                true,
		MediaAreaSuggestedReactionTag:    true,
		MediaAreaURLTag:                  true,
		PrivacyValueAllowAllTag:          true,
		PrivacyValueAllowContactsTag:     true,
		PrivacyValueAllowCloseFriendsTag: true,
		PrivacyValueAllowUsersTag:        true,
		StoriesStealthModeTag:            true,
		StoriesAllStoriesTag:             true,
		StoriesStoriesTag:                true,
		StoriesStoryViewsListTag:         true,
	}

	covered := map[string]bool{}
	for _, tc := range storyCases() {
		collectPredicates(roundTripJSON(t, tc.value), covered)
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

// Пер-зрительская часть реакций живёт ОТДЕЛЬНЫМ параметром истории, а не внутри
// агрегата: тело истории одно на всех получателей, и «моя реакция» в общем теле
// была бы тем же дефектом, что уже пойман у pFlags.out.
//
// Тест держит именно эту границу: `views` (общий агрегат) и `sent_reaction`
// (личное) — разные параметры, и слить их обратно в одну тройку ключей нельзя
// молча.
func TestStories_MyReactionLivesOutsideTheAggregate(t *testing.T) {
	story := StoryItemReal{
		Underscore:   StoryItemTag,
		ID:           7,
		Date:         1787334148,
		ExpireDate:   1787420548,
		Media:        MessageMediaPhoto{Underscore: MessageMediaPhotoTag},
		Views:        ptrOf(NewStoryViews(12, []MTReactionCount{NewReactionCount(NewReactionEmoji("👍"), 3, true)}, 3)),
		SentReaction: NewReactionEmoji("👍"),
	}

	decoded, ok := roundTripJSON(t, story).(map[string]any)
	if !ok {
		t.Fatalf("история не разобралась в объект")
	}
	views, ok := decoded["views"].(map[string]any)
	if !ok {
		t.Fatalf("views не разобрался в объект: %#v", decoded["views"])
	}
	for _, key := range []string{"my_reaction", "sent_reaction"} {
		if _, exists := views[key]; exists {
			t.Errorf("личная реакция внутри общего агрегата: views.%s", key)
		}
	}
	if _, exists := decoded["sent_reaction"]; !exists {
		t.Errorf("sent_reaction не выехал параметром самой истории")
	}
}

// Медиа истории — СТУПЕНЬ, а не ссылка и не пустое место.
//
// Тест стоит отдельно от сверки со схемой намеренно: общий сверщик считает ключ
// ПРИСУТСТВУЮЩИМ, даже если его значение null, — а `media` у нас обязательный
// интерфейс, и забытый производитель выдал бы ровно `"media": null`. Это тот же
// пропуск, ради устранения которого порт и делается (было `media_id: int64`),
// поэтому проверяется он адресно.
func TestStories_MediaIsALadderNotAReference(t *testing.T) {
	for _, tc := range storyCases() {
		t.Run(tc.name, func(t *testing.T) {
			forEachStoryItem(roundTripJSON(t, tc.value), func(story map[string]any) {
				if _, exists := story["media_id"]; exists {
					t.Errorf("медиа ехало ссылкой: media_id")
				}
				media, ok := story["media"].(map[string]any)
				if !ok {
					t.Fatalf("media не конструктор: %#v", story["media"])
				}
				if _, ok := media["_"].(string); !ok {
					t.Errorf("у media нет дискриминатора: %#v", media)
				}
			})
		})
	}
}

// forEachStoryItem обходит значение и вызывает fn на каждом объекте с
// дискриминатором `storyItem` — где бы он ни лежал: сам по себе, в группе или
// в контейнере ленты.
func forEachStoryItem(value any, fn func(map[string]any)) {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			forEachStoryItem(item, fn)
		}
	case map[string]any:
		if p, _ := v["_"].(string); p == StoryItemTag {
			fn(v)
		}
		for _, item := range v {
			forEachStoryItem(item, fn)
		}
	}
}

// «Черновика нет» и «черновик сняли» были разными состояниями у диалога; здесь
// то же самое у истории: `storyItemDeleted` — ВЫБОР конструктора, а не запись с
// признаком. Тест держит форму удалённой истории: в ней нет ничего, кроме
// номера, — ни медиа, ни дат, ни пустых значений вместо них.
func TestStories_DeletedCarriesNothingButID(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewStoryItemDeleted(7)).(map[string]any)
	if !ok {
		t.Fatalf("удалённая история не разобралась в объект")
	}
	var keys []string
	for k := range decoded {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "_,id" {
		t.Errorf("удалённая история несёт лишнее: %v", keys)
	}
}
