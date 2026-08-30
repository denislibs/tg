package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecaselangpack "github.com/messenger-denis/backend/internal/usecase/langpack"
)

// Витрины языкового пакета через НАСТОЯЩИЙ роутер: проверяются и адреса, и
// коды, и ИМЕНА отказов в теле — по ним ветвится клиент (`HttpError.type`).
//
// Хранилище здесь фейковое: версии, разница и снятые ключи проверены на
// настоящем Postgres (langpackrepo_test.go), а тут вопрос другой — что доезжает
// до клиента.

// fakeLangPackRepo — хранилище в памяти. Версия строки хранится РЯДОМ со
// строкой, как в таблице: иначе разница считалась бы по другому правилу, чем в
// бою, и тест проверял бы сам себя.
type fakeLangPackRepo struct {
	langs   map[string]domain.LangPackLanguageMeta
	version map[string]int
	strings map[string][]fakeLangPackRow
}

type fakeLangPackRow struct {
	rec     domain.LangPackStringRecord
	version int
}

func newFakeLangPackRepo() *fakeLangPackRepo {
	return &fakeLangPackRepo{
		langs:   map[string]domain.LangPackLanguageMeta{},
		version: map[string]int{},
		strings: map[string][]fakeLangPackRow{},
	}
}

func (f *fakeLangPackRepo) put(meta domain.LangPackLanguageMeta, version int, rows ...fakeLangPackRow) {
	f.langs[meta.Code] = meta
	f.version[meta.Code] = version
	f.strings[meta.Code] = rows
}

func (f *fakeLangPackRepo) Languages(context.Context) ([]domain.LangPackLanguage, error) {
	out := []domain.LangPackLanguage{}
	for _, code := range []string{"en", "ru"} {
		meta, ok := f.langs[code]
		if !ok {
			continue
		}
		out = append(out, domain.NewLangPackLanguage(meta, f.live("en"), f.live(code)))
	}
	return out, nil
}

func (f *fakeLangPackRepo) live(code string) int {
	n := 0
	for _, row := range f.strings[code] {
		if !row.rec.Deleted {
			n++
		}
	}
	return n
}

func (f *fakeLangPackRepo) Language(_ context.Context, code string) (domain.LangPackLanguage, error) {
	meta, ok := f.langs[code]
	if !ok {
		return domain.LangPackLanguage{}, domain.ErrNotFound
	}
	return domain.NewLangPackLanguage(meta, f.live("en"), f.live(code)), nil
}

func (f *fakeLangPackRepo) Version(_ context.Context, code string) (int, error) {
	v, ok := f.version[code]
	if !ok {
		return 0, domain.ErrNotFound
	}
	return v, nil
}

func (f *fakeLangPackRepo) Strings(_ context.Context, code string, since int, withDeleted bool) ([]domain.LangPackStringRecord, error) {
	var out []domain.LangPackStringRecord
	for _, row := range f.strings[code] {
		if row.version <= since || (row.rec.Deleted && !withDeleted) {
			continue
		}
		out = append(out, row.rec)
	}
	return out, nil
}

func (f *fakeLangPackRepo) StringsByKeys(_ context.Context, code string, keys []string) ([]domain.LangPackStringRecord, error) {
	want := map[string]bool{}
	for _, k := range keys {
		want[k] = true
	}
	var out []domain.LangPackStringRecord
	for _, row := range f.strings[code] {
		if want[row.rec.Key] {
			out = append(out, row.rec)
		}
	}
	return out, nil
}

func (f *fakeLangPackRepo) Apply(context.Context, domain.LangPackLanguageMeta, int, []domain.LangPackStringRecord) error {
	return nil
}

// langPackRouter — те же ручки, что в бою, зарегистрированные тем же роутером.
// Остальные подсистемы не подключены: языковой пакет не зависит ни от одной из
// них и живёт ВНЕ группы Bearer.
func langPackRouter(t *testing.T) http.Handler {
	t.Helper()
	repo := newFakeLangPackRepo()
	en := domain.LangPackLanguageMeta{Code: "en", Name: "English", NativeName: "English", PluralCode: "en"}
	ru := domain.LangPackLanguageMeta{Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en"}

	add := "Add"
	repo.put(en, 3,
		fakeLangPackRow{rec: domain.LangPackStringRecord{Key: "Add", Value: &add}, version: 1},
		fakeLangPackRow{rec: domain.LangPackStringRecord{Key: "Cancel", Value: strptr("Cancel")}, version: 3},
		fakeLangPackRow{rec: domain.LangPackStringRecord{Key: "Obsolete", Deleted: true}, version: 3},
	)
	repo.put(ru, 1,
		fakeLangPackRow{rec: domain.LangPackStringRecord{Key: "Notifications.Count", Forms: &domain.PluralForms{
			One:   strptr("%d уведомление"),
			Few:   strptr("%d уведомления"),
			Many:  strptr("%d уведомлений"),
			Other: "%d уведомления",
		}}, version: 1},
	)

	h := NewLangPackHandler(usecaselangpack.New(repo))
	return NewRouter(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, h)
}

func strptr(s string) *string { return &s }

func getLangPack(t *testing.T, h http.Handler, path string) (int, []byte) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec.Code, rec.Body.Bytes()
}

// Весь пакет языка: строки есть, снятых ключей нет.
func TestLangPackHandler_LangPack(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/en")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var diff struct {
		Underscore  string `json:"_"`
		LangCode    string `json:"lang_code"`
		FromVersion int    `json:"from_version"`
		Version     int    `json:"version"`
		Strings     []struct {
			Underscore string `json:"_"`
			Key        string `json:"key"`
			Value      string `json:"value"`
		} `json:"strings"`
	}
	if err := json.Unmarshal(body, &diff); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if diff.Underscore != domain.LangPackDifferenceTag {
		t.Errorf("витрина = %q; пакет отдаётся конструктором разницы", diff.Underscore)
	}
	if diff.FromVersion != 0 || diff.Version != 3 {
		t.Errorf("границы = (%d, %d); want (0, 3)", diff.FromVersion, diff.Version)
	}
	if len(diff.Strings) != 2 {
		t.Fatalf("строк %d; снятый ключ в полный пакет не входит: %s", len(diff.Strings), body)
	}
	for _, s := range diff.Strings {
		if s.Underscore == domain.LangPackStringDeletedTag {
			t.Errorf("в полном пакете снятый ключ %q", s.Key)
		}
	}
}

// Разница отдаёт ТОЛЬКО изменившееся после версии клиента и снятые ключи
// конструктором `langPackStringDeleted`.
func TestLangPackHandler_Difference(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/en/difference?from_version=2")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var diff struct {
		FromVersion int `json:"from_version"`
		Version     int `json:"version"`
		Strings     []struct {
			Underscore string `json:"_"`
			Key        string `json:"key"`
		} `json:"strings"`
	}
	if err := json.Unmarshal(body, &diff); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if diff.FromVersion != 2 || diff.Version != 3 {
		t.Errorf("границы = (%d, %d); want (2, 3)", diff.FromVersion, diff.Version)
	}
	got := map[string]string{}
	for _, s := range diff.Strings {
		got[s.Key] = s.Underscore
	}
	if len(got) != 2 {
		t.Fatalf("в разнице %v; ожидались только Cancel и снятый Obsolete", got)
	}
	if _, stale := got["Add"]; stale {
		t.Error("в разнице приехал Add версии 1 — ручка отдала весь пакет вместо разницы")
	}
	if got["Obsolete"] != domain.LangPackStringDeletedTag {
		t.Errorf("снятый ключ приехал как %q; want langPackStringDeleted", got["Obsolete"])
	}
}

// Версия клиента ОБЯЗАТЕЛЬНА. Подставленный вместо неё ноль превратил бы разницу
// во весь пакет молча — ошибка клиента выглядела бы как рабочая ручка.
func TestLangPackHandler_DifferenceRequiresVersion(t *testing.T) {
	h := langPackRouter(t)

	for _, path := range []string{
		"/langpack/en/difference",
		"/langpack/en/difference?from_version=",
		"/langpack/en/difference?from_version=abc",
		"/langpack/en/difference?from_version=-1",
	} {
		code, body := getLangPack(t, h, path)
		if code != http.StatusBadRequest {
			t.Errorf("%s: код %d, тело %s", path, code, body)
			continue
		}
		if name := errorName(t, body); name != errFromVersionInvalid {
			t.Errorf("%s: имя отказа %q; want %q", path, name, errFromVersionInvalid)
		}
	}
}

// Доспрос ключей: ответ на КАЖДЫЙ ключ, ненайденный — снятым.
func TestLangPackHandler_Strings(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/en/strings?key=Add&key=NoSuchKey")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var out []struct {
		Underscore string `json:"_"`
		Key        string `json:"key"`
		Value      string `json:"value"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if len(out) != 2 {
		t.Fatalf("ответов %d на 2 ключа: %s", len(out), body)
	}
	if out[0].Key != "Add" || out[0].Value != "Add" {
		t.Errorf("первый ответ = %+v", out[0])
	}
	if out[1].Key != "NoSuchKey" || out[1].Underscore != domain.LangPackStringDeletedTag {
		t.Errorf("ненайденный ключ = %+v; want langPackStringDeleted", out[1])
	}
}

// Формы числа доезжают до клиента ПАРАМЕТРАМИ СХЕМЫ, каждая под своим именем.
func TestLangPackHandler_PluralFormsReachClient(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/ru")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var diff struct {
		Strings []map[string]any `json:"strings"`
	}
	if err := json.Unmarshal(body, &diff); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if len(diff.Strings) != 1 {
		t.Fatalf("строк %d: %s", len(diff.Strings), body)
	}
	s := diff.Strings[0]
	if s["_"] != domain.LangPackStringPluralizedTag {
		t.Fatalf("витрина = %v; ожидалась строка с формами числа", s["_"])
	}
	for param, want := range map[string]string{
		"one_value":   "%d уведомление",
		"few_value":   "%d уведомления",
		"many_value":  "%d уведомлений",
		"other_value": "%d уведомления",
	} {
		if s[param] != want {
			t.Errorf("%s = %v; want %q", param, s[param], want)
		}
	}
	// Формы, которых у русского нет, не должны приехать пустыми строками:
	// пустую строку клиент показал бы пользователю пустотой.
	for _, absent := range []string{"zero_value", "two_value"} {
		if v, present := s[absent]; present {
			t.Errorf("%s приехал со значением %v; форма без значения не едет вовсе", absent, v)
		}
	}
}

// Список языков — вектор верхнего уровня, база первой, счётчики на месте.
func TestLangPackHandler_Languages(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/languages")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var langs []struct {
		Underscore      string          `json:"_"`
		LangCode        string          `json:"lang_code"`
		Name            string          `json:"name"`
		NativeName      string          `json:"native_name"`
		BaseLangCode    *string         `json:"base_lang_code"`
		PluralCode      string          `json:"plural_code"`
		StringsCount    int             `json:"strings_count"`
		TranslatedCount int             `json:"translated_count"`
		PFlags          map[string]bool `json:"pFlags"`
	}
	if err := json.Unmarshal(body, &langs); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if len(langs) != 2 || langs[0].LangCode != "en" {
		t.Fatalf("языки = %+v", langs)
	}
	if langs[0].BaseLangCode != nil {
		t.Errorf("у базы base_lang_code = %v", *langs[0].BaseLangCode)
	}
	if langs[1].BaseLangCode == nil || *langs[1].BaseLangCode != "en" {
		t.Errorf("у русского base_lang_code = %v", langs[1].BaseLangCode)
	}
	if langs[1].NativeName != "Русский" || langs[1].Name != "Russian" {
		t.Errorf("имена русского = (%q, %q)", langs[1].Name, langs[1].NativeName)
	}
	if langs[1].StringsCount != 2 || langs[1].TranslatedCount != 1 {
		t.Errorf("счётчики русского = %d/%d; want 1 из 2", langs[1].TranslatedCount, langs[1].StringsCount)
	}
	if !langs[0].PFlags["official"] {
		t.Error("official не поднят: наши языки едут вместе с приложением")
	}
}

// Один язык по коду.
func TestLangPackHandler_Language(t *testing.T) {
	h := langPackRouter(t)

	code, body := getLangPack(t, h, "/langpack/languages/ru")
	if code != http.StatusOK {
		t.Fatalf("код %d, тело %s", code, body)
	}
	var lang struct {
		Underscore string `json:"_"`
		LangCode   string `json:"lang_code"`
	}
	if err := json.Unmarshal(body, &lang); err != nil {
		t.Fatalf("тело не разбирается: %v (%s)", err, body)
	}
	if lang.Underscore != domain.LangPackLanguageTag || lang.LangCode != "ru" {
		t.Errorf("язык = %+v", lang)
	}
}

// Неизвестный язык — 404 с ИМЕНЕМ отказа на каждой из четырёх ручек.
//
// Имя (а не текст) — то, по чему ветвится клиент: «такого языка нет» он обязан
// отличать от «сервер лёг», и по 404 без имени не отличит.
func TestLangPackHandler_UnknownLanguage(t *testing.T) {
	h := langPackRouter(t)

	for _, path := range []string{
		"/langpack/xx",
		"/langpack/xx/difference?from_version=1",
		"/langpack/xx/strings?key=Add",
		"/langpack/languages/xx",
		// Не код языка вовсе: отсеивается до похода в хранилище, ответ тот же.
		"/langpack/AAAAAAAAAAAAAAAAAAAAAA",
		"/langpack/languages/ru%20ru",
	} {
		code, body := getLangPack(t, h, path)
		if code != http.StatusNotFound {
			t.Errorf("%s: код %d, тело %s", path, code, body)
			continue
		}
		if name := errorName(t, body); name != errLangCodeNotSupported {
			t.Errorf("%s: имя отказа %q; want %q", path, name, errLangCodeNotSupported)
		}
	}
}

// Ручки живут ВНЕ группы Bearer: строки нужны экрану входа, то есть до токена.
func TestLangPackHandler_NeedsNoToken(t *testing.T) {
	h := langPackRouter(t)

	for _, path := range []string{"/langpack/languages", "/langpack/en", "/langpack/en/difference?from_version=1"} {
		if code, body := getLangPack(t, h, path); code != http.StatusOK {
			t.Errorf("%s без токена: код %d, тело %s", path, code, body)
		}
	}
}

// Доспрос ограничен: сотней ключей доспрашивают, тысячей выкачивают пакет в
// обход getLangPack.
func TestLangPackHandler_StringsKeyLimit(t *testing.T) {
	h := langPackRouter(t)

	var q strings.Builder
	q.WriteString("/langpack/en/strings?key=A")
	for i := 0; i < usecaselangpack.MaxStringKeys; i++ {
		q.WriteString("&key=B")
	}
	code, body := getLangPack(t, h, q.String())
	if code != http.StatusBadRequest {
		t.Fatalf("код %d, тело %s", code, body)
	}
	if name := errorName(t, body); name != errLangKeysTooMany {
		t.Errorf("имя отказа %q; want %q", name, errLangKeysTooMany)
	}
}

// errorName — имя отказа из тела: конструктор `error{code, text}`, и `text` —
// то, что становится `HttpError.type` у клиента.
func errorName(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Underscore string `json:"_"`
		Code       int    `json:"code"`
		Text       string `json:"text"`
	}
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatalf("тело отказа не разбирается: %v (%s)", err, body)
	}
	if e.Underscore != domain.ErrorTag {
		t.Fatalf("тело отказа = %s; ожидался конструктор error", body)
	}
	return e.Text
}
