package postgres

import (
	"context"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0125 — области историй переписаны на объединение конструкторов.
const storyAreasMigrationPrevVersion = 124

func TestMigration0125_StoryMediaAreasUnion(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, storyAreasMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", storyAreasMigrationPrevVersion, err)
	}

	author := seedUser(t, pool, "+79995550125")
	// Строка ПРОШЛОЙ формы: вид области подделан полем `type`, точка лежит парой
	// чисел рядом, оформление наклейки — булевыми ключами верхнего уровня.
	var storyID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO stories (author_id, media_id, caption, privacy, expires_at, media_areas)
		 VALUES ($1, 1, 'x', 'everyone', $2, $3::jsonb) RETURNING id`,
		author, time.Now().Add(24*time.Hour), `[
		  {"type":"reaction","coordinates":{"x":50,"y":50,"w":10,"h":10,"rotation":5},"reaction":"👍","dark":true},
		  {"type":"geo","coordinates":{"x":1,"y":2,"w":0,"h":0,"rotation":0},"lat":55.75,"long":37.61,"title":"Москва"},
		  {"type":"url","coordinates":{"x":3,"y":0,"w":0,"h":0,"rotation":0},"url":"https://t.me"},
		  {"type":"weather","coordinates":{"x":0,"y":0,"w":0,"h":0,"rotation":0}}
		]`).Scan(&storyID); err != nil {
		t.Fatalf("seed story: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0125: %v", err)
	}

	var tags []string
	if err := pool.QueryRow(ctx,
		`SELECT array_agg(e->>'_' ORDER BY ord)
		   FROM stories s, jsonb_array_elements(s.media_areas) WITH ORDINALITY AS t(e, ord)
		  WHERE s.id = $1`, storyID).Scan(&tags); err != nil {
		t.Fatalf("области после наката: %v", err)
	}
	// Область неизвестного вида отброшена — полупустая запись на проводе хуже
	// её отсутствия, и разбор объединения поступает так же.
	want := []string{"mediaAreaSuggestedReaction", "mediaAreaGeoPoint", "mediaAreaUrl"}
	if len(tags) != len(want) {
		t.Fatalf("конструкторы областей = %v, ожидались %v", tags, want)
	}
	for i := range want {
		if tags[i] != want[i] {
			t.Fatalf("конструкторы областей = %v, ожидались %v", tags, want)
		}
	}

	var emoticon, dark string
	if err := pool.QueryRow(ctx,
		`SELECT media_areas#>>'{0,reaction,emoticon}', COALESCE(media_areas#>>'{0,pFlags,dark}', '')
		   FROM stories WHERE id = $1`, storyID).Scan(&emoticon, &dark); err != nil {
		t.Fatalf("наклейка реакции: %v", err)
	}
	if emoticon != "👍" {
		t.Fatalf("эмодзи наклейки = %q (должно стать объединением Reaction)", emoticon)
	}
	if dark != "true" {
		t.Fatalf("оформление наклейки не уехало в pFlags: dark = %q", dark)
	}

	var lat float64
	var geoTag string
	if err := pool.QueryRow(ctx,
		`SELECT (media_areas#>>'{1,geo,lat}')::float8, media_areas#>>'{1,geo,_}'
		   FROM stories WHERE id = $1`, storyID).Scan(&lat, &geoTag); err != nil {
		t.Fatalf("гео-область: %v", err)
	}
	if geoTag != "geoPoint" || lat != 55.75 {
		t.Fatalf("точка не стала ступенью: geo=%q lat=%v", geoTag, lat)
	}

	// Круг Down → Up: обратный ход возвращает плоскую запись, повторный накат —
	// снова конструкторы. Разъехаться формы не могут.
	if err := storepostgres.MigrateDownTo(url, storyAreasMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var backType, backReaction string
	if err := pool.QueryRow(ctx,
		`SELECT media_areas#>>'{0,type}', media_areas#>>'{0,reaction}' FROM stories WHERE id = $1`, storyID).
		Scan(&backType, &backReaction); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if backType != "reaction" || backReaction != "👍" {
		t.Fatalf("после отката область = %q/%q", backType, backReaction)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	var tag string
	if err := pool.QueryRow(ctx, `SELECT media_areas#>>'{0,_}' FROM stories WHERE id = $1`, storyID).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "mediaAreaSuggestedReaction" {
		t.Fatalf("после круга Down→Up конструктор = %q", tag)
	}
}
