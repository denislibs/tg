package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/langsource"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecaselangpack "github.com/messenger-denis/backend/internal/usecase/langpack"
)

// Языковой пакет на настоящем Postgres: версии, разница и снятые ключи.
//
// На фейке эти утверждения не проверяются: версия строки — колонка, разница —
// условие `version > $2`, а «ровно один вид строки» — CHECK. Фейк, повторивший
// их в Go, проверял бы сам себя.

func langPackEnv(t *testing.T) (*usecaselangpack.Interactor, context.Context) {
	t.Helper()
	return usecaselangpack.New(NewLangPackRepo(storepostgres.NewTestDB(t))), context.Background()
}

var enMeta = domain.LangPackLanguageMeta{Code: "en", Name: "English", NativeName: "English", PluralCode: "en"}
var ruMeta = domain.LangPackLanguageMeta{Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en"}

func plain(key, value string) domain.LangPackStringRecord {
	v := value
	return domain.LangPackStringRecord{Key: key, Value: &v}
}

func str(s string) *string { return &s }

// notificationsRU — живая строка с формами числа: «уведомлений» это CLDR-many, а
// «уведомления» в other достаётся дробным («1,5 уведомления»).
func notificationsRU() domain.LangPackStringRecord {
	return domain.LangPackStringRecord{Key: "Notifications.Count", Forms: &domain.PluralForms{
		One:   str("%d уведомление"),
		Few:   str("%d уведомления"),
		Many:  str("%d уведомлений"),
		Other: "%d уведомления",
	}}
}

// keysOf — ключи выдачи вместе с конструктором, которым они приехали.
func keysOf(strings []domain.LangPackString) map[string]string {
	out := map[string]string{}
	for _, s := range strings {
		out[s.Key()] = s.Tag()
	}
	return out
}

// Первый сид: язык появляется с версией 1, весь пакет отдаётся от нуля.
func TestLangPack_FirstSyncGivesVersionOne(t *testing.T) {
	uc, ctx := langPackEnv(t)

	version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Cancel", "Cancel"),
	})
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if version != 1 {
		t.Fatalf("версия после первого сида = %d; want 1", version)
	}

	pack, err := uc.LangPack(ctx, "en")
	if err != nil {
		t.Fatalf("LangPack: %v", err)
	}
	if pack.Version != 1 || pack.FromVersion != 0 || pack.LangCode != "en" {
		t.Errorf("пакет = %+v; ожидались en, from 0, version 1", pack)
	}
	if got := keysOf(pack.Strings); len(got) != 2 || got["Add"] != domain.LangPackStringTag {
		t.Errorf("строки пакета = %v", got)
	}
}

// Повторный сид тех же строк НЕ растит версию.
//
// Иначе каждый перезапуск сервера объявлял бы весь пакет изменившимся, и любой
// клиент выкачивал бы пять тысяч строк заново — на ровном месте.
func TestLangPack_RepeatedSyncKeepsVersion(t *testing.T) {
	uc, ctx := langPackEnv(t)
	want := []domain.LangPackStringRecord{plain("Add", "Add"), notificationsRU()}

	if _, err := uc.Sync(ctx, enMeta, want); err != nil {
		t.Fatalf("первый сид: %v", err)
	}
	version, err := uc.Sync(ctx, enMeta, want)
	if err != nil {
		t.Fatalf("повторный сид: %v", err)
	}
	if version != 1 {
		t.Errorf("версия после повторного сида = %d; want 1 — ничего не изменилось", version)
	}
}

// Разница от версии клиента содержит ТОЛЬКО изменившееся.
//
// Это и есть суть `getDifference`. Ручка, отдающая всё, задачу не решает:
// клиент, у которого пакет уже есть, качал бы его целиком на каждой правке
// одной строки.
func TestLangPack_DifferenceCarriesOnlyChanges(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
	}); err != nil {
		t.Fatalf("первый сид: %v", err)
	}
	// Правится одна строка из трёх.
	version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add to contacts"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
	})
	if err != nil {
		t.Fatalf("второй сид: %v", err)
	}
	if version != 2 {
		t.Fatalf("версия после правки = %d; want 2", version)
	}

	diff, err := uc.Difference(ctx, "en", 1)
	if err != nil {
		t.Fatalf("Difference: %v", err)
	}
	if diff.FromVersion != 1 || diff.Version != 2 {
		t.Errorf("границы разницы = (%d, %d); want (1, 2)", diff.FromVersion, diff.Version)
	}
	got := keysOf(diff.Strings)
	if len(got) != 1 {
		t.Fatalf("в разнице %d строк: %v; изменилась одна", len(got), got)
	}
	if _, ok := got["Add"]; !ok {
		t.Errorf("в разнице %v; ожидался ключ Add", got)
	}
	if s, ok := diff.Strings[0].(domain.LangPackStringPlain); !ok || s.Value != "Add to contacts" {
		t.Errorf("в разнице приехало %+v; ожидался новый текст", diff.Strings[0])
	}

	// Клиент на текущей версии получает ПУСТУЮ разницу, а не «весь пакет ещё раз».
	empty, err := uc.Difference(ctx, "en", 2)
	if err != nil {
		t.Fatalf("Difference(2): %v", err)
	}
	if len(empty.Strings) != 0 {
		t.Errorf("разница от текущей версии = %v; ожидалась пустая", keysOf(empty.Strings))
	}

	// Отрицательной версии не бывает: у хранилища `version > -1` — это ВСЕ
	// строки, то есть разница молча стала бы полным пакетом. Отказ здесь, а не
	// только на витрине: витрина ловит непрочитанное число, а бессмысленный
	// аргумент — правило самого метода.
	if _, err := uc.Difference(ctx, "en", -1); !errors.Is(err, domain.ErrInvalid) {
		t.Errorf("Difference(-1) = %v; ожидался отказ ErrInvalid", err)
	}
}

// Снятый ключ приезжает `langPackStringDeleted`.
//
// Без него клиент, однажды получивший строку, хранил бы её вечно: разница
// молчит о том, чего в ней нет, и снятый перевод остался бы на экране навсегда.
func TestLangPack_RemovedKeyArrivesDeleted(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Obsolete", "Obsolete"),
	}); err != nil {
		t.Fatalf("первый сид: %v", err)
	}
	// Ключ исчез из источника.
	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}); err != nil {
		t.Fatalf("второй сид: %v", err)
	}

	diff, err := uc.Difference(ctx, "en", 1)
	if err != nil {
		t.Fatalf("Difference: %v", err)
	}
	got := keysOf(diff.Strings)
	if got["Obsolete"] != domain.LangPackStringDeletedTag {
		t.Fatalf("снятый ключ приехал как %q (вся разница: %v); want langPackStringDeleted",
			got["Obsolete"], got)
	}

	// А в ПОЛНОМ пакете снятого ключа нет вовсе: клиенту, который его не видел,
	// удалять нечего.
	pack, err := uc.LangPack(ctx, "en")
	if err != nil {
		t.Fatalf("LangPack: %v", err)
	}
	if _, present := keysOf(pack.Strings)["Obsolete"]; present {
		t.Errorf("снятый ключ приехал в полном пакете: %v", keysOf(pack.Strings))
	}

	// Третий сид не снимает уже снятое повторно: версия не растёт.
	version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")})
	if err != nil {
		t.Fatalf("третий сид: %v", err)
	}
	if version != 2 {
		t.Errorf("версия после третьего сида = %d; want 2 — снимать больше нечего", version)
	}

	// Вернувшийся ключ снова становится строкой, а не остаётся снятым.
	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Obsolete", "Back"),
	}); err != nil {
		t.Fatalf("четвёртый сид: %v", err)
	}
	back, err := uc.Difference(ctx, "en", 2)
	if err != nil {
		t.Fatalf("Difference: %v", err)
	}
	if keysOf(back.Strings)["Obsolete"] != domain.LangPackStringTag {
		t.Errorf("вернувшийся ключ приехал как %v", keysOf(back.Strings))
	}
}

// Формы числа переживают запись в базу КАЖДАЯ В СВОЕЙ колонке.
//
// Проверка адресует формы именами: `many` («5 уведомлений») и `other` («1,5
// уведомления») — разные тексты, и перепутанные местами они разъезжаются молча.
func TestLangPack_PluralFormsSurviveRoundTrip(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}); err != nil {
		t.Fatalf("сид базы: %v", err)
	}
	if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{notificationsRU()}); err != nil {
		t.Fatalf("сид ru: %v", err)
	}

	pack, err := uc.LangPack(ctx, "ru")
	if err != nil {
		t.Fatalf("LangPack: %v", err)
	}
	if len(pack.Strings) != 1 {
		t.Fatalf("в пакете %d строк: %v", len(pack.Strings), keysOf(pack.Strings))
	}
	got, ok := pack.Strings[0].(domain.LangPackStringPluralized)
	if !ok {
		t.Fatalf("строка приехала как %T (%s); ожидалась с формами числа", pack.Strings[0], pack.Strings[0].Tag())
	}
	for name, pair := range map[string][2]string{
		"one_value":   {derefForm(got.OneValue), "%d уведомление"},
		"few_value":   {derefForm(got.FewValue), "%d уведомления"},
		"many_value":  {derefForm(got.ManyValue), "%d уведомлений"},
		"other_value": {got.OtherValue, "%d уведомления"},
	} {
		if pair[0] != pair[1] {
			t.Errorf("%s = %q; want %q", name, pair[0], pair[1])
		}
	}
	// Формы, которых у русского нет, не должны появиться пустыми строками.
	if got.ZeroValue != nil || got.TwoValue != nil {
		t.Errorf("у русского появились формы zero=%v two=%v; их в источнике не было",
			derefForm(got.ZeroValue), derefForm(got.TwoValue))
	}
}

func derefForm(s *string) string {
	if s == nil {
		return "<нет формы>"
	}
	return *s
}

// Правка ОДНОЙ формы числа — это изменение строки: версия растёт, строка едет в
// разнице. Без поформенного сравнения («текст тот же, раз ключ тот же») правка
// перевода во множественном числе не доехала бы до клиента никогда.
func TestLangPack_ChangedPluralFormBumpsVersion(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}); err != nil {
		t.Fatalf("сид базы: %v", err)
	}
	if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{notificationsRU()}); err != nil {
		t.Fatalf("сид ru: %v", err)
	}

	edited := notificationsRU()
	edited.Forms.Many = str("%d уведомлений всего")
	version, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{edited})
	if err != nil {
		t.Fatalf("правка формы: %v", err)
	}
	if version != 2 {
		t.Fatalf("версия после правки формы = %d; want 2", version)
	}
	diff, err := uc.Difference(ctx, "ru", 1)
	if err != nil {
		t.Fatalf("Difference: %v", err)
	}
	if len(diff.Strings) != 1 {
		t.Fatalf("в разнице %d строк; ожидалась правленая", len(diff.Strings))
	}
	got := diff.Strings[0].(domain.LangPackStringPluralized)
	if derefForm(got.ManyValue) != "%d уведомлений всего" {
		t.Errorf("many_value = %q; правка формы не доехала", derefForm(got.ManyValue))
	}
}

// Доспрос ключей: найденные приезжают строками, ненайденные — снятыми, и ответ
// приходит НА КАЖДЫЙ запрошенный ключ в порядке запроса.
func TestLangPack_StringsAnswersEveryKey(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Cancel", "Cancel"),
	}); err != nil {
		t.Fatalf("сид: %v", err)
	}

	got, err := uc.Strings(ctx, "en", []string{"Cancel", "NoSuchKey", "Add"})
	if err != nil {
		t.Fatalf("Strings: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("ответов %d на 3 ключа: %v", len(got), keysOf(got))
	}
	for i, want := range []struct{ key, tag string }{
		{"Cancel", domain.LangPackStringTag},
		{"NoSuchKey", domain.LangPackStringDeletedTag},
		{"Add", domain.LangPackStringTag},
	} {
		if got[i].Key() != want.key || got[i].Tag() != want.tag {
			t.Errorf("ответ %d = (%s, %s); want (%s, %s)", i, got[i].Key(), got[i].Tag(), want.key, want.tag)
		}
	}
}

// Счётчики языка считаются по строкам: «сколько всего» — свойство БАЗЫ, «сколько
// переведено» — свойство языка. Отдельными колонками они разъехались бы со
// строками при первом же неполном сиде.
func TestLangPack_LanguageCountsComeFromStrings(t *testing.T) {
	uc, ctx := langPackEnv(t)

	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
		plain("Add", "Add"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
	}); err != nil {
		t.Fatalf("сид базы: %v", err)
	}
	if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{plain("Add", "Добавить")}); err != nil {
		t.Fatalf("сид ru: %v", err)
	}

	ru, err := uc.Language(ctx, "ru")
	if err != nil {
		t.Fatalf("Language: %v", err)
	}
	if ru.StringsCount != 3 || ru.TranslatedCount != 1 {
		t.Errorf("у русского %d/%d; want 1 переведённая из 3 в базе", ru.TranslatedCount, ru.StringsCount)
	}
	if ru.BaseLangCode == nil || *ru.BaseLangCode != "en" {
		t.Errorf("base_lang_code = %v; недостающие строки берутся из английского", ru.BaseLangCode)
	}

	en, err := uc.Language(ctx, "en")
	if err != nil {
		t.Fatalf("Language(en): %v", err)
	}
	if en.StringsCount != 3 || en.TranslatedCount != 3 {
		t.Errorf("у базы %d/%d; want 3/3", en.TranslatedCount, en.StringsCount)
	}
	if en.BaseLangCode != nil {
		t.Errorf("у базы base_lang_code = %v", *en.BaseLangCode)
	}

	// Снятый ключ из счёта выбывает: он больше не строка языка.
	if _, err := uc.Sync(ctx, ruMeta, nil); err != nil {
		t.Fatalf("сид ru без строк: %v", err)
	}
	ru, err = uc.Language(ctx, "ru")
	if err != nil {
		t.Fatalf("Language: %v", err)
	}
	if ru.TranslatedCount != 0 {
		t.Errorf("переведено %d после снятия единственной строки", ru.TranslatedCount)
	}

	langs, err := uc.Languages(ctx)
	if err != nil {
		t.Fatalf("Languages: %v", err)
	}
	if len(langs) != 2 || langs[0].LangCode != "en" {
		t.Errorf("список языков = %+v; базе полагается идти первой", langs)
	}
}

// Неизвестный язык — отказ, а не пустой пакет. Пустой пакет клиент прочитал бы
// как «в этом языке нет строк» и остался бы на нём навсегда.
func TestLangPack_UnknownLanguageIsNotFound(t *testing.T) {
	uc, ctx := langPackEnv(t)
	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}); err != nil {
		t.Fatalf("сид: %v", err)
	}

	if _, err := uc.LangPack(ctx, "xx"); err == nil {
		t.Error("LangPack чужого языка прошёл")
	}
	if _, err := uc.Difference(ctx, "xx", 1); err == nil {
		t.Error("Difference чужого языка прошла")
	}
	if _, err := uc.Language(ctx, "xx"); err == nil {
		t.Error("Language чужого языка прошёл")
	}
	if _, err := uc.Strings(ctx, "xx", []string{"Add"}); err == nil {
		t.Error("Strings чужого языка прошли — вместо отказа приехали бы «снятые» ключи")
	}
}

// Живая проверка на НАСТОЯЩИХ данных: вшитый снимок словарей клиента заливается
// в базу целиком и читается обратно тем же путём, каким уедет клиенту.
//
// Отдельно от остальных тестов, потому что проверяет другое: там — правила
// (версии, разница, снятие), здесь — что эти правила выдерживают пять тысяч
// живых строк с переводами строк, апострофами и формами числа. Пакетная запись
// (unnest параллельных массивов) на трёх строках выглядит одинаково и с
// перепутанными колонками — на пяти тысячах перепутанная колонка видна сразу.
func TestLangPack_EmbeddedSnapshotSeedsWholePack(t *testing.T) {
	uc, ctx := langPackEnv(t)

	pack, err := langsource.Embedded()
	if err != nil {
		t.Fatalf("снимок словарей не читается: %v", err)
	}
	if len(pack.Languages) < 2 {
		t.Fatalf("в снимке %d языков", len(pack.Languages))
	}

	sizes := map[string]int{}
	for _, lang := range pack.Languages {
		version, err := uc.Sync(ctx, lang.LangPackLanguageMeta, lang.Strings)
		if err != nil {
			t.Fatalf("сид %s: %v", lang.Code, err)
		}
		if version != 1 {
			t.Errorf("версия %s после первого сида = %d; want 1", lang.Code, version)
		}
		sizes[lang.Code] = len(lang.Strings)
	}

	// Пакет вернулся целиком, строка в строку.
	for _, lang := range pack.Languages {
		got, err := uc.LangPack(ctx, lang.Code)
		if err != nil {
			t.Fatalf("LangPack(%s): %v", lang.Code, err)
		}
		if len(got.Strings) != sizes[lang.Code] {
			t.Errorf("%s: вернулось %d строк из %d залитых", lang.Code, len(got.Strings), sizes[lang.Code])
		}
	}

	// Повторный сид ничего не меняет: перезапуск сервера не рассылает пакет заново.
	for _, lang := range pack.Languages {
		version, err := uc.Sync(ctx, lang.LangPackLanguageMeta, lang.Strings)
		if err != nil {
			t.Fatalf("повторный сид %s: %v", lang.Code, err)
		}
		if version != 1 {
			t.Errorf("версия %s после повторного сида = %d; данные те же", lang.Code, version)
		}
	}

	// Живая строка с формами числа доехала до базы поимённо.
	got, err := uc.Strings(ctx, "ru", []string{"Notifications.Count"})
	if err != nil {
		t.Fatalf("Strings: %v", err)
	}
	forms, ok := got[0].(domain.LangPackStringPluralized)
	if !ok {
		t.Fatalf("Notifications.Count приехал как %s", got[0].Tag())
	}
	if derefForm(forms.ManyValue) != "%d уведомлений" || forms.OtherValue != "%d уведомления" {
		t.Errorf("формы = many %q, other %q", derefForm(forms.ManyValue), forms.OtherValue)
	}

	// Счётчики языков: «всего» — по базе, «переведено» — по самому языку.
	langs, err := uc.Languages(ctx)
	if err != nil {
		t.Fatalf("Languages: %v", err)
	}
	if len(langs) != len(pack.Languages) {
		t.Fatalf("языков %d, залито %d", len(langs), len(pack.Languages))
	}
	if langs[0].LangCode != "en" || langs[0].StringsCount != sizes["en"] {
		t.Errorf("база = %s, %d строк; want en, %d", langs[0].LangCode, langs[0].StringsCount, sizes["en"])
	}
	for _, l := range langs[1:] {
		if l.StringsCount != sizes["en"] {
			t.Errorf("%s: всего строк %d; счёт ведётся по базе (%d)", l.LangCode, l.StringsCount, sizes["en"])
		}
		if l.TranslatedCount != sizes[l.LangCode] {
			t.Errorf("%s: переведено %d, залито %d", l.LangCode, l.TranslatedCount, sizes[l.LangCode])
		}
		if l.TranslatedCount >= l.StringsCount {
			t.Errorf("%s: переведено %d из %d — переводы у нас неполные, база не зря объявлена",
				l.LangCode, l.TranslatedCount, l.StringsCount)
		}
	}
}
