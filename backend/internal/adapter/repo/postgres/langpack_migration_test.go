package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecaselangpack "github.com/messenger-denis/backend/internal/usecase/langpack"
)

// Миграция 0128 заводит языковой пакет: таблицу языков и таблицу строк.
//
// Проверять здесь нечего КОНВЕРТИРОВАТЬ — прежней формы у этих данных нет, до
// 0128 на бэкенде не было ни строки языка. Поэтому тест проверяет то, что
// миграция ЗАЯВЛЯЕТ, а глазами по тексту SQL не проверяется:
//
//   - строка обязана быть ровно ОДНОГО вида (CHECK langpack_strings_one_shape).
//     Без него запись с заполненными `value` и `other_value` была бы «и строка,
//     и формы числа», и читающий выбрал бы вид наугад — по порядку своих
//     условий. Цена — перепутанный текст на экране у всех, кто на этом языке;
//   - строка не может висеть без языка (внешний ключ), а удаление языка уносит
//     его строки (CASCADE) — иначе снятый язык оставил бы за собой пять тысяч
//     недостижимых строк;
//   - язык не может быть базой сам себе — клиент пошёл бы за недостающей
//     строкой к самому себе и зациклился;
//   - Down исполним, и круг вниз-вверх оставляет схему рабочей: без этого
//     миграцию нельзя откатить на живом деплое.
//
// Схема теста — по соседям (deviceidentity_migration_test.go): откат на версию
// назад, накат, запись ОБЫЧНЫМ путём (сид usecase) и чтение обычным
// репозиторием.
//
// Заодно проверяется 0129 (колонка позиции языка): она едет тем же откатом и
// накатом, и её Down обязан быть исполним ровно по той же причине.
const langPackMigrationPrevVersion = 127

func TestMigration0128_LangPackTablesHoldTheirInvariants(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	// ── 1. Откат: таблиц не остаётся ────────────────────────────────────────
	// Down, который «почти» откатывает, ломает следующий накат: CREATE TABLE
	// упадёт на уже существующей таблице, и деплой встанет.
	if err := storepostgres.MigrateDownTo(url, langPackMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", langPackMigrationPrevVersion, err)
	}
	for _, table := range []string{"langpack_strings", "langpack_languages"} {
		var exists *string
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1)::text`, table).Scan(&exists); err != nil {
			t.Fatalf("проверка %s: %v", table, err)
		}
		if exists != nil {
			t.Errorf("после отката таблица %s осталась", table)
		}
	}

	// ── 2. Накат и запись обычным путём ─────────────────────────────────────
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0128: %v", err)
	}
	uc := usecaselangpack.New(NewLangPackRepo(pool))
	if _, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 1); err != nil {
		t.Fatalf("сид базы: %v", err)
	}
	if _, err := uc.Sync(ctx, ruMeta, []domain.LangPackStringRecord{notificationsRU()}, 1); err != nil {
		t.Fatalf("сид ru: %v", err)
	}

	// 0129: позиция доехала до колонки и задаёт порядок выдачи.
	var position int
	if err := pool.QueryRow(ctx,
		`SELECT position FROM langpack_languages WHERE lang_code = 'ru'`).Scan(&position); err != nil {
		t.Fatalf("чтение позиции: %v", err)
	}
	if position != ruMeta.Position {
		t.Errorf("позиция русского = %d; want %d", position, ruMeta.Position)
	}
	pack, err := uc.LangPack(ctx, "ru")
	if err != nil {
		t.Fatalf("LangPack: %v", err)
	}
	if len(pack.Strings) != 1 || pack.Strings[0].Tag() != domain.LangPackStringPluralizedTag {
		t.Fatalf("после наката пакет = %+v", pack)
	}

	// ── 3. Ровно один вид строки ────────────────────────────────────────────
	insert := func(cols, vals string, args ...any) error {
		_, err := pool.Exec(ctx,
			`INSERT INTO langpack_strings (lang_code, key, version, `+cols+`) VALUES ('en', 'Probe', 1, `+vals+`)`, args...)
		return err
	}
	for _, tc := range []struct {
		name, cols, vals string
		args             []any
	}{
		{"и текст, и формы числа", "value, other_value", "$1, $2", []any{"текст", "формы"}},
		{"ни текста, ни форм", "value", "$1", []any{nil}},
		{"снятый ключ с текстом", "deleted, value", "TRUE, $1", []any{"текст"}},
		{"формы без обязательной other", "one_value", "$1", []any{"одна"}},
		{"текст вместе с формой числа", "value, many_value", "$1, $2", []any{"текст", "много"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := insert(tc.cols, tc.vals, tc.args...)
			if err == nil {
				_, _ = pool.Exec(ctx, `DELETE FROM langpack_strings WHERE key = 'Probe'`)
				t.Fatal("строка записалась; CHECK обязан был её отвергнуть")
			}
			if !strings.Contains(err.Error(), "langpack_strings_one_shape") {
				t.Errorf("отказ не от CHECK одной формы: %v", err)
			}
		})
	}

	// ── 4. Строка не висит без языка ────────────────────────────────────────
	if _, err := pool.Exec(ctx,
		`INSERT INTO langpack_strings (lang_code, key, value, version) VALUES ('xx', 'Add', 'Add', 1)`); err == nil {
		t.Error("строка неизвестного языка записалась")
	}

	// ── 5. Язык не бывает базой сам себе ────────────────────────────────────
	if _, err := pool.Exec(ctx,
		`UPDATE langpack_languages SET base_lang_code = 'ru' WHERE lang_code = 'ru'`); err == nil {
		t.Error("язык стал базой сам себе — клиент пошёл бы за строкой к самому себе")
	}

	// ── 6. Удаление языка уносит его строки ─────────────────────────────────
	if _, err := pool.Exec(ctx, `DELETE FROM langpack_languages WHERE lang_code = 'ru'`); err != nil {
		t.Fatalf("удаление языка: %v", err)
	}
	var orphans int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM langpack_strings WHERE lang_code = 'ru'`).Scan(&orphans); err != nil {
		t.Fatalf("подсчёт осиротевших строк: %v", err)
	}
	if orphans != 0 {
		t.Errorf("после удаления языка осталось %d его строк", orphans)
	}

	// ── 7. Откат ОДНОЙ 0129 ─────────────────────────────────────────────────
	// Отдельно от круга ниже: там откат идёт до 127, и 0128 уносит таблицу
	// целиком — колонка позиции пропала бы вместе с ней, даже если бы её Down
	// не делал ничего. Проверять Down миграции нужно на ЕЁ шаге.
	if err := storepostgres.MigrateDownTo(url, langPackMigrationPrevVersion+1); err != nil {
		t.Fatalf("откат 0129: %v", err)
	}
	hasPosition := func() bool {
		t.Helper()
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM information_schema.columns
			   WHERE table_name='langpack_languages' AND column_name='position')`).Scan(&exists); err != nil {
			t.Fatalf("проверка колонки: %v", err)
		}
		return exists
	}
	if hasPosition() {
		t.Error("после отката 0129 колонка position осталась")
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат 0129: %v", err)
	}
	if !hasPosition() {
		t.Error("после наката 0129 колонки position нет")
	}

	// ── 8. Круг вниз-вверх ──────────────────────────────────────────────────
	// Down здесь честно ТЕРЯЕТ строки: таблицы удаляются целиком. Это не потеря
	// данных — переводы живут в файлах клиента и приезжают обратно сидом при
	// старте (шапка миграции). Проверяем ровно это: после круга схема рабочая, а
	// сид наполняет её заново.
	if err := storepostgres.MigrateDownTo(url, langPackMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if _, err := uc.Language(ctx, "en"); err == nil {
		t.Error("после круга язык нашёлся; таблицы обязаны быть пустыми")
	}
	// Версия ПЕРЕЖИВАЕТ круг: её назначает снимок, а не база. Иначе клиент,
	// ушедший вперёд, после отката-наката не принял бы ни одной строки —
	// он применяет разницу, только когда её версия больше сохранённой
	// (tweb `langPack.ts:770-773`).
	version, err := uc.Sync(ctx, enMeta, []domain.LangPackStringRecord{plain("Add", "Add")}, 7)
	if err != nil {
		t.Fatalf("сид после круга: %v", err)
	}
	if version != 7 {
		t.Errorf("версия после круга = %d; want 7 — её везёт снимок, а не база", version)
	}
}
