package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// LangPackRepo — хранилище языкового пакета (langpack_languages,
// langpack_strings; миграция 0128).
type LangPackRepo struct{ pool *pgxpool.Pool }

func NewLangPackRepo(pool *pgxpool.Pool) *LangPackRepo { return &LangPackRepo{pool: pool} }

// langPackStringCols — колонки строки в порядке scanLangPackString.
const langPackStringCols = `key, value, zero_value, one_value, two_value, few_value, many_value, other_value, deleted`

// scanLangPackString собирает запись из строки таблицы.
//
// Вид строки не хранится колонкой — его задаёт то, что заполнено (см. CHECK
// langpack_strings_one_shape). Здесь это разворачивается обратно: `value` не
// NULL — простая строка, иначе формы числа. Каждая форма читается В СВОЮ
// колонку; перепутать их можно, только написав чужое имя.
func scanLangPackString(s scanner) (domain.LangPackStringRecord, error) {
	var (
		rec                                     domain.LangPackStringRecord
		value, zero, one, two, few, many, other *string
	)
	if err := s.Scan(&rec.Key, &value, &zero, &one, &two, &few, &many, &other, &rec.Deleted); err != nil {
		return domain.LangPackStringRecord{}, err
	}
	switch {
	case rec.Deleted:
		// Снятый ключ текста не несёт вовсе.
	case value != nil:
		rec.Value = value
	case other != nil:
		rec.Forms = &domain.PluralForms{Zero: zero, One: one, Two: two, Few: few, Many: many, Other: *other}
	default:
		// CHECK такого не пропустит; если пропустил — данные испорчены, и
		// молчать об этом нельзя: пустая строка доехала бы до экрана пустотой.
		return domain.LangPackStringRecord{}, fmt.Errorf("langpack: строка %q не несёт ни текста, ни форм", rec.Key)
	}
	return rec, nil
}

// Strings — строки языка новее версии sinceVersion.
//
// `version > $2` и есть разница: строка помечена той версией языка, в которой
// изменилась последний раз. Порядок по ключу — чтобы выдача не зависела от
// физического порядка строк в таблице.
func (r *LangPackRepo) Strings(ctx context.Context, code string, sinceVersion int, withDeleted bool) ([]domain.LangPackStringRecord, error) {
	q := `SELECT ` + langPackStringCols + `
	        FROM langpack_strings
	       WHERE lang_code = $1 AND version > $2`
	if !withDeleted {
		q += ` AND NOT deleted`
	}
	q += ` ORDER BY key`

	rows, err := querier(ctx, r.pool).Query(ctx, q, code, sinceVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.LangPackStringRecord
	for rows.Next() {
		rec, err := scanLangPackString(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// StringsByKeys — только запрошенные ключи. Снятые входят в выдачу: «ключ снят»
// — такой же ответ, как текст, и подменять его молчанием нельзя.
func (r *LangPackRepo) StringsByKeys(ctx context.Context, code string, keys []string) ([]domain.LangPackStringRecord, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+langPackStringCols+`
		   FROM langpack_strings
		  WHERE lang_code = $1 AND key = ANY($2)`, code, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.LangPackStringRecord
	for rows.Next() {
		rec, err := scanLangPackString(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// Version — текущая версия языка; domain.ErrNotFound, если языка нет.
func (r *LangPackRepo) Version(ctx context.Context, code string) (int, error) {
	var v int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT version FROM langpack_languages WHERE lang_code = $1`, code).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return v, err
}

// langPackLanguageQuery — паспорт языка вместе со счётчиками строк.
//
// Счётчики СЧИТАЮТСЯ, а не хранятся колонками (см. шапку миграции 0128):
// «сколько строк в языке» — свойство таблицы строк, и отдельное поле разъехалось
// бы с ней при первом же неполном сиде.
//
// `strings_count` — сколько строк в пакете вообще, и это свойство БАЗЫ: у
// перевода недостающие ключи берутся из неё, поэтому считать нужно по
// COALESCE(base_lang_code, lang_code), а не по самому языку — иначе у русского
// «переведено 1170 из 1170», то есть «переведено всё».
const langPackLanguageQuery = `
	SELECT l.name, l.native_name, l.lang_code, l.base_lang_code, l.plural_code, l.rtl, l.position,
	       (SELECT count(*) FROM langpack_strings b
	         WHERE b.lang_code = COALESCE(l.base_lang_code, l.lang_code) AND NOT b.deleted),
	       (SELECT count(*) FROM langpack_strings s
	         WHERE s.lang_code = l.lang_code AND NOT s.deleted)
	  FROM langpack_languages l`

func scanLangPackLanguage(s scanner) (domain.LangPackLanguage, error) {
	var (
		meta                          domain.LangPackLanguageMeta
		base                          *string
		stringsCount, translatedCount int
	)
	if err := s.Scan(&meta.Name, &meta.NativeName, &meta.Code, &base, &meta.PluralCode, &meta.RTL,
		&meta.Position, &stringsCount, &translatedCount); err != nil {
		return domain.LangPackLanguage{}, err
	}
	if base != nil {
		meta.BaseCode = *base
	}
	return domain.NewLangPackLanguage(meta, stringsCount, translatedCount), nil
}

// Languages — все языки пакета В ПОРЯДКЕ ВЫДАЧИ.
//
// Порядок здесь не косметика: клиент рисует список тем же перебором, каким его
// получил, и не сортирует (tweb `sidebarLeft/tabs/language.tsx:117`). Значит,
// «предложенные первыми» может выразить только сервер — колонкой position,
// которую сид берёт из порядка языков в источнике (миграция 0129).
//
// `l.name` вторым ключом — не запасной порядок, а определённость: у языков с
// одинаковой позицией (например, у ещё не засеянных, с DEFAULT 0) выдача не
// должна зависеть от физического порядка строк в таблице.
func (r *LangPackRepo) Languages(ctx context.Context) ([]domain.LangPackLanguage, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		langPackLanguageQuery+` ORDER BY l.position, l.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.LangPackLanguage{}
	for rows.Next() {
		lang, err := scanLangPackLanguage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, lang)
	}
	return out, rows.Err()
}

// Language — один язык; domain.ErrNotFound у неизвестного кода.
func (r *LangPackRepo) Language(ctx context.Context, code string) (domain.LangPackLanguage, error) {
	row := querier(ctx, r.pool).QueryRow(ctx, langPackLanguageQuery+` WHERE l.lang_code = $1`, code)
	lang, err := scanLangPackLanguage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.LangPackLanguage{}, domain.ErrNotFound
	}
	return lang, err
}

// Apply — паспорт языка, его версия и изменившиеся строки одной транзакцией.
//
// Транзакция здесь не про скорость: клиент, спросивший разницу между двумя
// записями, обязан увидеть либо всё старое, либо всё новое. Записанные строки
// под ещё не поднятой версией он не заберёт никогда — придёт со своей старой
// версией, получит их, а версию в ответе увидит прежнюю.
//
// Язык записывается первым: строки ссылаются на него внешним ключом. Снаружи
// этот порядок не виден — оба оператора закрывает один коммит.
func (r *LangPackRepo) Apply(ctx context.Context, meta domain.LangPackLanguageMeta, version int, changed []domain.LangPackStringRecord) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var base *string
	if meta.BaseCode != "" {
		b := meta.BaseCode
		base = &b
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO langpack_languages (lang_code, name, native_name, base_lang_code, plural_code, rtl, position, version)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 ON CONFLICT (lang_code) DO UPDATE SET
		   name           = EXCLUDED.name,
		   native_name    = EXCLUDED.native_name,
		   base_lang_code = EXCLUDED.base_lang_code,
		   plural_code    = EXCLUDED.plural_code,
		   rtl            = EXCLUDED.rtl,
		   position       = EXCLUDED.position,
		   version        = EXCLUDED.version`,
		meta.Code, meta.Name, meta.NativeName, base, meta.PluralCode, meta.RTL, meta.Position, version); err != nil {
		return err
	}

	// Строки уезжают ОДНИМ оператором через unnest параллельных массивов — тем
	// же приёмом, что и остальные пакетные записи в этом пакете
	// (stickersrepo.go, updatesrepo.go). Первый сид на пустой базе — это пять
	// тысяч строк; отдельным INSERT на каждую он превратился бы в пять тысяч
	// круговых поездок до Postgres ещё ДО того, как сервер начнёт слушать порт.
	//
	// Колонки собираются параллельными массивами, и `*string` в них — не
	// небрежность: NULL в text[] и есть «формы нет», а пустая строка была бы
	// «форма есть, и она пустая».
	keys := make([]string, 0, len(changed))
	values := make([]*string, 0, len(changed))
	zeros := make([]*string, 0, len(changed))
	ones := make([]*string, 0, len(changed))
	twos := make([]*string, 0, len(changed))
	fews := make([]*string, 0, len(changed))
	manys := make([]*string, 0, len(changed))
	others := make([]*string, 0, len(changed))
	deleted := make([]bool, 0, len(changed))

	for _, rec := range changed {
		var value, zero, one, two, few, many, other *string
		switch {
		case rec.Deleted:
			// Снятый ключ обнуляет ВСЕ тексты: иначе рядом с «строки нет» лежал
			// бы её прежний текст, и вернувшийся ключ поднял бы старый перевод.
		case rec.Value != nil:
			value = rec.Value
		case rec.Forms != nil:
			zero, one, two, few, many = rec.Forms.Zero, rec.Forms.One, rec.Forms.Two, rec.Forms.Few, rec.Forms.Many
			o := rec.Forms.Other
			other = &o
		default:
			return fmt.Errorf("langpack: строка %q не несёт ни текста, ни форм, ни снятия", rec.Key)
		}
		keys = append(keys, rec.Key)
		values = append(values, value)
		zeros = append(zeros, zero)
		ones = append(ones, one)
		twos = append(twos, two)
		fews = append(fews, few)
		manys = append(manys, many)
		others = append(others, other)
		deleted = append(deleted, rec.Deleted)
	}

	if len(keys) > 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO langpack_strings
			   (lang_code, key, value, zero_value, one_value, two_value, few_value, many_value, other_value, deleted, version)
			 SELECT $1, v.key, v.value, v.zero, v.one, v.two, v.few, v.many, v.other, v.deleted, $11
			   FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
			               $7::text[], $8::text[], $9::text[], $10::bool[])
			     AS v(key, value, zero, one, two, few, many, other, deleted)
			 ON CONFLICT (lang_code, key) DO UPDATE SET
			   value       = EXCLUDED.value,
			   zero_value  = EXCLUDED.zero_value,
			   one_value   = EXCLUDED.one_value,
			   two_value   = EXCLUDED.two_value,
			   few_value   = EXCLUDED.few_value,
			   many_value  = EXCLUDED.many_value,
			   other_value = EXCLUDED.other_value,
			   deleted     = EXCLUDED.deleted,
			   version     = EXCLUDED.version`,
			meta.Code, keys, values, zeros, ones, twos, fews, manys, others, deleted, version); err != nil {
			return fmt.Errorf("langpack: строки языка %s: %w", meta.Code, err)
		}
	}

	return tx.Commit(ctx)
}
