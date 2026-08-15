# Стикеры и анимированные эмодзи 1:1 с tweb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Панель и экран поиска стикеров показывают 333 выгруженных набора с анимацией и скелетонами, набор открывается модалкой «ADD N STICKERS», одиночные эмодзи в чате играют настоящей лотти-анимацией.

**Architecture:** Данные уже выгружены скриптом `tools/fetch_stickers.py` в `backend/assets/stickers/<slug>/` (`.tgs`/`.webm`/`.webp` + `meta.json` + `cover.*`). Бэкенд их сидирует существующим `cmd/seed-stickers` в `media`+MinIO, добавляя два новых поля набора: порядок трендов и обложку. Фронт уже умеет lottie через tlottie-воркер — не хватает ветки `application/x-tgsticker` (gzip) в трёх местах и UI-слоя: скелетоны, обложки вкладок, модалка набора.

**Tech Stack:** Go 1.25 (chi, pgx, goose, minio-go), React 19 + TypeScript strict, SCSS-модули, Zustand, vitest, tlottie (SIMD-WASM).

## Global Constraints

- **Референс — tweb.** Любую вёрстку/разметку/поведение брать 1:1 из `~/Documents/tweb`, не выдумывать. Перед утверждением «в Telegram так» — проверить в исходниках tweb.
- **MUI и framer-motion не возвращать.** Анимации — на CSS-классах tweb.
- **Мёртвый код удалять** агрессивно: не оставлять заглушки и неиспользуемые ветки.
- **`.tgs` не распаковывать на бэкенде.** Хранится и отдаётся gzip'нутым, mime `application/x-tgsticker`; распаковка — на клиенте через `DecompressionStream('gzip')`.
- **Тесты:** фронт `cd web-client && npm test`, бэк `cd backend && go test ./...` (интеграционные — на testcontainers, нужен Docker).
- **Стенд:** проект `msgrverify`, `docker-compose.verify.yml`, приложение на :38080.

---

### Task 1: seed-stickers понимает `.tgs`

Сейчас `stickerMime()` знает `.webm`/`.webp`/`.png`/`.json`, а всё неизвестное отдаёт как `application/json`. Выгруженные `.tgs` попали бы в MinIO с mime `application/json`, и фронт попытался бы распарсить gzip как JSON.

**Files:**
- Modify: `backend/cmd/seed-stickers/main.go:48-64` (функция `stickerMime`)
- Test: `backend/cmd/seed-stickers/main_test.go` (создать)

**Interfaces:**
- Consumes: ничего
- Produces: `stickerMime(file string) string` возвращает `"application/x-tgsticker"` для `.tgs`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/cmd/seed-stickers/main_test.go`:

```go
package main

import "testing"

// stickerMime решает, с каким Content-Type файл ляжет в media: по нему фронт
// выбирает движок (lottie/видео/картинка), поэтому ошибка здесь ломает рендер.
func TestStickerMime(t *testing.T) {
	cases := map[string]string{
		"1.tgs":   "application/x-tgsticker",
		"1.TGS":   "application/x-tgsticker",
		"2.webm":  "video/webm",
		"3.webp":  "image/webp",
		"4.png":   "image/png",
		"5.json":  "application/json",
		"cover.tgs": "application/x-tgsticker",
	}
	for file, want := range cases {
		if got := stickerMime(file); got != want {
			t.Errorf("stickerMime(%q) = %q, want %q", file, got, want)
		}
	}
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./cmd/seed-stickers/ -run TestStickerMime -v`
Expected: FAIL — `stickerMime("1.tgs") = "application/json", want "application/x-tgsticker"`

- [ ] **Step 3: Добавить ветку `.tgs`**

В `backend/cmd/seed-stickers/main.go` в `switch` функции `stickerMime` добавить перед `case ".webm"`:

```go
	case ".tgs":
		// .tgs — gzip'нутый lottie-json Telegram. Не распаковываем: бэкенд читает
		// из него размеры сам (ffmpeg.lottieDims разжимает по magic-байтам), а
		// фронт — DecompressionStream в StickerMedia.
		return "application/x-tgsticker"
```

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd backend && go test ./cmd/seed-stickers/ -run TestStickerMime -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add backend/cmd/seed-stickers/main.go backend/cmd/seed-stickers/main_test.go
git commit -m "feat(stickers): seed-stickers понимает .tgs (application/x-tgsticker)"
```

---

### Task 2: порядок трендов и обложка в модели набора

`FeaturedSets` сортирует по `s.id DESC` — при сидировании 333 наборов из каталогов (алфавитный порядок `os.ReadDir`) панель покажет случайные 40 вместо порядка Trending. Плюс негде хранить обложку набора.

**Files:**
- Create: `backend/internal/store/postgres/migrations/0093_sticker_sets_rank_cover.sql`
- Modify: `backend/internal/domain/sticker.go:6-16` (структура `StickerSet`)
- Modify: `backend/internal/adapter/repo/postgres/stickersrepo.go` (константа `setCols`, `scanSet`, `FeaturedSets`)
- Test: `backend/internal/adapter/repo/postgres/stickersrepo_test.go`

**Interfaces:**
- Consumes: `stickerMime` из Task 1 не нужен
- Produces: `domain.StickerSet{Rank int, CoverMediaID int64}` (json: `rank`, `cover_media_id`); `StickersRepo.FeaturedSets` сортирует по `rank ASC, id DESC`

- [ ] **Step 1: Написать миграцию**

Создать `backend/internal/store/postgres/migrations/0093_sticker_sets_rank_cover.sql`:

```sql
-- +goose Up
-- rank — позиция набора в трендах Telegram (messages.getFeaturedStickers отдаёт
-- их упорядоченными; порядок и есть та выдача, что видит пользователь в панели).
-- 0 — набор вне трендов, такие уходят в конец выдачи.
-- cover_media_id — обложка набора (иконка вкладки панели, tweb stickerSetThumb);
-- NULL — обложки нет, клиент рисует первый стикер набора.
ALTER TABLE sticker_sets ADD COLUMN rank INT NOT NULL DEFAULT 0;
ALTER TABLE sticker_sets ADD COLUMN cover_media_id BIGINT REFERENCES media(id);
CREATE INDEX sticker_sets_rank_idx ON sticker_sets(rank) WHERE rank > 0;

-- +goose Down
DROP INDEX sticker_sets_rank_idx;
ALTER TABLE sticker_sets DROP COLUMN cover_media_id;
ALTER TABLE sticker_sets DROP COLUMN rank;
```

- [ ] **Step 2: Написать падающий тест репозитория**

В `backend/internal/adapter/repo/postgres/stickersrepo_test.go` добавить (рядом с существующими тестами, используя их хелперы поднятия базы):

```go
// FeaturedSets отдаёт наборы в порядке трендов: сначала rank 1,2,3…, затем
// наборы без ранга. Порядок — то, что пользователь видит в панели стикеров.
func TestFeaturedSetsOrderByRank(t *testing.T) {
	ctx := context.Background()
	pool := newTestPool(t)
	repo := NewStickersRepo(pool)

	noRank, err := repo.CreateSet(ctx, "zzz-no-rank", "Без ранга", "sticker", 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateSet(ctx, "bbb", "Второй", "sticker", 0)
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateSet(ctx, "aaa", "Первый", "sticker", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetRank(ctx, first.ID, 1); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetRank(ctx, second.ID, 2); err != nil {
		t.Fatal(err)
	}

	sets, err := repo.FeaturedSets(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{sets[0].Slug, sets[1].Slug, sets[2].Slug}
	want := []string{"aaa", "bbb", "zzz-no-rank"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("порядок %v, ожидался %v", got, want)
		}
	}
	if sets[0].Rank != 1 {
		t.Errorf("Rank = %d, ожидался 1", sets[0].Rank)
	}
	_ = noRank
}
```

- [ ] **Step 3: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestFeaturedSetsOrderByRank -v`
Expected: FAIL — `repo.SetRank undefined` / поле `Rank` не существует

- [ ] **Step 4: Расширить домен**

В `backend/internal/domain/sticker.go` в структуру `StickerSet` добавить:

```go
	// Rank — позиция набора в трендах Telegram (0 — вне трендов, такие идут
	// последними). Панель стикеров показывает наборы именно в этом порядке.
	Rank int `json:"rank"`
	// CoverMediaID — обложка набора (иконка вкладки, tweb stickerSetThumb);
	// 0 — обложки нет, клиент рисует первый стикер набора.
	CoverMediaID int64 `json:"cover_media_id,omitempty"`
```

- [ ] **Step 5: Обновить репозиторий**

В `backend/internal/adapter/repo/postgres/stickersrepo.go`:

1. В константу `setCols` дописать `, s.rank, COALESCE(s.cover_media_id, 0)`.
2. В `scanSet` дописать соответствующие приёмники `&set.Rank, &set.CoverMediaID` в том же порядке.
3. В `FeaturedSets` заменить `ORDER BY s.id DESC` на:

```sql
		  ORDER BY (s.rank = 0), s.rank, s.id DESC
```

4. Добавить метод:

```go
// SetRank проставляет набору позицию в трендах и обложку (0 — не менять
// обложку). Зовётся сидом: только он знает выдачу getFeaturedStickers.
func (r *StickersRepo) SetRank(ctx context.Context, setID int64, rank int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE sticker_sets SET rank = $2 WHERE id = $1`, setID, rank)
	return err
}

// SetCover привязывает медиа обложки к набору.
func (r *StickersRepo) SetCover(ctx context.Context, setID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE sticker_sets SET cover_media_id = $2 WHERE id = $1`, setID, mediaID)
	return err
}
```

- [ ] **Step 6: Прогнать тест — должен пройти**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestFeaturedSetsOrderByRank -v`
Expected: PASS

- [ ] **Step 7: Прогнать весь пакет — убедиться, что не сломаны соседние тесты**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ ./internal/usecase/stickers/ ./internal/adapter/delivery/http/`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add backend/internal/store/postgres/migrations/0093_sticker_sets_rank_cover.sql \
        backend/internal/domain/sticker.go \
        backend/internal/adapter/repo/postgres/stickersrepo.go \
        backend/internal/adapter/repo/postgres/stickersrepo_test.go
git commit -m "feat(stickers): порядок трендов и обложка набора в модели"
```

---

### Task 3: скрипт пишет индекс порядка, сид его читает

Порядок трендов знает только выгрузка (`getFeaturedStickers` отдаёт наборы упорядоченными). Сид читает каталоги алфавитом, поэтому порядок надо передать файлом.

**Files:**
- Modify: `tools/fetch_stickers.py` (функция `main`, добавить запись индекса)
- Modify: `backend/cmd/seed-stickers/main.go` (чтение индекса, обложка, `SetRank`/`SetCover`)
- Test: `backend/cmd/seed-stickers/main_test.go`

**Interfaces:**
- Consumes: `StickersRepo.SetRank(ctx, setID, rank)`, `SetCover(ctx, setID, mediaID)` из Task 2
- Produces: файл `<out>/_index.json` вида `{"order": ["utyaduck", "hotcherry", ...]}`; `loadRanks(dir string) map[string]int`

- [ ] **Step 1: Скрипт пишет `_index.json`**

В `tools/fetch_stickers.py` в `main`, сразу после получения `sets` (перед циклом выгрузки), добавить:

```python
    # Порядок трендов знает только эта выдача: сид читает каталоги алфавитом и
    # без индекса расставил бы наборы как попало.
    if sets:
        index = {"order": [s.short_name.lower() for s in sets]}
        (out / "_index.json").write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"индекс порядка: {out / '_index.json'} ({len(sets)} наборов)", flush=True)
```

- [ ] **Step 2: Сгенерировать индекс для уже выгруженных наборов**

Наборы скачаны, качать нечего — прогон лишь соберёт список и запишет индекс (~30 секунд):

Run: `tools/.venv/bin/python tools/fetch_stickers.py --skip-installed --skip-archive`
Expected: в конце строка `индекс порядка: .../\_index.json (330 наборов)`, все наборы отмечены `= <slug>: уже выгружен`

- [ ] **Step 3: Написать падающий тест чтения индекса**

В `backend/cmd/seed-stickers/main_test.go` добавить:

```go
// loadRanks превращает выдачу трендов в позиции: первый набор индекса — rank 1.
// Набора нет в индексе → 0, то есть «вне трендов».
func TestLoadRanks(t *testing.T) {
	dir := t.TempDir()
	body := `{"order": ["utyaduck", "hotcherry", "mrcroco"]}`
	if err := os.WriteFile(filepath.Join(dir, "_index.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	ranks := loadRanks(dir)
	if ranks["utyaduck"] != 1 {
		t.Errorf("utyaduck rank = %d, want 1", ranks["utyaduck"])
	}
	if ranks["mrcroco"] != 3 {
		t.Errorf("mrcroco rank = %d, want 3", ranks["mrcroco"])
	}
	if ranks["unknown"] != 0 {
		t.Errorf("unknown rank = %d, want 0", ranks["unknown"])
	}
}

// Индекса может не быть (свой каталог наборов) — это не ошибка, все наборы
// просто оказываются вне трендов.
func TestLoadRanksNoFile(t *testing.T) {
	if got := loadRanks(t.TempDir()); len(got) != 0 {
		t.Errorf("ranks = %v, want empty", got)
	}
}
```

- [ ] **Step 4: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./cmd/seed-stickers/ -run TestLoadRanks -v`
Expected: FAIL — `undefined: loadRanks`

- [ ] **Step 5: Реализовать `loadRanks`**

В `backend/cmd/seed-stickers/main.go` добавить:

```go
// setIndex — _index.json рядом с наборами: порядок трендов из выгрузки
// (tools/fetch_stickers.py). Без него наборы сидируются в алфавитном порядке
// каталогов, и панель показывает их не так, как Telegram.
type setIndex struct {
	Order []string `json:"order"`
}

// loadRanks читает _index.json и отдаёт slug → позиция (с единицы). Файла нет —
// пустая карта: все наборы получают rank 0 («вне трендов»).
func loadRanks(dir string) map[string]int {
	raw, err := os.ReadFile(filepath.Join(dir, "_index.json"))
	if err != nil {
		return map[string]int{}
	}
	var idx setIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		return map[string]int{}
	}
	ranks := make(map[string]int, len(idx.Order))
	for i, slug := range idx.Order {
		ranks[slug] = i + 1
	}
	return ranks
}
```

- [ ] **Step 6: Прогнать тест — должен пройти**

Run: `cd backend && go test ./cmd/seed-stickers/ -run TestLoadRanks -v`
Expected: PASS

- [ ] **Step 7: Сид проставляет rank и заливает обложку**

В `backend/cmd/seed-stickers/main.go`:

1. В `setMeta` добавить поле обложки:

```go
	Cover string `json:"cover"`
```

2. В `run` перед циклом по каталогам получить ранги и прокинуть их в `seedSet`:

```go
	ranks := loadRanks(dir)
```

Вызов становится `seedSet(ctx, stickersUC, mediaUC, dir, e.Name(), ranks[e.Name()])`, а `_index.json` пропускается как не-каталог (он файл, existing `if !e.IsDir() { continue }` это уже делает).

3. В конце `seedSet`, после создания набора и заливки стикеров, добавить:

```go
	if rank > 0 {
		if err := stickersUC.SetRank(ctx, set.ID, rank); err != nil {
			return err
		}
	}
	// Обложка — такое же медиа, как стикер, но в наборе не числится: это
	// иконка вкладки панели (tweb stickerSetThumb), а не отправляемый стикер.
	if meta.Cover != "" {
		coverID, err := uploadFile(ctx, mediaUC, filepath.Join(dir, slug, meta.Cover))
		if err != nil {
			return err
		}
		if err := stickersUC.SetCover(ctx, set.ID, coverID); err != nil {
			return err
		}
	}
```

где `uploadFile` — вынесенная из существующего цикла заливка одного файла в media (та же логика: чтение файла, `stickerMime`, `mediaUC.Upload`). Существующий цикл по стикерам переписать на вызов `uploadFile`, чтобы не было двух копий.

4. В `usecase/stickers/interactor.go` добавить проброс:

```go
// SetRank — позиция набора в трендах (см. domain.StickerSet.Rank).
func (i *Interactor) SetRank(ctx context.Context, setID int64, rank int) error {
	return i.repo.SetRank(ctx, setID, rank)
}

// SetCover — обложка набора (иконка вкладки панели).
func (i *Interactor) SetCover(ctx context.Context, setID, mediaID int64) error {
	return i.repo.SetCover(ctx, setID, mediaID)
}
```

и те же две сигнатуры — в интерфейс репозитория в `usecase/stickers/ports.go`.

- [ ] **Step 8: Прогнать тесты бэка**

Run: `cd backend && go build ./... && go test ./cmd/seed-stickers/ ./internal/usecase/stickers/`
Expected: PASS

- [ ] **Step 9: Коммит**

```bash
git add tools/fetch_stickers.py backend/cmd/seed-stickers/ backend/internal/usecase/stickers/
git commit -m "feat(stickers): индекс порядка трендов и обложки в сиде"
```

---

### Task 4: фронт понимает `.tgs`

Три места на фронте определяют lottie по `application/json`. Пока они не знают про `application/x-tgsticker`, скачанные стикеры отрисуются как «неизвестный файл».

**Files:**
- Create: `web-client/src/core/stickers/tgs.ts`
- Modify: `web-client/src/components/StickerMedia.tsx:49`
- Modify: `web-client/src/core/mediaCache.ts:94`
- Modify: `web-client/src/components/messages/MessageRow.tsx:123`
- Modify: `web-client/src/lib/lottie/lottieLoader.ts:155-165` (переиспользовать общий хелпер)
- Test: `web-client/src/core/stickers/tgs.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `isLottieMime(ct: string): boolean`, `readLottie(res: Response): Promise<unknown>` из `@core/stickers/tgs`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/core/stickers/tgs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isLottieMime, readLottie } from './tgs'

describe('isLottieMime', () => {
  it('признаёт оба mime lottie', () => {
    expect(isLottieMime('application/json')).toBe(true)
    expect(isLottieMime('application/json; charset=utf-8')).toBe(true)
    expect(isLottieMime('application/x-tgsticker')).toBe(true)
  })

  it('не признаёт видео и картинки', () => {
    expect(isLottieMime('video/webm')).toBe(false)
    expect(isLottieMime('image/webp')).toBe(false)
  })
})

describe('readLottie', () => {
  it('читает несжатый json как есть', async () => {
    const res = new Response(JSON.stringify({ tgs: 1, w: 512 }), {
      headers: { 'content-type': 'application/json' },
    })
    expect(await readLottie(res)).toEqual({ tgs: 1, w: 512 })
  })

  it('распаковывает gzip у .tgs', async () => {
    const raw = new Blob([JSON.stringify({ tgs: 1, w: 512 })])
    const gz = new Response(raw.stream().pipeThrough(new CompressionStream('gzip')))
    const res = new Response(await gz.blob(), {
      headers: { 'content-type': 'application/x-tgsticker' },
    })
    expect(await readLottie(res)).toEqual({ tgs: 1, w: 512 })
  })
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/core/stickers/tgs.test.ts`
Expected: FAIL — `Failed to resolve import "./tgs"`

- [ ] **Step 3: Реализовать хелпер**

Создать `web-client/src/core/stickers/tgs.ts`:

```ts
// Lottie приезжает в двух видах: несжатым json (наши сид-наборы времён ручной
// сборки) и .tgs — тем же json под gzip, как его отдаёт Telegram (mime
// application/x-tgsticker, tweb environment/mimeTypeMap.ts). Движку tlottie
// нужен разобранный объект, поэтому gzip снимаем здесь — нативным
// DecompressionStream, как в lottieLoader для assets/tgs.
export const TGS_MIME = 'application/x-tgsticker'

export function isLottieMime(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes(TGS_MIME)
}

export async function readLottie(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes(TGS_MIME)) return res.json()
  const unpacked = new Response(res.body!.pipeThrough(new DecompressionStream('gzip')))
  return unpacked.json()
}
```

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/core/stickers/tgs.test.ts`
Expected: PASS (2 файла, 4 теста)

- [ ] **Step 5: Подключить хелпер в StickerMedia**

В `web-client/src/components/StickerMedia.tsx` заменить строку 49

```ts
      if (ct.includes('application/json')) return { kind: 'lottie', data: await res.json() }
```

на

```ts
      if (isLottieMime(ct)) return { kind: 'lottie', data: await readLottie(res) }
```

и добавить импорт `import { isLottieMime, readLottie } from '../core/stickers/tgs'`. В шапке файла поправить комментарий (строки 2-3): lottie приезжает как `application/json` **или** `application/x-tgsticker`.

- [ ] **Step 6: Подключить в mediaCache и MessageRow**

В `web-client/src/core/mediaCache.ts:94` заменить условие бакета на:

```ts
      : isLottieMime(ct) ? 'stickers' : 'other'
```

(импорт `import { isLottieMime } from './stickers/tgs'`, комментарий на строке 80 дополнить вторым mime.)

В `web-client/src/components/messages/MessageRow.tsx:123`:

```ts
  const animatedSticker = m.type === 'sticker' && isLottieMime(m.mediaMime ?? '')
```

(импорт `import { isLottieMime } from '../../core/stickers/tgs'`; комментарий выше — про оба mime.)

- [ ] **Step 7: Убрать дублирование в lottieLoader**

В `web-client/src/lib/lottie/lottieLoader.ts` (строки ~155-165) заменить ручную распаковку на `readLottie` из нового модуля, если это не ломает вендоренный островок; если ломает (файл под `@ts-nocheck`, вендорен 1:1 из tweb) — оставить как есть и добавить в комментарий ссылку на `core/stickers/tgs.ts`, чтобы копия была объяснена.

- [ ] **Step 8: Прогнать тесты фронта**

Run: `cd web-client && npm test`
Expected: PASS. Заметка: `client/realtime/realtimeBridge.test.ts` иногда падает сам по себе (~1 прогон из 10) — при падении именно его перепроверить изолированно, это не регрессия.

- [ ] **Step 9: Коммит**

```bash
git add web-client/src/core/stickers/ web-client/src/components/StickerMedia.tsx \
        web-client/src/core/mediaCache.ts web-client/src/components/messages/MessageRow.tsx \
        web-client/src/lib/lottie/lottieLoader.ts
git commit -m "feat(stickers): фронт понимает .tgs (gzip lottie)"
```

---

### Task 5: сидировать наборы на стенд

Данные и код готовы — заливаем 333 набора (13 355 файлов, 230 MB) в Postgres и MinIO стенда и убеждаемся, что API их отдаёт.

**Files:**
- Modify: нет (операционная задача)

**Interfaces:**
- Consumes: всё из Task 1-3
- Produces: наполненная база стенда

- [ ] **Step 1: Поднять стенд**

```bash
cd ~/Documents/messenger-denis
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build
```

- [ ] **Step 2: Прогнать сид**

Заливка идёт по одному файлу, 13 тысяч объектов — это десятки минут. Запускать в фоне с логом:

```bash
cd backend && go run ./cmd/seed-stickers 2>&1 | tee /tmp/seed-stickers.log
```

Expected: строки вида `набор utyaduck: 40 стикеров`; ошибок `набор ...: ...` быть не должно.

- [ ] **Step 3: Проверить выдачу API**

```bash
curl -s localhost:38080/api/sticker-sets/featured | head -c 400
```

Expected: JSON с наборами, первым — `utyaduck` (`"rank":1`), у наборов заполнен `cover_media_id`.

- [ ] **Step 4: Проверить, что стикер отдаётся правильным mime**

```bash
curl -sI "localhost:38080/api/media/<media_id стикера из выдачи>" | grep -i content-type
```

Expected: `content-type: application/x-tgsticker`

- [ ] **Step 5: Проверить в браузере**

Открыть :38080, панель стикеров. Ожидается: наборы видны, стикеры анимируются. Именно здесь впервые проверяется связка Task 1-4.

- [ ] **Step 6: Коммит не нужен** (изменений в репозитории нет)

---

### Task 6: скелетоны в панели и на экране поиска

Сейчас до прихода данных экран пуст (см. скриншот: белое полотно под строкой поиска). tweb показывает превью-плитки, пока грузятся наборы.

**Files:**
- Create: `web-client/src/components/rightSidebar/StickerSetSkeleton.tsx`
- Create: `web-client/src/components/rightSidebar/StickerSetSkeleton.module.scss`
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx`
- Modify: `web-client/src/core/hooks/useStickersSearch.ts` (отдать наружу признак загрузки)
- Test: `web-client/src/components/rightSidebar/StickerSetSkeleton.test.tsx`

**Interfaces:**
- Consumes: `useStickersSearch(query)` из `@core/hooks/useStickersSearch`
- Produces: `useStickersSearch` возвращает дополнительно `loading: boolean`; компонент `<StickerSetSkeleton count={number} />`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/rightSidebar/StickerSetSkeleton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StickerSetSkeleton from './StickerSetSkeleton'

describe('StickerSetSkeleton', () => {
  it('рисует заданное число заглушек наборов', () => {
    render(<StickerSetSkeleton count={3} />)
    expect(screen.getAllByTestId('sticker-set-skeleton')).toHaveLength(3)
  })

  it('в каждой заглушке пять плиток — как превью набора в выдаче', () => {
    render(<StickerSetSkeleton count={1} />)
    expect(screen.getAllByTestId('sticker-set-skeleton-tile')).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickerSetSkeleton.test.tsx`
Expected: FAIL — `Failed to resolve import "./StickerSetSkeleton"`

- [ ] **Step 3: Реализовать компонент**

Создать `web-client/src/components/rightSidebar/StickerSetSkeleton.tsx`:

```tsx
// Заглушка набора на экране «Поиск стикеров», пока не приехала выдача: строка
// заголовка и пять плиток — ровно та раскладка, что у настоящего набора
// (tweb рисует превью из пяти стикеров), поэтому подмена не дёргает вёрстку.
import s from './StickerSetSkeleton.module.scss'

export default function StickerSetSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.set} data-testid="sticker-set-skeleton">
          <div className={s.header}>
            <div className={s.title} />
            <div className={s.button} />
          </div>
          <div className={s.tiles}>
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className={s.tile} data-testid="sticker-set-skeleton-tile" />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
```

Создать `web-client/src/components/rightSidebar/StickerSetSkeleton.module.scss` — размеры взять из `RightSearchTab.module.scss`, чтобы плитки совпадали с настоящими; мерцание — существующим классом-шиммером tweb, новых анимаций не изобретать.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickerSetSkeleton.test.tsx`
Expected: PASS

- [ ] **Step 5: Отдать признак загрузки из хука**

В `web-client/src/core/hooks/useStickersSearch.ts` добавить состояние `const [loading, setLoading] = useState(true)`: `setLoading(true)` перед запросом, `setLoading(false)` в обоих коллбеках `.then` (только если `req === reqRef.current`). Вернуть `loading` в объекте результата.

- [ ] **Step 6: Показать скелетон в табе**

В `web-client/src/components/rightSidebar/StickersSearchTab.tsx` при `loading && sets.length === 0` рендерить `<StickerSetSkeleton count={6} />` вместо пустого списка.

- [ ] **Step 7: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add web-client/src/components/rightSidebar/ web-client/src/core/hooks/useStickersSearch.ts
git commit -m "feat(stickers): скелетоны наборов на экране поиска"
```

---

### Task 7: обложки наборов на вкладках панели

У 333 наборов теперь есть `cover_media_id`. tweb рисует обложку как иконку вкладки (`wrapStickerSetThumb`), для lottie — через тот же воркер, что и стикеры.

**Files:**
- Create: `web-client/src/core/stickers/setThumb.ts`
- Modify: `web-client/src/core/managers/stickersManager.ts:8` (тип `StickerSet`)
- Modify: `web-client/src/components/emoji/EmojiDropdown.tsx` (ряд вкладок наборов)
- Test: `web-client/src/core/stickers/setThumb.test.ts`

**Interfaces:**
- Consumes: `StickerSet.cover_media_id` из API (Task 2)
- Produces: `StickerSet` во фронте получает поле `coverMediaId?: number`; функция `setThumbMediaId(set, stickers): number | undefined` из `@core/stickers/setThumb`

Выбор обложки — чистая функция, а не логика внутри JSX: так правило «обложка, иначе первый стикер» проверяется без рендера всей панели.

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/core/stickers/setThumb.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { setThumbMediaId } from './setThumb'

const sticker = (mediaId: number) => ({
  id: mediaId, setId: 1, mediaId, emoji: '🦆', position: 0,
  width: 512, height: 512, mime: 'application/x-tgsticker',
})

describe('setThumbMediaId', () => {
  it('берёт обложку набора, когда она есть', () => {
    expect(setThumbMediaId({ coverMediaId: 77 }, [sticker(5)])).toBe(77)
  })

  it('падает на первый стикер, когда обложки нет', () => {
    expect(setThumbMediaId({ coverMediaId: undefined }, [sticker(5), sticker(6)])).toBe(5)
  })

  it('отдаёт undefined у пустого набора без обложки', () => {
    expect(setThumbMediaId({ coverMediaId: undefined }, [])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/core/stickers/setThumb.test.ts`
Expected: FAIL — `Failed to resolve import "./setThumb"`

- [ ] **Step 3: Реализовать функцию**

Создать `web-client/src/core/stickers/setThumb.ts`:

```ts
import type { Sticker } from '../managers/stickersManager'

// Иконка вкладки набора в панели. Telegram отдаёт обложку не у всех наборов
// (из 334 выгруженных она есть у 230), и tweb в этом случае рисует первый
// стикер набора — stickerSetThumb.ts: при пустых set.thumbs берётся documents[0].
export function setThumbMediaId(
  set: { coverMediaId?: number },
  stickers: Pick<Sticker, 'mediaId'>[],
): number | undefined {
  return set.coverMediaId ?? stickers[0]?.mediaId
}
```

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/core/stickers/setThumb.test.ts`
Expected: PASS (3 теста)

- [ ] **Step 5: Пробросить поле в тип и маппинг**

В `web-client/src/core/managers/stickersManager.ts` в интерфейс `StickerSet` добавить `coverMediaId?: number` и заполнять его из `cover_media_id` в местах, где набор приходит с бэка (`mySets`, `setBySlug`, `searchSets`, `featuredSets`).

- [ ] **Step 6: Использовать обложку во вкладке**

В `EmojiDropdown.tsx` в рендере вкладки набора звать `setThumbMediaId(set, stickers)` вместо прямого обращения к первому стикеру.

- [ ] **Step 7: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add web-client/src/core/stickers/ web-client/src/core/managers/stickersManager.ts \
        web-client/src/components/emoji/
git commit -m "feat(stickers): обложки наборов на вкладках панели"
```

---

### Task 8: модалка набора «ADD N STICKERS»

Клик по стикеру в чате или по заголовку набора в поиске открывает модалку: заголовок, сетка стикеров, внизу кнопка добавления/удаления. Порт tweb `components/popups/stickers.tsx`.

**Files:**
- Create: `web-client/src/components/stickers/StickerSetModal.tsx`
- Create: `web-client/src/components/stickers/StickerSetModal.module.scss`
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx` (открытие по клику)
- Modify: `web-client/src/components/StickerMedia.tsx` или родитель бабла — открытие по клику на стикер в чате
- Test: `web-client/src/components/stickers/StickerSetModal.test.tsx`

**Interfaces:**
- Consumes: `managers.stickers.setBySlug(slug)`, `install(setId)`, `uninstall(setId)`, `mySets()`
- Produces: `<StickerSetModal slug={string} onClose={() => void} />`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/stickers/StickerSetModal.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StickerSetModal from './StickerSetModal'

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 40 }
const stickers = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, setId: 7, mediaId: 100 + i, emoji: '🦆', position: i,
  width: 512, height: 512, mime: 'application/x-tgsticker',
}))

const install = vi.fn().mockResolvedValue(undefined)
const uninstall = vi.fn().mockResolvedValue(undefined)
let installed: typeof set[] = []

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      setBySlug: async () => ({ set, stickers }),
      mySets: async () => installed,
      install,
      uninstall,
    },
  }),
}))

describe('StickerSetModal', () => {
  beforeEach(() => {
    installed = []
    install.mockClear()
    uninstall.mockClear()
  })

  it('показывает заголовок набора и кнопку с числом стикеров', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Duck')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /добавить 40 стикеров/i })).toBeInTheDocument()
  })

  it('рисует все стикеры набора', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
  })

  it('добавляет набор по клику на кнопку', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /добавить 40 стикеров/i })
    await userEvent.click(button)
    expect(install).toHaveBeenCalledWith(7)
  })

  it('у установленного набора кнопка удаляет набор', async () => {
    installed = [set]
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /удалить стикеры/i })
    await userEvent.click(button)
    expect(uninstall).toHaveBeenCalledWith(7)
    expect(install).not.toHaveBeenCalled()
  })
})
```

Путь мока `useManagers` сверить с фактическим — образец мока менеджеров есть в `web-client/src/components/StickersHelper.suggest.test.ts`.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/stickers/StickerSetModal.test.tsx`
Expected: FAIL — `Failed to resolve import "./StickerSetModal"`

- [ ] **Step 3: Реализовать модалку**

Структура — 1:1 с tweb `popups/stickers.tsx:330-363`: шапка (крестик слева, заголовок по центру, меню «три точки» справа), скроллируемое тело с сеткой стикеров, плавающий футер с одной кнопкой. Состояния кнопки оттуда же: пока грузится — «Загрузка», набор не установлен — акцентная «Добавить N стикеров», установлен — красная «Удалить стикеры». Пока набор не приехал, вместо сетки — тот же скелетон, что в Task 6.

Сетка: 5 колонок (как на скриншоте), каждая ячейка — существующий `StickerMedia` с `play` по видимости через `animationIntersector`.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/stickers/StickerSetModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Открытие модалки из поиска и из чата**

В `StickersSearchTab.tsx` — клик по строке набора открывает `StickerSetModal` с его слагом. В чате — клик по стикеру в сообщении открывает модалку набора, которому стикер принадлежит (tweb: `wrapSticker` вешает открытие `PopupStickers` на клик).

- [ ] **Step 6: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 7: Проверить на стенде**

Пересобрать фронт и открыть :38080: клик по стикеру в чате открывает модалку, кнопка добавляет набор, набор появляется в панели.

```bash
cd web-client && npx vite build --outDir ../client-build
```

- [ ] **Step 8: Коммит**

```bash
git add web-client/src/components/stickers/ web-client/src/components/rightSidebar/StickersSearchTab.tsx
git commit -m "feat(stickers): модалка набора с добавлением (порт tweb popups/stickers)"
```

---

### Task 9: большие анимированные эмодзи

В наборе `animated_emoji` теперь 599 эмодзи от Telegram вместо шести самодельных. Механика поиска уже есть (`core/animatedEmoji.ts` — map `emoji → mediaId`, `useAnimatedEmoji` подставляет лотти при `bigEmojis === 1`), проверяем и чиним нормализацию.

**Files:**
- Modify: `web-client/src/core/animatedEmoji.ts` (при необходимости — нормализация)
- Test: `web-client/src/core/animatedEmoji.test.ts`

**Interfaces:**
- Consumes: набор `animated_emoji` из базы (Task 5)
- Produces: без изменений API

- [ ] **Step 1: Написать тест на нормализацию вариаций**

Telegram отдаёт alt-эмодзи то с селектором `FE0F`, то без. Добавить в `web-client/src/core/animatedEmoji.test.ts`:

```ts
it('находит анимацию независимо от селектора вариации', () => {
  const map = buildEmojiMap([{ emoji: '❤', mediaId: 1 }, { emoji: '😚', mediaId: 2 }])
  expect(getFromMap(map, '❤️')).toBe(1)  // с FE0F
  expect(getFromMap(map, '❤')).toBe(1)   // без
  expect(getFromMap(map, '😚')).toBe(2)
})
```

Имя геттера взять фактическое из `core/animatedEmoji.ts` (там уже есть `normalizeEmoji`, `getAnimatedEmoji`, `peekAnimatedEmoji`).

- [ ] **Step 2: Прогнать тест**

Run: `cd web-client && npx vitest run src/core/animatedEmoji.test.ts`
Expected: если нормализация уже покрывает оба случая — PASS, и правка не нужна; если FAIL — привести `normalizeEmoji` к варианту tweb (срезать `FE0F`).

- [ ] **Step 3: Проверить на стенде**

Отправить в чат одиночные `😚`, `🎉`, `🦆`. Ожидается: эмодзи проигрывается анимацией (до этой работы — статичная картинка, см. скриншот).

- [ ] **Step 4: Коммит (если были правки)**

```bash
git add web-client/src/core/animatedEmoji.ts web-client/src/core/animatedEmoji.test.ts
git commit -m "fix(emoji): нормализация вариаций для набора из 599 эмодзи"
```

---

### Task 10: набор по media id и открытие модалки из чата

Добавлена по ходу исполнения. Task 8 не смог связать стикер в сообщении с его набором: `ConvMsg` несёт только `mediaId`, а в роутере нет ни ручки «набор по media id», ни даже «набор по id» — только по слагу. Владелец проекта выбрал правку контракта вместо отказа от фичи.

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/stickersrepo.go` (метод `SetByMediaID`)
- Modify: `backend/internal/usecase/stickers/ports.go`, `interactor.go` (проброс)
- Modify: `backend/internal/adapter/delivery/http/stickers_handler.go` (хендлер), `router.go:254-274` (маршрут)
- Modify: `web-client/src/core/managers/stickersManager.ts` (метод менеджера)
- Modify: место рендера стикера в сообщении (`web-client/src/components/messages/`)
- Test: `backend/internal/adapter/repo/postgres/stickersrepo_test.go`, `backend/internal/adapter/delivery/http/stickers_handler_test.go`

**Interfaces:**
- Consumes: `StickerSetModal` из Task 8, `domain.StickerSet` из Task 2
- Produces: `GET /api/stickers/by-media/{mediaID}` → `{"set": StickerSet}` (404 `domain.ErrNotFound`, если медиа не принадлежит ни одному набору); `StickersRepo.SetByMediaID(ctx, mediaID int64) (domain.StickerSet, error)`; менеджер `setByMediaId(mediaId: number): Promise<StickerSet | null>`

- [ ] **Step 1: Написать падающий тест репозитория**

В `backend/internal/adapter/repo/postgres/stickersrepo_test.go` (хелперы поднятия базы — как в соседних тестах пакета):

```go
// SetByMediaID — обратный поиск: по файлу стикера найти набор. Нужен клику по
// стикеру в чате: сообщение несёт только media_id.
func TestSetByMediaID(t *testing.T) {
	ctx := context.Background()
	pool := newTestPool(t)
	repo := NewStickersRepo(pool)

	set, err := repo.CreateSet(ctx, domain.StickerSet{Slug: "utyaduck", Title: "Duck", Kind: "sticker"})
	if err != nil {
		t.Fatal(err)
	}
	mediaID := insertTestMedia(t, pool)
	if _, err := repo.AddSticker(ctx, set.ID, mediaID, "🦆", 0); err != nil {
		t.Fatal(err)
	}

	got, err := repo.SetByMediaID(ctx, mediaID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Slug != "utyaduck" {
		t.Errorf("slug = %q, ожидался utyaduck", got.Slug)
	}

	if _, err := repo.SetByMediaID(ctx, mediaID+99999); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("для чужого медиа err = %v, ожидался ErrNotFound", err)
	}
}
```

Имена хелперов (`newTestPool`, `insertTestMedia`) и сигнатуры `CreateSet`/`AddSticker` сверить с фактическими в пакете и подогнать, сохранив смысл.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestSetByMediaID -v`
Expected: FAIL — `repo.SetByMediaID undefined`

- [ ] **Step 3: Реализовать запрос**

В `stickersrepo.go`, рядом с `SetBySlug`, тем же стилем (`setCols`, `scanSet`, `domain.ErrNotFound` на `pgx.ErrNoRows`):

```sql
SELECT <setCols>
  FROM sticker_sets s
  JOIN stickers st ON st.set_id = s.id
 WHERE st.media_id = $1
 LIMIT 1
```

`LIMIT 1` осознанный: один и тот же файл может числиться в двух наборах (Telegram переиспользует документы), клику достаточно любого — как и в tweb, где набор берётся из атрибута самого документа.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestSetByMediaID -v`
Expected: PASS

- [ ] **Step 5: Написать падающий тест хендлера**

В `backend/internal/adapter/delivery/http/stickers_handler_test.go` по образцу соседних тестов: запрос `GET /stickers/by-media/42` отдаёт 200 и набор; для медиа без набора — 404.

- [ ] **Step 6: Реализовать хендлер и маршрут**

`StickersHandler.SetByMediaID` читает `chi.URLParam(r, "mediaID")`, парсит в int64 (нечисло → 400), зовёт usecase, на `domain.ErrNotFound` отдаёт 404, иначе `{"set": set}`. Маршрут в защищённой группе рядом с прочими стикерными:

```go
			pr.Get("/stickers/by-media/{mediaID}", stickersH.SetByMediaID)
```

- [ ] **Step 7: Прогнать тесты хендлера**

Run: `cd backend && go test ./internal/adapter/delivery/http/`
Expected: PASS

- [ ] **Step 8: Метод менеджера на фронте**

В `web-client/src/core/managers/stickersManager.ts`, рядом с `setBySlug`:

```ts
    /** Набор, которому принадлежит файл стикера. Нужен клику по стикеру в чате:
     * сообщение несёт только mediaId (бэк: GET /stickers/by-media/{mediaID}).
     * null — файл не из набора (стикер удалён или прислан как обычное медиа). */
    async setByMediaId(mediaId: number): Promise<StickerSet | null> {
      const r = await rest.get<{ set: RawStickerSet }>(`/stickers/by-media/${mediaId}`).catch(() => null)
      return r?.set ? mapStickerSet(r.set) : null
    },
```

- [ ] **Step 9: Открытие модалки по клику на стикер в сообщении**

Найти место рендера стикера в сообщении (`web-client/src/components/messages/`), повесить обработчик: по клику — `setByMediaId(mediaId)`, при непустом ответе открыть `StickerSetModal` с его слагом. Ответ `null` — не открывать ничего (не показывать пустую модалку). Поведение референса: tweb вешает открытие `PopupStickers` на клик по стикеру в бабле.

- [ ] **Step 10: Тест на открытие**

Тест в каталоге `web-client/src/components/messages/`: клик по стикеру сообщения зовёт `setByMediaId` с его `mediaId` и открывает модалку с полученным слагом; при `null` модалка не появляется. Мок менеджеров — по образцу `StickerSetModal.test.tsx` из Task 8. Клик — через `fireEvent`, как в остальных тестах проекта.

- [ ] **Step 11: Прогнать тесты**

Run: `cd web-client && npm test` и `cd backend && go test ./internal/adapter/delivery/http/ ./internal/usecase/stickers/`
Expected: PASS

- [ ] **Step 12: Коммит**

```bash
git add backend/internal web-client/src
git commit -m "feat(stickers): набор по media id и открытие модалки по клику в чате"
```

---

### Task 11: сид досидирует недостающие стикеры в существующий набор

Найдена живой проверкой на стенде. `seedSet` идемпотентен по слагу: набор, который уже есть в БД, пропускается целиком. На стенде из-за этого в `animated_emoji` остались **6** самодельных эмодзи вместо приехавших **599** — большие эмодзи в чате не анимируются ни для чего, кроме шести. То же случится с любым набором, в который Telegram позже добавит стикеров.

Ключ сопоставления — позиция стикера в наборе (индекс в `meta.json`): `media_id` при каждой заливке новый, а позиция стабильна.

**Files:**
- Modify: `backend/cmd/seed-stickers/main.go` (функция `seedSet`)
- Modify: `backend/internal/adapter/repo/postgres/stickersrepo.go` (метод `StickerPositions`)
- Modify: `backend/internal/usecase/stickers/ports.go`, `interactor.go` (проброс)
- Test: `backend/cmd/seed-stickers/main_test.go`, `backend/internal/adapter/repo/postgres/stickersrepo_test.go`

**Interfaces:**
- Consumes: `SetBySlug`, `AddSticker`, `SetRank`, `SetCover` (Task 2, 3)
- Produces: `StickersRepo.StickerPositions(ctx, setID int64) (map[int]struct{}, error)` — занятые позиции набора

- [ ] **Step 1: Написать падающий тест репозитория**

В `backend/internal/adapter/repo/postgres/stickersrepo_test.go` (хелперы — фактические из пакета):

```go
// StickerPositions отдаёт занятые позиции набора: по ним сид понимает, каких
// стикеров в наборе ещё нет, и досидирует только их.
func TestStickerPositions(t *testing.T) {
	ctx := context.Background()
	pool := newTestPool(t)
	repo := NewStickersRepo(pool)

	set, err := repo.CreateSet(ctx, domain.StickerSet{Slug: "positions", Title: "P", Kind: "sticker"})
	if err != nil {
		t.Fatal(err)
	}
	for _, pos := range []int{0, 1, 3} {
		if _, err := repo.AddSticker(ctx, set.ID, insertTestMedia(t, pool), "🦆", pos); err != nil {
			t.Fatal(err)
		}
	}

	got, err := repo.StickerPositions(ctx, set.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("позиций %d, ожидалось 3", len(got))
	}
	if _, ok := got[2]; ok {
		t.Error("позиция 2 не занята, а вернулась занятой")
	}
	if _, ok := got[3]; !ok {
		t.Error("позиция 3 занята, но не вернулась")
	}
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestStickerPositions -v`
Expected: FAIL — `repo.StickerPositions undefined`

- [ ] **Step 3: Реализовать запрос**

```sql
SELECT position FROM stickers WHERE set_id = $1
```

Собрать в `map[int]struct{}`. Пробросить через `ports.go` и `interactor.go` тем же способом, что `SetRank`/`SetCover`.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestStickerPositions -v`
Expected: PASS

- [ ] **Step 5: Написать падающий тест сида**

Тест на фейковом сидере (по образцу тестов из Task 3, где уже есть `setSeeder`): набор существует и содержит стикеры на позициях 0 и 1, в `meta.json` четыре файла — сид должен залить ровно два недостающих (позиции 2 и 3), не тронув существующие и не создав дублей.

- [ ] **Step 6: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./cmd/seed-stickers/ -v`
Expected: FAIL — сид пропускает существующий набор целиком, залито 0 стикеров вместо 2

- [ ] **Step 7: Переписать ветку существующего набора в `seedSet`**

Вместо раннего `return nil` при существующем слаге: получить занятые позиции, пройти по `meta.Stickers` и залить только те, чьей позиции нет; в конце — та же логика `SetRank`/`SetCover`, что уже есть. Если недостающих нет, залогировать «набор X уже полон» и выйти, не трогая БД. Существующие стикеры не удалять и не переупорядочивать: набор в Telegram мог измениться, но сносить историю сообщений, ссылающихся на старые media, нельзя.

- [ ] **Step 8: Прогнать тесты**

Run: `cd backend && go test ./cmd/seed-stickers/ ./internal/usecase/stickers/` и `go test ./internal/adapter/repo/postgres/`
Expected: PASS

- [ ] **Step 9: Коммит**

```bash
git add backend/cmd/seed-stickers/ backend/internal/adapter/repo/postgres/ backend/internal/usecase/stickers/
git commit -m "feat(stickers): сид досидирует недостающие стикеры в существующий набор"
```

---

## Что НЕ входит в этот план

- **Анимированные реакции** — отдельная подсистема (своя таблица, свой сид, свой API, свой рендер поверх `MessageReactions`). Вынесены в план `docs/superpowers/plans/2026-08-15-animated-reactions.md`.
- **Кастом-эмодзи в тексте** — механика (`custom_emoji` entity + `lib/customEmoji/compositor.worker.ts`) уже есть; 99 выгруженных emoji-наборов после Task 5 в неё попадают. Отдельная работа — только UI выбора кастом-эмодзи в панели.
- **Premium sticker effects** (`video_thumbs` типа `f`) — не выгружаются и не хранятся в модели `stickers`.
