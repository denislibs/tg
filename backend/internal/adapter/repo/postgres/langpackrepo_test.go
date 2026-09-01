package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

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
//
// Все сценарии живут ПОДТЕСТАМИ одного теста и делят ОДИН контейнер Postgres.
// Раньше их было одиннадцать, и каждый поднимал свой: одиннадцать контейнеров
// по три с половиной секунды — почти сорок секунд к пакету, у которого бюджет
// `go test` (10 минут по умолчанию) и без того почти выбран. Изоляцию даёт не
// отдельная база, а `reset` перед каждым сценарием.

type langPackEnv struct {
	uc   *usecaselangpack.Interactor
	pool *pgxpool.Pool
	ctx  context.Context
}

// reset возвращает пакет к пустому состоянию: сценарии считают версии от нуля,
// и остатки предыдущего сценария сделали бы их выдуманными.
func (e langPackEnv) reset(t *testing.T) {
	t.Helper()
	if _, err := e.pool.Exec(e.ctx, `TRUNCATE langpack_strings, langpack_languages CASCADE`); err != nil {
		t.Fatalf("очистка пакета: %v", err)
	}
}

var enMeta = domain.LangPackLanguageMeta{Code: "en", Name: "English", NativeName: "English", PluralCode: "en", Position: 1}
var ruMeta = domain.LangPackLanguageMeta{Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en", Position: 2}

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

func derefForm(s *string) string {
	if s == nil {
		return "<нет формы>"
	}
	return *s
}

func TestLangPack(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	e := langPackEnv{uc: usecaselangpack.New(NewLangPackRepo(pool)), pool: pool, ctx: context.Background()}
	uc, ctx := e.uc, e.ctx

	// Первый сид: язык появляется с версией ИСТОЧНИКА, весь пакет отдаётся от нуля.
	t.Run("первый сид берёт версию источника", func(t *testing.T) {
		e.reset(t)
		version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Cancel", "Cancel"),
		}, 7)
		if err != nil {
			t.Fatalf("Sync: %v", err)
		}
		if version != 7 {
			t.Fatalf("версия после первого сида = %d; want 7 — её назначает источник, а не сид", version)
		}

		pack, err := uc.LangPack(ctx, "en")
		if err != nil {
			t.Fatalf("LangPack: %v", err)
		}
		if pack.Version != 7 || pack.FromVersion != 0 || pack.LangCode != "en" {
			t.Errorf("пакет = %+v; ожидались en, from 0, version 7", pack)
		}
		if got := keysOf(pack.Strings); len(got) != 2 || got["Add"] != domain.LangPackStringTag {
			t.Errorf("строки пакета = %v", got)
		}
	})

	// ГЛАВНОЕ утверждение о версии: она переживает сброс базы.
	//
	// `Down` роняет обе таблицы целиком, и версия, которую считал бы сид
	// («предыдущая плюс один»), после «откатили-накатили» начиналась бы с
	// единицы. Клиент, дошедший до седьмой, не принял бы от сервера ни одной
	// строки больше НИКОГДА: он применяет разницу, только когда её версия
	// больше сохранённой (tweb `langPack.ts:770-773`), а применяя — требует
	// точного совпадения с `from_version` (`:710-713`), иначе уходит в петлю.
	t.Run("версия переживает сброс базы", func(t *testing.T) {
		e.reset(t)
		strings := []domain.LangPackStringRecord{plain("Add", "Add")}
		if _, err := uc.Sync(ctx, enMeta, strings, 7); err != nil {
			t.Fatalf("сид: %v", err)
		}

		// Всё, что знала база о языке, потеряно — ровно как после Down/Up.
		e.reset(t)

		version, err := uc.Sync(ctx, enMeta, strings, 7)
		if err != nil {
			t.Fatalf("сид после сброса: %v", err)
		}
		if version != 7 {
			t.Fatalf("версия после сброса базы = %d; want 7 — клиент на седьмой замёрз бы навсегда", version)
		}
		pack, err := uc.LangPack(ctx, "en")
		if err != nil {
			t.Fatalf("LangPack: %v", err)
		}
		if pack.Version != 7 {
			t.Errorf("пакет отдаёт версию %d; want 7", pack.Version)
		}
	})

	// Повторный сид тех же строк НЕ растит версию: иначе каждый перезапуск
	// сервера объявлял бы весь пакет изменившимся, и любой клиент выкачивал бы
	// пять тысяч строк заново — на ровном месте.
	t.Run("повторный сид не двигает версию", func(t *testing.T) {
		e.reset(t)
		want := []domain.LangPackStringRecord{plain("Add", "Add"), notificationsRU()}
		if _, err := uc.Sync(ctx, enMeta, want, 4); err != nil {
			t.Fatalf("первый сид: %v", err)
		}
		version, err := uc.Sync(ctx, enMeta, want, 4)
		if err != nil {
			t.Fatalf("повторный сид: %v", err)
		}
		if version != 4 {
			t.Errorf("версия после повторного сида = %d; want 4 — ничего не изменилось", version)
		}
	})

	// Строки разошлись, а версия источника не выросла — снимок не
	// перегенерирован. Записать такие строки значит отдать их клиенту НИКОГДА:
	// он спросит разницу от той же версии и получит пустоту.
	t.Run("изменение без роста версии — отказ", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 4); err != nil {
			t.Fatalf("первый сид: %v", err)
		}
		_, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Добавить")}, 4)
		if !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("сид правленых строк под той же версией = %v; ожидался отказ", err)
		}
		// Откат бинаря: снимок старее базы. Версию назад не двигаем.
		_, err = uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Добавить")}, 2)
		if !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("сид со снимка старее базы = %v; ожидался отказ", err)
		}
		version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 2)
		if err != nil {
			t.Fatalf("сид неизменных строк со старого снимка: %v", err)
		}
		if version != 4 {
			t.Errorf("версия = %d; want 4 — назад она не двигается", version)
		}
	})

	// Версия источника меньше единицы — испорченный снимок, и залить его
	// нельзя. Ноль клиент читает как «пакета нет»: он спросит весь пакет
	// заново, получит в ответе тот же ноль и спросит опять — петля.
	t.Run("версия источника меньше единицы — отказ", func(t *testing.T) {
		e.reset(t)
		for _, bad := range []int{0, -1} {
			_, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, bad)
			if !errors.Is(err, usecaselangpack.ErrVersionInvalid) {
				t.Errorf("Sync с версией источника %d = %v; ожидался ErrVersionInvalid", bad, err)
			}
		}
		if _, err := uc.Language(ctx, "en"); !errors.Is(err, domain.ErrNotFound) {
			t.Error("язык залился, хотя версия источника невозможна")
		}
	})

	// Разница отдаёт ТОЛЬКО изменившееся. Ручка, отдающая всё, задачу не решает:
	// клиент выкачивал бы пакет целиком на каждой правке одной строки.
	t.Run("разница везёт только изменившееся", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
		}, 1); err != nil {
			t.Fatalf("первый сид: %v", err)
		}
		version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add to contacts"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
		}, 2)
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
		// строки, то есть разница молча стала бы полным пакетом.
		if _, err := uc.Difference(ctx, "en", -1); !errors.Is(err, usecaselangpack.ErrVersionInvalid) {
			t.Errorf("Difference(-1) = %v; ожидался отказ ErrVersionInvalid", err)
		}
	})

	// Версия ИЗ БУДУЩЕГО (клиент с более нового деплоя): пустая разница с
	// границей `from_version` больше `version` — значение, которого не бывает.
	// Отдаём весь пакет: это самое полное, что у сервера есть.
	t.Run("версия из будущего даёт весь пакет", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Cancel", "Cancel"),
		}, 2); err != nil {
			t.Fatalf("сид: %v", err)
		}
		diff, err := uc.Difference(ctx, "en", 99)
		if err != nil {
			t.Fatalf("Difference(99): %v", err)
		}
		if diff.FromVersion != 0 || diff.Version != 2 {
			t.Errorf("границы = (%d, %d); want (0, 2) — весь пакет", diff.FromVersion, diff.Version)
		}
		if len(diff.Strings) != 2 {
			t.Errorf("строк %d; ожидался весь пакет", len(diff.Strings))
		}
	})

	// Снятый ключ приезжает `langPackStringDeleted`. Без него клиент, однажды
	// получивший строку, хранил бы её вечно: разница молчит о том, чего в ней
	// нет, и снятый перевод остался бы на экране навсегда.
	t.Run("снятый ключ приезжает langPackStringDeleted", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Obsolete", "Obsolete"),
		}, 1); err != nil {
			t.Fatalf("первый сид: %v", err)
		}
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 2); err != nil {
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

		// В ПОЛНОМ пакете снятого ключа нет вовсе: клиенту, который его не
		// видел, удалять нечего.
		pack, err := uc.LangPack(ctx, "en")
		if err != nil {
			t.Fatalf("LangPack: %v", err)
		}
		if _, present := keysOf(pack.Strings)["Obsolete"]; present {
			t.Errorf("снятый ключ приехал в полном пакете: %v", keysOf(pack.Strings))
		}

		// Третий сид не снимает уже снятое повторно: версия не растёт.
		version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 2)
		if err != nil {
			t.Fatalf("третий сид: %v", err)
		}
		if version != 2 {
			t.Errorf("версия после третьего сида = %d; want 2 — снимать больше нечего", version)
		}

		// Вернувшийся ключ снова становится строкой, а не остаётся снятым.
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Obsolete", "Back"),
		}, 3); err != nil {
			t.Fatalf("четвёртый сид: %v", err)
		}
		back, err := uc.Difference(ctx, "en", 2)
		if err != nil {
			t.Fatalf("Difference: %v", err)
		}
		if keysOf(back.Strings)["Obsolete"] != domain.LangPackStringTag {
			t.Errorf("вернувшийся ключ приехал как %v", keysOf(back.Strings))
		}
	})

	// Формы числа переживают запись в базу КАЖДАЯ В СВОЕЙ колонке. Проверка
	// адресует формы именами: `many` («5 уведомлений») и `other` («1,5
	// уведомления») — разные тексты, и перепутанные местами они разъезжаются молча.
	t.Run("формы числа переживают запись в базу", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 1); err != nil {
			t.Fatalf("сид базы: %v", err)
		}
		if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{notificationsRU()}, 1); err != nil {
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
	})

	// Правка ОДНОЙ формы числа — это изменение строки: она едет в разнице. Без
	// поформенного сравнения («текст тот же, раз ключ тот же») правка перевода
	// во множественном числе не доехала бы до клиента никогда.
	t.Run("правка одной формы едет в разнице", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 1); err != nil {
			t.Fatalf("сид базы: %v", err)
		}
		if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{notificationsRU()}, 1); err != nil {
			t.Fatalf("сид ru: %v", err)
		}

		edited := notificationsRU()
		edited.Forms.Many = str("%d уведомлений всего")
		version, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{edited}, 2)
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
	})

	// Доспрос ключей: найденные приезжают строками, ненайденные — снятыми, и
	// ответ приходит НА КАЖДЫЙ запрошенный ключ в порядке запроса.
	t.Run("доспрос отвечает на каждый ключ", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Cancel", "Cancel"),
		}, 1); err != nil {
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

		// Предел доспроса объявлен ОДИН раз — здесь; витрина только называет
		// отказ. Метод для единиц ключей, за пакетом ходят в getLangPack.
		many := make([]string, usecaselangpack.MaxStringKeys+1)
		for i := range many {
			many[i] = "Add"
		}
		if _, err := uc.Strings(ctx, "en", many); !errors.Is(err, usecaselangpack.ErrTooManyKeys) {
			t.Errorf("доспрос %d ключей = %v; ожидался ErrTooManyKeys", len(many), err)
		}
	})

	// Счётчики языка считаются по строкам: «сколько всего» — свойство БАЗЫ,
	// «сколько переведено» — свойство языка.
	t.Run("счётчики считаются по строкам", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{
			plain("Add", "Add"), plain("Cancel", "Cancel"), plain("Delete", "Delete"),
		}, 1); err != nil {
			t.Fatalf("сид базы: %v", err)
		}
		if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{plain("Add", "Добавить")}, 1); err != nil {
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
		if _, err := uc.Sync(ctx, ruMeta, nil, 2); err != nil {
			t.Fatalf("сид ru без строк: %v", err)
		}
		ru, err = uc.Language(ctx, "ru")
		if err != nil {
			t.Fatalf("Language: %v", err)
		}
		if ru.TranslatedCount != 0 {
			t.Errorf("переведено %d после снятия единственной строки", ru.TranslatedCount)
		}
	})

	// Порядок выдачи задаёт СЕРВЕР: клиент рисует список перебором и не
	// сортирует (tweb `language.tsx:117`). Русский обязан идти вторым — таким
	// его видит пользователь на нынешнем экране настроек, и замена местного
	// списка серверной выдачей (задача 5) не должна его переставлять.
	t.Run("порядок языков задаёт сервер", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 1); err != nil {
			t.Fatalf("сид базы: %v", err)
		}
		// Немецкий стоит в источнике ПОСЛЕ русского, хотя по алфавиту
		// английского имени German идёт раньше Russian: именно это различает
		// «порядок источника» и «сортировку по имени».
		deMeta := domain.LangPackLanguageMeta{
			Code: "de", Name: "German", NativeName: "Deutsch", PluralCode: "de", BaseCode: "en", Position: 4,
		}
		if _, err := uc.Sync(ctx, deMeta, []domain.LangPackStringRecord{plain("Add", "Hinzufügen")}, 1); err != nil {
			t.Fatalf("сид de: %v", err)
		}
		if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{plain("Add", "Добавить")}, 1); err != nil {
			t.Fatalf("сид ru: %v", err)
		}

		langs, err := uc.Languages(ctx)
		if err != nil {
			t.Fatalf("Languages: %v", err)
		}
		var codes []string
		for _, l := range langs {
			codes = append(codes, l.LangCode)
		}
		if len(codes) != 3 || codes[0] != "en" || codes[1] != "ru" || codes[2] != "de" {
			t.Errorf("порядок = %v; want [en ru de] — порядок источника, а не алфавит имён", codes)
		}

		// Порядок переставили в источнике: немецкий поднялся выше русского.
		// Позиция обязана обновиться у УЖЕ ЗАЛИТОГО языка — иначе первый сид
		// задавал бы её навсегда, и правка порядка не доехала бы никогда.
		deMeta.Position = 2
		ruMoved := ruMeta
		ruMoved.Position = 4
		if _, err := uc.Sync(ctx, deMeta, []domain.LangPackStringRecord{plain("Add", "Hinzufügen")}, 1); err != nil {
			t.Fatalf("пересид de: %v", err)
		}
		if _, err := uc.Sync(ctx, ruMoved, []domain.LangPackStringRecord{plain("Add", "Добавить")}, 1); err != nil {
			t.Fatalf("пересид ru: %v", err)
		}
		langs, err = uc.Languages(ctx)
		if err != nil {
			t.Fatalf("Languages: %v", err)
		}
		codes = codes[:0]
		for _, l := range langs {
			codes = append(codes, l.LangCode)
		}
		if len(codes) != 3 || codes[1] != "de" || codes[2] != "ru" {
			t.Errorf("после перестановки порядок = %v; want [en de ru]", codes)
		}
	})

	// Неизвестный язык — отказ, а не пустой пакет. Пустой пакет клиент прочитал
	// бы как «в этом языке нет строк» и остался бы на нём навсегда.
	t.Run("неизвестный язык — отказ", func(t *testing.T) {
		e.reset(t)
		if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 1); err != nil {
			t.Fatalf("сид: %v", err)
		}
		for name, call := range map[string]func() error{
			"LangPack":   func() error { _, err := uc.LangPack(ctx, "xx"); return err },
			"Difference": func() error { _, err := uc.Difference(ctx, "xx", 1); return err },
			"Language":   func() error { _, err := uc.Language(ctx, "xx"); return err },
			"Strings":    func() error { _, err := uc.Strings(ctx, "xx", []string{"Add"}); return err },
		} {
			if err := call(); !errors.Is(err, domain.ErrNotFound) {
				t.Errorf("%s чужого языка = %v; ожидался ErrNotFound", name, err)
			}
		}
	})

	// Живая проверка на НАСТОЯЩИХ данных: вшитый снимок словарей клиента
	// заливается целиком и читается обратно тем же путём, каким уедет клиенту.
	// Пакетная запись (unnest параллельных массивов) на трёх строках выглядит
	// одинаково и с перепутанными колонками — на пяти тысячах видно сразу.
	t.Run("живой снимок заливается целиком", func(t *testing.T) {
		e.reset(t)
		pack, err := langsource.Embedded()
		if err != nil {
			t.Fatalf("снимок словарей не читается: %v", err)
		}
		if len(pack.Languages) < 2 {
			t.Fatalf("в снимке %d языков", len(pack.Languages))
		}

		sizes := map[string]int{}
		for _, lang := range pack.Languages {
			version, err := uc.Sync(ctx, lang.LangPackLanguageMeta, lang.Strings, lang.Version)
			if err != nil {
				t.Fatalf("сид %s: %v", lang.Code, err)
			}
			if version != lang.Version {
				t.Errorf("версия %s = %d; в снимке %d", lang.Code, version, lang.Version)
			}
			sizes[lang.Code] = len(lang.Strings)
		}

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
			version, err := uc.Sync(ctx, lang.LangPackLanguageMeta, lang.Strings, lang.Version)
			if err != nil {
				t.Fatalf("повторный сид %s: %v", lang.Code, err)
			}
			if version != lang.Version {
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

		// Счётчики и порядок на живых данных.
		langs, err := uc.Languages(ctx)
		if err != nil {
			t.Fatalf("Languages: %v", err)
		}
		if len(langs) != len(pack.Languages) {
			t.Fatalf("языков %d, залито %d", len(langs), len(pack.Languages))
		}
		for i, l := range langs {
			if l.LangCode != pack.Languages[i].Code {
				t.Errorf("на месте %d язык %s; в источнике %s", i, l.LangCode, pack.Languages[i].Code)
			}
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
	})
}
