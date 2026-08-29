package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0127 разводит реквизиты клиента по своим колонкам: браузер остаётся
// в `name` (device_model), ОС переезжает в `system_version`, версия сборки
// получает `app_version`. Прежний код склеивал браузер и ОС в ОДНУ строку имени
// («Chrome · macOS») ещё на входе, поэтому у существующих строк шов
// РАСКЛЕИВАЕТСЯ обратно — обе половины настоящие, их туда и писали.
//
// Цена ошибки — заголовок и подзаголовок строки на экране активных сеансов у
// всех, кто вошёл до миграции: половина уедет не в ту колонку и покажется
// пользователю как «Chrome · macOS, browser». Восстановить потом будет неоткуда
// — шов после первого же наката больше не найти. Поэтому проверка на настоящих
// строках в настоящем Postgres, а не на глаз по тексту SQL.
//
// Схема та же, что у соседних тестов миграций: откатываемся на версию назад,
// пишем строки как их писал прежний код, накатываем 0127 и читаем ОБЫЧНЫМ
// репозиторием — он знает только новую форму, поэтому «прочиталось» и значит
// «сконвертировалось».
const deviceIdentityMigrationPrevVersion = 126

func TestMigration0127_DeviceIdentityColumnsSplitTheGluedName(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, deviceIdentityMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", deviceIdentityMigrationPrevVersion, err)
	}

	userID := seedUser(t, pool, "+79990000701")

	// Прежний код: `name` — либо склейка «браузер · ОС», либо одно значение
	// (браузер без ОС, присланное клиентом имя, «QR login»).
	seed := func(name, tokenHash string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO devices (user_id, name, platform, token_hash) VALUES ($1,$2,'browser',$3)`,
			userID, name, tokenHash); err != nil {
			t.Fatalf("seed device %q: %v", name, err)
		}
	}
	seed("Chrome · macOS", "tok-glued")
	seed("Safari", "tok-plain")   // ОС не распозналась — склейки не было
	seed("QR login", "tok-qr")    // вход по QR: реквизитов сканера у нас нет
	seed("", "tok-empty")         // клиент не назвался вовсе
	seed("A · B · C", "tok-many") // разделитель встретился дважды

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0127: %v", err)
	}

	repo := NewAuthRepo(pool)
	devices, err := repo.ListByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	// Витрина сессий токен не отдаёт (и правильно делает), поэтому адресуем
	// строки их id — соответствие id↔токен читаем прямо из таблицы.
	tokenOf := map[int64]string{}
	rows, err := pool.Query(ctx, `SELECT id, token_hash FROM devices WHERE user_id=$1`, userID)
	if err != nil {
		t.Fatalf("чтение токенов: %v", err)
	}
	for rows.Next() {
		var id int64
		var token string
		if err := rows.Scan(&id, &token); err != nil {
			t.Fatalf("scan токена: %v", err)
		}
		tokenOf[id] = token
	}
	rows.Close()

	byToken := map[string]domain.Device{}
	for _, d := range devices {
		byToken[tokenOf[d.ID]] = d
	}
	if len(byToken) != 5 {
		t.Fatalf("после наката %d строк вместо 5: %+v", len(byToken), devices)
	}

	// ── 1. Шов расклеен: обе половины на своих местах ───────────────────────
	// Именно ради этого миграция и написана: витрина отдаёт device_model и
	// system_version РАЗНЫМИ параметрами конструктора, и склейка в одной из них
	// рисует пользователю «Chrome · macOS, browser».
	if d := byToken["tok-glued"]; d.Name != "Chrome" || d.SystemVersion != "macOS" {
		t.Errorf("склеенная строка = (%q, %q); want (Chrome, macOS)", d.Name, d.SystemVersion)
	}

	// ── 2. Строки без шва не тронуты ────────────────────────────────────────
	// `split_part` по отсутствующему разделителю вернул бы пустую вторую часть
	// и — при неверном условии WHERE — стёр бы имя целиком.
	for _, tc := range []struct{ token, name string }{
		{"tok-plain", "Safari"},
		{"tok-qr", "QR login"},
		{"tok-empty", ""},
	} {
		d := byToken[tc.token]
		if d.Name != tc.name || d.SystemVersion != "" {
			t.Errorf("%s = (%q, %q); want (%q, пусто)", tc.token, d.Name, d.SystemVersion, tc.name)
		}
	}

	// ── 3. Второй разделитель не съедает хвост ──────────────────────────────
	// split_part берёт ИМЕННО вторую часть, а не «всё после первого шва».
	if d := byToken["tok-many"]; d.Name != "A" || d.SystemVersion != "B" {
		t.Errorf("строка с двумя швами = (%q, %q); want (A, B)", d.Name, d.SystemVersion)
	}

	// ── 4. Версия сборки заведена пустой, а не NULL ─────────────────────────
	// Иначе Scan в строку упал бы на каждой существующей строке.
	if d := byToken["tok-glued"]; d.AppVersion != "" {
		t.Errorf("app_version у старой строки = %q; want пусто", d.AppVersion)
	}

	// ── 5. Круг вниз-вверх ──────────────────────────────────────────────────
	// Down обязан быть исполнимым: без него миграцию нельзя откатить на живом
	// деплое. И он обязан СКЛЕИТЬ шов обратно — иначе откат теряет ОС насовсем
	// вместе с колонкой.
	if err := storepostgres.MigrateDownTo(url, deviceIdentityMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	var name string
	if err := pool.QueryRow(ctx,
		`SELECT name FROM devices WHERE token_hash='tok-glued'`).Scan(&name); err != nil {
		t.Fatalf("чтение после отката: %v", err)
	}
	if name != "Chrome · macOS" {
		t.Errorf("после отката name = %q; ОС потеряна вместе с колонкой", name)
	}
	// Строка без шва не должна обзавестись висячим разделителем.
	if err := pool.QueryRow(ctx,
		`SELECT name FROM devices WHERE token_hash='tok-plain'`).Scan(&name); err != nil {
		t.Fatalf("чтение после отката: %v", err)
	}
	if name != "Safari" {
		t.Errorf("после отката name = %q; want Safari", name)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	devices, err = repo.ListByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListByUser после круга: %v", err)
	}
	var seen bool
	for _, d := range devices {
		if tokenOf[d.ID] != "tok-glued" {
			continue
		}
		seen = true
		if d.Name != "Chrome" || d.SystemVersion != "macOS" {
			t.Errorf("после круга вниз-вверх = (%q, %q); want (Chrome, macOS)", d.Name, d.SystemVersion)
		}
	}
	if !seen {
		t.Fatal("строка со швом пропала после круга вниз-вверх")
	}
}
