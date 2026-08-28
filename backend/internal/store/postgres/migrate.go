package postgres

import (
	"database/sql"
	"embed"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migrate runs all up migrations against the database at databaseURL.
func Migrate(databaseURL string) error {
	return withGoose(databaseURL, func(db *sql.DB) error { return goose.Up(db, "migrations") })
}

// MigrateDownTo откатывает миграции до версии version включительно (всё, что
// новее, отыгрывается вниз). Нужна тестам миграций: откатиться, записать данные
// в старой форме и накатить снова — только так конвертация проверяется на
// настоящих строках, а не на пересказе.
func MigrateDownTo(databaseURL string, version int64) error {
	return withGoose(databaseURL, func(db *sql.DB) error { return goose.DownTo(db, "migrations", version) })
}

// MigrateUpTo накатывает миграции ДО версии version включительно. Нужна тестам
// миграций по той же причине, что MigrateDownTo: тест конвертации проверяет
// ОДНУ миграцию, и следующая, накатившаяся заодно, переписала бы те же строки
// ещё раз — проверка стала бы проверять сумму, а не шаг.
func MigrateUpTo(databaseURL string, version int64) error {
	return withGoose(databaseURL, func(db *sql.DB) error { return goose.UpTo(db, "migrations", version) })
}

func withGoose(databaseURL string, run func(*sql.DB) error) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open db for migrate: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return run(db)
}
