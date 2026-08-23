package postgres

import (
	"context"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0126 — пер-авторская нумерация историй и горизонт прочтения.
const storySeqMigrationPrevVersion = 125

func TestMigration0126_StoryPerAuthorSeq(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, storySeqMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", storySeqMigrationPrevVersion, err)
	}

	author := seedUser(t, pool, "+79995550126")
	other := seedUser(t, pool, "+79995550127")
	viewer := seedUser(t, pool, "+79995550128")
	future := time.Now().Add(24 * time.Hour)

	// Две истории одного автора и одна чужая: нумерация обязана идти ВНУТРИ
	// автора, а не сквозной.
	var first, second, foreign int64
	for _, c := range []struct {
		owner int64
		dst   *int64
	}{{author, &first}, {other, &foreign}, {author, &second}} {
		if err := pool.QueryRow(ctx,
			`INSERT INTO stories (author_id, media_id, caption, privacy, expires_at)
			 VALUES ($1, 1, '', 'everyone', $2) RETURNING id`, c.owner, future).Scan(c.dst); err != nil {
			t.Fatalf("seed story: %v", err)
		}
	}
	// Репост адресовал источник ГЛОБАЛЬНЫМ ключом.
	var repost int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO stories (author_id, media_id, caption, privacy, expires_at, fwd_from_author_id, fwd_from_story_id)
		 VALUES ($1, 1, '', 'everyone', $2, $3, $4) RETURNING id`,
		other, future, author, second).Scan(&repost); err != nil {
		t.Fatalf("seed repost: %v", err)
	}
	// Просмотр второй истории автора — из него восстановится горизонт.
	if _, err := pool.Exec(ctx,
		`INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2)`, second, viewer); err != nil {
		t.Fatalf("seed view: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0126: %v", err)
	}

	// Номера идут внутри автора и в порядке появления.
	var firstSeq, secondSeq, foreignSeq int64
	if err := pool.QueryRow(ctx, `SELECT seq FROM stories WHERE id=$1`, first).Scan(&firstSeq); err != nil {
		t.Fatalf("seq первой: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT seq FROM stories WHERE id=$1`, second).Scan(&secondSeq); err != nil {
		t.Fatalf("seq второй: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT seq FROM stories WHERE id=$1`, foreign).Scan(&foreignSeq); err != nil {
		t.Fatalf("seq чужой: %v", err)
	}
	if firstSeq != 1 || secondSeq != 2 {
		t.Fatalf("нумерация автора = %d,%d; ожидались 1,2", firstSeq, secondSeq)
	}
	if foreignSeq != 1 {
		t.Fatalf("нумерация ЧУЖОГО автора = %d; она обязана начинаться заново", foreignSeq)
	}

	// Счётчик автора встал на последний выданный номер: следующая история не
	// должна столкнуться с уже существующей.
	var lastSeq int64
	if err := pool.QueryRow(ctx, `SELECT last_story_seq FROM users WHERE id=$1`, author).Scan(&lastSeq); err != nil {
		t.Fatalf("счётчик автора: %v", err)
	}
	if lastSeq != 2 {
		t.Fatalf("счётчик автора = %d; ожидался 2", lastSeq)
	}

	// Ссылка репоста адресует источник ПАРОЙ «автор + номер».
	var fwdSeq int64
	if err := pool.QueryRow(ctx, `SELECT fwd_from_story_id FROM stories WHERE id=$1`, repost).Scan(&fwdSeq); err != nil {
		t.Fatalf("ссылка репоста: %v", err)
	}
	if fwdSeq != secondSeq {
		t.Fatalf("ссылка репоста = %d; ожидался номер %d", fwdSeq, secondSeq)
	}

	// Горизонт восстановлен из уже записанных просмотров: «прочитано» до этой
	// миграции и БЫЛО строкой в story_views, поэтому данные не теряются.
	var horizon int64
	if err := pool.QueryRow(ctx,
		`SELECT max_read_id FROM story_read WHERE viewer_id=$1 AND author_id=$2`, viewer, author).Scan(&horizon); err != nil {
		t.Fatalf("горизонт: %v", err)
	}
	if horizon != secondSeq {
		t.Fatalf("горизонт = %d; ожидался %d", horizon, secondSeq)
	}

	// Круг Down → Up: обратный ход возвращает глобальную адресацию ссылки.
	if err := storepostgres.MigrateDownTo(url, storySeqMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var backFwd int64
	if err := pool.QueryRow(ctx, `SELECT fwd_from_story_id FROM stories WHERE id=$1`, repost).Scan(&backFwd); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if backFwd != second {
		t.Fatalf("после отката ссылка = %d; ожидался ключ %d", backFwd, second)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT fwd_from_story_id FROM stories WHERE id=$1`, repost).Scan(&fwdSeq); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if fwdSeq != secondSeq {
		t.Fatalf("после круга Down→Up ссылка = %d; ожидался номер %d", fwdSeq, secondSeq)
	}
}
