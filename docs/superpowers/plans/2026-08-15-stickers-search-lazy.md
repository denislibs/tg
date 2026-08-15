# Экран поиска стикеров 1:1 с tweb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран «Поиск стикеров» ведёт себя как в tweb: сдвигает чат вместо того чтобы накрывать его, занимает геометрию заглушками сразу, грузит превью только по видимости и не больше восьми одновременно, а до загрузки показывает векторный силуэт стикера.

**Architecture:** Четыре независимых слоя. Первый — CSS/класс на `body`, уже реализованный для панели профиля. Второй и третий — фронт: ячейки-заглушки и очередь загрузки поверх существующего `useLazyVisibility`. Четвёртый проходит через весь стек: контур `photoPathSize` выгружается скриптом (он приходит вместе с документом, качать нечего), едет через `meta.json` в новую колонку, отдаётся с API и разворачивается в SVG портом `getPathFromBytes` из tweb.

**Tech Stack:** React 19 + TypeScript strict, SCSS-модули, vitest, Go 1.25 (pgx, goose), Python/telethon.

## Global Constraints

- **Референс — tweb.** Вёрстка, поведение и константы берутся 1:1 из `~/Documents/tweb`, не выдумываются. Ключевые места: `components/sidebarRight/tabs/stickers.tsx` (строение строки набора), `components/lazyLoadQueueBase.ts` (`PARALLEL_LIMIT = 8`), `components/wrappers/sticker.ts:268-287` (силуэт), `helpers/bytes/getPathFromBytes.ts` (разбор контура).
- **MUI и framer-motion не возвращать.** Анимации — на CSS-классах tweb.
- **Мёртвый код удалять** агрессивно: без заглушек и неиспользуемых веток.
- **Комментарии по-русски**, объясняют «почему», а не пересказывают код.
- **Тесты:** фронт `cd web-client && npm test`, бэк `cd backend && go test ./...` (интеграционные — testcontainers, Docker нужен).
- **В тестах нет глобального автоклинапа testing-library:** несколько рендер-тестов в файле требуют `afterEach(cleanup)`; кликают через `fireEvent`.
- **Данные выгрузки** (338 наборов) лежат в основном чекауте `~/Documents/messenger-denis/backend/assets/stickers`, в worktree их нет — прогоны скрипта и сида выполняет координатор.

---

### Task 1: экран сдвигает чат, а не накрывает его

Сейчас `RightSearchTab` — `position: absolute; z-index: 4` без класса на `body`, поэтому панель ложится поверх чата. Панель профиля (`UserInfoPanel.tsx:55`) уже делает правильно: вешает `body.is-right-column-shown`, под который в `styles/tweb/_chat.scss:438,458,513` (порт tweb) чат сужается.

**Files:**
- Modify: `web-client/src/components/rightSidebar/RightSearchTab.tsx`
- Test: `web-client/src/components/rightSidebar/RightSearchTab.shift.test.tsx` (создать)

**Interfaces:**
- Consumes: класс `is-right-column-shown` из `styles/tweb/_chat.scss`
- Produces: ничего нового наружу

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/rightSidebar/RightSearchTab.shift.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RightSearchTab from './RightSearchTab'

afterEach(cleanup)

describe('RightSearchTab и сдвиг контента', () => {
  it('пока открыт, на body висит класс сужения чата', () => {
    render(<RightSearchTab open title="Поиск стикеров" onBack={() => {}}>{null}</RightSearchTab>)
    expect(document.body.classList.contains('is-right-column-shown')).toBe(true)
  })

  it('снимает класс при закрытии', () => {
    const { rerender } = render(
      <RightSearchTab open title="Поиск стикеров" onBack={() => {}}>{null}</RightSearchTab>,
    )
    rerender(<RightSearchTab open={false} title="Поиск стикеров" onBack={() => {}}>{null}</RightSearchTab>)
    expect(document.body.classList.contains('is-right-column-shown')).toBe(false)
  })

  it('снимает класс при размонтировании', () => {
    const { unmount } = render(
      <RightSearchTab open title="Поиск стикеров" onBack={() => {}}>{null}</RightSearchTab>,
    )
    unmount()
    expect(document.body.classList.contains('is-right-column-shown')).toBe(false)
  })
})
```

Фактические пропсы `RightSearchTab` сверь с самим компонентом и подгони вызовы, сохранив смысл проверок.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/rightSidebar/RightSearchTab.shift.test.tsx`
Expected: FAIL — класса на `body` нет

- [ ] **Step 3: Повесить класс**

В `RightSearchTab.tsx` повторить приём из `UserInfoPanel.tsx:52-56` — эффект, который выставляет класс, пока панель открыта, и снимает его в cleanup. Отдельного нового механизма не заводить: класс один на всё приложение, и панель профиля с экраном поиска не бывают открыты одновременно — проверь это предположение по коду и, если оно неверно, вместо булева toggle используй счётчик открытых правых колонок.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/rightSidebar/RightSearchTab.shift.test.tsx`
Expected: PASS (3 теста)

- [ ] **Step 5: Прогнать полный фронт**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add web-client/src/components/rightSidebar/
git commit -m "fix(stickers): экран поиска сдвигает чат, а не накрывает его"
```

---

### Task 2: ячейки-заглушки занимают геометрию сразу

В tweb `renderSet` кладёт в строку пять пустых `<div class="sticker-set-sticker">` фиксированного размера ещё до запроса за составом набора (`sidebarRight/tabs/stickers.tsx:57-64`), и уже в них потом вставляются стикеры. Поэтому список не дёргается по мере подгрузки. У нас строка рендерит `stickers.map(...)` по факту приезда данных, то есть до ответа она пустая.

**Files:**
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx`
- Modify: `web-client/src/components/rightSidebar/RightSearchTab.module.scss` (стиль ячейки-заглушки, если его ещё нет)
- Test: `web-client/src/components/rightSidebar/StickersSearchTab.placeholders.test.tsx` (создать)

**Interfaces:**
- Consumes: `StickerSet.count` из менеджера стикеров
- Produces: ничего нового наружу

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/rightSidebar/StickersSearchTab.placeholders.test.tsx`. Тест рендерит таб с набором, чей `setBySlug` ещё не разрезолвился, и проверяет, что в строке набора уже есть `min(5, count)` ячеек (`[data-testid="sticker-set-cell"]`), а после резолва их столько же, но уже с содержимым. Моки менеджеров — по образцу существующего `StickersSearchTab.test.tsx`; промис `setBySlug` держать нерезолвленным через `new Promise(() => {})`.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickersSearchTab.placeholders.test.tsx`
Expected: FAIL — до резолва ячеек нет

- [ ] **Step 3: Рендерить ячейки от `count`, а не от данных**

Строка набора рисует `Array.from({length: Math.min(5, set.count)})` ячеек фиксированного размера (`PREVIEW_SIZE`), и `i`-я ячейка показывает `stickers[i]`, когда он приехал. Пустая ячейка не должна схлопываться: размер задаётся ей самой, а не содержимым — как `.sticker-set-sticker` в tweb.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickersSearchTab.placeholders.test.tsx`
Expected: PASS

- [ ] **Step 5: Прогнать полный фронт**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add web-client/src/components/rightSidebar/
git commit -m "feat(stickers): ячейки-заглушки занимают геометрию до загрузки"
```

---

### Task 3: очередь загрузки — по видимости и не больше восьми

Сейчас каждая строка на маунте зовёт `setBySlug` (`StickersSearchTab.tsx:48`) — сорок запросов залпом, каждый тянет полный набор ради пяти превью; `StickerMedia` качает контент на маунте без наблюдателя. В tweb одна `LazyLoadQueue` на весь экран (`sidebarRight/tabs/stickers.tsx:25`) с `PARALLEL_LIMIT = 8` (`lazyLoadQueueBase.ts:6`), и в неё отдаётся каждый `wrapSticker`.

В проекте уже есть половина механизма — `web-client/src/components/useLazyVisibility.ts` (один IntersectionObserver на список, порт того же `lazyLoadQueue`; им пользуется сетка модалки набора). Не хватает потолка параллельных загрузок и ленивости у самих наборов.

**Files:**
- Create: `web-client/src/core/lazyLoadQueue.ts`
- Create: `web-client/src/core/lazyLoadQueue.test.ts`
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx`
- Test: `web-client/src/components/rightSidebar/StickersSearchTab.lazy.test.tsx` (создать)

**Interfaces:**
- Consumes: `useLazyVisibility(rootRef, rootMargin)` из `@components/useLazyVisibility`
- Produces: `createLazyLoadQueue(parallelLimit = 8)` с методами `push(task: () => Promise<unknown>): Promise<unknown>` и `clear()`

- [ ] **Step 1: Написать падающий тест очереди**

Создать `web-client/src/core/lazyLoadQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createLazyLoadQueue } from './lazyLoadQueue'

describe('createLazyLoadQueue', () => {
  it('держит не больше parallelLimit задач одновременно', async () => {
    const queue = createLazyLoadQueue(2)
    let running = 0
    let peak = 0
    const resolvers: Array<() => void> = []

    const task = () => {
      running++
      peak = Math.max(peak, running)
      return new Promise<void>((resolve) => {
        resolvers.push(() => { running--; resolve() })
      })
    }

    const all = Promise.all([queue.push(task), queue.push(task), queue.push(task), queue.push(task)])
    await Promise.resolve()
    expect(peak).toBe(2)

    while (resolvers.length) resolvers.shift()!()
    await all
    expect(peak).toBe(2)
  })

  it('упавшая задача не блокирует очередь', async () => {
    const queue = createLazyLoadQueue(1)
    const failed = queue.push(() => Promise.reject(new Error('boom')))
    await expect(failed).rejects.toThrow('boom')
    await expect(queue.push(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/core/lazyLoadQueue.test.ts`
Expected: FAIL — `Failed to resolve import "./lazyLoadQueue"`

- [ ] **Step 3: Реализовать очередь**

Порт `lazyLoadQueueBase.ts` в объёме, который нам нужен: массив ожидающих задач, множество выполняющихся, лимит по умолчанию 8 (константа из tweb — не подбирать своё значение), запуск следующей задачи по завершении предыдущей независимо от исхода. Комментарием зафиксировать происхождение константы.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/core/lazyLoadQueue.test.ts`
Expected: PASS (2 теста)

- [ ] **Step 5: Написать падающий тест ленивости экрана**

Создать `StickersSearchTab.lazy.test.tsx`: при выдаче из десяти наборов и видимых первых двух `setBySlug` должен быть вызван только для видимых; после «появления» третьего (эмуляция через мок `useLazyVisibility`) — вызывается и для него. Мок `useLazyVisibility` возвращает управляемое множество видимых ключей.

- [ ] **Step 6: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickersSearchTab.lazy.test.tsx`
Expected: FAIL — `setBySlug` зовётся для всех наборов

- [ ] **Step 7: Подключить видимость и очередь**

Строка набора запрашивает состав только когда её ключ попал в видимые (`useLazyVisibility` с тем же `rootMargin`, что уже используется в модалке). Сам запрос и последующая загрузка превью идут через общую на экран очередь из Step 3. Уже загруженные наборы повторно не запрашиваются.

- [ ] **Step 8: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 9: Коммит**

```bash
git add web-client/src/core/lazyLoadQueue.ts web-client/src/core/lazyLoadQueue.test.ts \
        web-client/src/components/rightSidebar/
git commit -m "feat(stickers): ленивая загрузка наборов очередью с потолком 8 (порт tweb LazyLoadQueue)"
```

---

### Task 4: выгрузка векторных контуров

У документа стикера Telegram отдаёт `photoPathSize` (тип `j`) — 142–195 байт векторного контура, приходящих **вместе с документом**, отдельная загрузка не нужна. tweb рисует из них мгновенный силуэт. Мы их сейчас не сохраняем вовсе.

**Files:**
- Modify: `tools/fetch_stickers.py`

**Interfaces:**
- Consumes: `types.PhotoPathSize` из telethon
- Produces: поле `path` (base64) у каждого стикера в `meta.json`; флаг `--path-thumbs`, дописывающий его в уже выгруженные наборы

- [ ] **Step 1: Сохранять контур при выгрузке набора**

В `fetch_stickers.py` в месте сборки записи стикера добавить извлечение контура:

```python
def sticker_path(document: types.Document) -> str | None:
    """Векторный контур стикера (photoPathSize) в base64 — мгновенный силуэт до
    загрузки файла (tweb wrappers/sticker.ts:268 → createSvgFromBytes). Байты уже
    лежат в документе, отдельного запроса не требуют; у части документов их нет.
    """
    thumb = next((t for t in (document.thumbs or []) if isinstance(t, types.PhotoPathSize)), None)
    if thumb is None or not thumb.bytes:
        return None
    return base64.b64encode(thumb.bytes).decode("ascii")
```

и класть результат в запись `stickers[]` как `"path"`, когда он есть (импортировать `base64`).

- [ ] **Step 2: Режим досидирования контуров в существующие meta**

Наборы уже выгружены, и `meta.json` у них пишется один раз, поэтому нужен режим, дописывающий поле в готовые файлы: флаг `--path-thumbs`, который проходит по каталогам, перезапрашивает набор (`getStickerSet` по `short_name` из `meta.json`) и дописывает `path` тем стикерам, у которых его нет, сохраняя остальные поля. Сопоставление стикера с записью — по позиции, как это уже сделано для доливки в сиде.

- [ ] **Step 3: Проверить синтаксис**

Run: `tools/.venv/bin/python -m py_compile tools/fetch_stickers.py`
Expected: без ошибок

- [ ] **Step 4: Коммит**

```bash
git add tools/fetch_stickers.py
git commit -m "feat(stickers): выгрузка векторных контуров (photoPathSize)"
```

Прогон `--path-thumbs` на живых данных выполняет координатор: в worktree нет ни выгрузки, ни MTProto-сессии.

---

### Task 5: контур едет через бэкенд

**Files:**
- Create: `backend/internal/store/postgres/migrations/0096_stickers_path_thumb.sql`
- Modify: `backend/internal/domain/sticker.go` (поле `PathThumb`)
- Modify: `backend/internal/adapter/repo/postgres/stickersrepo.go` (`stickerCols`/скан, `AddStickerAt`)
- Modify: `backend/internal/usecase/stickers/ports.go`, `interactor.go`
- Modify: `backend/cmd/seed-stickers/main.go` (чтение `path` из `meta.json`)
- Test: `backend/internal/adapter/repo/postgres/stickersrepo_test.go`, `backend/cmd/seed-stickers/main_test.go`

**Interfaces:**
- Consumes: поле `path` из `meta.json` (Task 4)
- Produces: `domain.Sticker.PathThumb []byte` (json: `path_thumb`, `omitempty`), колонка `stickers.path_thumb BYTEA`

- [ ] **Step 1: Написать миграцию**

```sql
-- +goose Up
-- path_thumb — векторный контур стикера (Telegram photoPathSize, 142-195 байт).
-- Приходит вместе с документом и разворачивается клиентом в SVG-силуэт, который
-- виден мгновенно, пока грузится сам файл (tweb wrappers/sticker.ts:268).
-- Лежит у стикера, а не в media: это метаданные набора, а не отдельный файл.
ALTER TABLE stickers ADD COLUMN path_thumb BYTEA;

-- +goose Down
ALTER TABLE stickers DROP COLUMN path_thumb;
```

- [ ] **Step 2: Написать падающий тест репозитория**

В `stickersrepo_test.go`: `AddStickerAt` с непустым контуром сохраняет его, а `SetBySlug` возвращает; стикер без контура отдаёт пустой срез, а не ошибку. Имена хелперов сверить с фактическими в пакете.

- [ ] **Step 3: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestStickerPathThumb -v`
Expected: FAIL — поля нет

- [ ] **Step 4: Провести поле через слои**

Домен, колонки в `stickerCols` и скане, параметр в `AddStickerAt`, проброс в `ports.go`/`interactor.go`, чтение `path` из `meta.json` в сиде (декодировать base64; пустое поле — не ошибка).

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && go test ./cmd/seed-stickers/ ./internal/usecase/stickers/ ./internal/adapter/repo/postgres/`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add backend/internal backend/cmd/seed-stickers/
git commit -m "feat(stickers): векторный контур стикера в модели и сиде"
```

---

### Task 6: силуэт вместо пустой ячейки

**Files:**
- Create: `web-client/src/core/stickers/getPathFromBytes.ts` (порт tweb)
- Create: `web-client/src/core/stickers/getPathFromBytes.test.ts`
- Modify: `web-client/src/core/managers/stickersManager.ts` (поле `pathThumb`)
- Modify: `web-client/src/components/StickerMedia.tsx` (силуэт как нижний слой)
- Test: `web-client/src/components/StickerMedia.silhouette.test.tsx` (создать)

**Interfaces:**
- Consumes: `Sticker.path_thumb` из API (Task 5)
- Produces: `getPathFromBytes(bytes: Uint8Array): string`, `createSvgPathFromBase64(path: string, w: number, h: number): string`

- [ ] **Step 1: Портировать разбор контура**

Взять `/Users/denisurevic/Documents/tweb/src/helpers/bytes/getPathFromBytes.ts` и перенести 1:1 (алгоритм не переписывать и не «улучшать» — это формат Telegram). Рядом положить сборку SVG по образцу `createSvgFromBytes` оттуда же.

- [ ] **Step 2: Написать тест на разбор**

Тест кормит функции реальными байтами контура (взять из выгруженного `meta.json` любого набора — координатор приложит образец в задачу; либо синтетический массив по формату) и проверяет, что на выходе непустая строка `d`, начинающаяся с `M`, и что SVG получает `viewBox` из переданных размеров.

- [ ] **Step 3: Прогнать тест**

Run: `cd web-client && npx vitest run src/core/stickers/getPathFromBytes.test.ts`
Expected: PASS

- [ ] **Step 4: Пробросить поле и показать силуэт**

`pathThumb` добавить в тип и маппинг стикера (все методы менеджера, возвращающие стикеры). В `StickerMedia` силуэт — нижний слой: рисуется сразу, если контур есть и превью-картинки ещё нет, и уходит, когда появился первый кадр. Порядок слоёв и момент замены — как в tweb `sticker.ts:268-287` (`setSilhouette` → `upgradeToImage`).

- [ ] **Step 5: Написать тест на слой**

`StickerMedia.silhouette.test.tsx`: со стикером, у которого есть `pathThumb`, до загрузки в DOM присутствует `svg`; у стикера без контура — не присутствует, и это не ломает рендер.

- [ ] **Step 6: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add web-client/src/core/stickers/ web-client/src/core/managers/stickersManager.ts \
        web-client/src/components/StickerMedia.tsx web-client/src/components/StickerMedia.silhouette.test.tsx
git commit -m "feat(stickers): SVG-силуэт из векторного контура до загрузки файла"
```

---

## Что НЕ входит в этот план

- **Панель стикеров в композере** (`EmojiDropdown`/`StickersTab`) — там своя раскладка и свой список; ленивость для неё делается отдельно, по тем же трём слоям.
- **Виртуализация списка наборов** — tweb рендерит все строки, полагаясь на ленивую загрузку содержимого; виртуализация рядов сюда не входит.
- **Силуэты для реакций** — у ролей реакций свои документы, контуры для них не выгружаются.
