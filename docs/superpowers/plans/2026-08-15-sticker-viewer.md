# Предпросмотр стикера по зажатию — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зажатие левой кнопки на стикере открывает его увеличенный предпросмотр поверх затемнения; не отпуская кнопку, можно водить мышью и переключаться между соседними стикерами; отпускание закрывает предпросмотр и не отправляет стикер.

**Architecture:** Один компонент-хук (`useStickerViewer`), который вешается на контейнер-список и работает делегированием: находит ближайшую ячейку стикера по `mousedown`, читает её `data-*` атрибуты и рисует оверлей в портале. Портирован из `tweb/src/components/stickerViewer.ts`, подключается в четырёх местах — панель стикеров, эмодзи-подсказки, лента сообщений, модалка набора.

**Tech Stack:** React 19 + TypeScript strict, SCSS-модули, vitest, существующий `StickerMedia` (tlottie).

## Global Constraints

- **Референс — tweb** `src/components/stickerViewer.ts` и `src/scss/partials/_stickerViewer.scss`. Поведение, размеры и длительности берутся оттуда, не выдумываются:
  - триггер — `mousedown` левой кнопкой (`e.button !== 0 || e.buttons > 1` → выход), **не** `click`;
  - размер превью — 360px (стикер), 280px при наличии эффекта, GIF — `min(480, высота окна − 200)`;
  - `openDuration = 200`, `switchDuration = 200`;
  - затемнение — `rgba(0, 0, 0, .6)`, оверлей `position: fixed`, `pointer-events: none`;
  - на тач-устройствах не подключается вовсе (`IS_TOUCH_SUPPORTED → return`);
  - одновременно открыт только один предпросмотр (в tweb — модульный флаг `hasViewer`);
  - после отпускания «проглатывается» следующий `click`, иначе стикер отправится.
- **MUI и framer-motion не возвращать**, анимации — CSS.
- **Мёртвый код удалять** агрессивно. Комментарии по-русски, объясняют «почему».
- **TypeScript strict.** Тесты проверяют поведение по существу.
- **Тесты:** `cd web-client && npm test`; отдельный файл — `npx vitest run <путь>`. Запускать обычным вызовом, ждать в том же вызове — **не** фоновой командой.
- В тестах нет глобального автоклинапа testing-library: несколько рендер-тестов в файле требуют `afterEach(cleanup)`.

---

### Task 1: хук предпросмотра

**Files:**
- Create: `web-client/src/components/stickers/useStickerViewer.ts`
- Create: `web-client/src/components/stickers/StickerViewer.tsx`
- Create: `web-client/src/components/stickers/StickerViewer.module.scss`
- Test: `web-client/src/components/stickers/useStickerViewer.test.tsx`

**Interfaces:**
- Consumes: `StickerMedia` (рендер стикера по `mediaId`), `Sticker` из `@core/managers/stickersManager`
- Produces: `useStickerViewer({ rootRef, findSticker })` — вешает делегированные слушатели и рендерит оверлей; `findSticker(el: HTMLElement) => Sticker | undefined` — как хост сопоставляет DOM-ячейку со стикером

- [ ] **Step 1: Написать падающий тест**

Создать `useStickerViewer.test.tsx`. Тестовый хост: список из трёх ячеек с `data-sticker-id`, хук с `findSticker`, который отдаёт стикер по этому атрибуту. Проверить:

```tsx
it('зажатие на ячейке открывает предпросмотр', () => {
  // fireEvent.mouseDown(cell, { button: 0 })
  // ожидание: в DOM появился оверлей [data-testid="sticker-viewer"] со стикером первой ячейки
})

it('отпускание закрывает предпросмотр', () => {
  // mouseDown → mouseUp (на document)
  // ожидание: оверлея нет
})

it('правая кнопка не открывает предпросмотр', () => {
  // fireEvent.mouseDown(cell, { button: 2 })
  // ожидание: оверлея нет
})

it('клик после отпускания проглатывается', () => {
  // mouseDown → mouseUp → click по ячейке
  // ожидание: onPick хоста не вызван (стикер не отправлен)
})

it('обычный клик без удержания стикер отправляет', () => {
  // click без предшествующего mouseDown-удержания
  // ожидание: onPick вызван — предпросмотр не должен ломать отправку
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/stickers/useStickerViewer.test.tsx`
Expected: FAIL — `Failed to resolve import "./useStickerViewer"`

- [ ] **Step 3: Реализовать хук и оверлей**

Делегирование на `rootRef`: `mousedown` → `closest` до ячейки → `findSticker` → показать оверлей. `mouseup` слушается на `document` (кнопку могут отпустить вне ячейки), `capture: true`, снимается в cleanup. Оверлей — портал в `document.body`, `pointer-events: none`, затемнение `rgba(0,0,0,.6)`, стикер 360px по центру, под ним — эмодзи стикера (как в tweb `sticker-viewer-emoji`).

Глушение следующего клика — как в tweb: одноразовый слушатель `click` с `capture` на `document`, снимающий сам себя.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/stickers/useStickerViewer.test.tsx`
Expected: PASS (5 тестов)

- [ ] **Step 5: Переключение стикеров при движении мыши**

Не отпуская кнопку, `mousemove` над другой ячейкой переключает предпросмотр на неё (в tweb — `onMouseMove` + класс `is-switching`, 200 мс). Тест: `mouseDown` на первой → `mouseMove` над третьей → в оверлее стикер третьей.

- [ ] **Step 6: Прогнать тесты и закоммитить**

Run: `cd web-client && npm test`
Expected: PASS

```bash
git add web-client/src/components/stickers/
git commit -m "feat(stickers): предпросмотр стикера по зажатию (порт tweb stickerViewer)"
```

---

### Task 2: подключить в четырёх местах

**Files:**
- Modify: `web-client/src/components/emoji/StickersTab.tsx` (панель стикеров)
- Modify: `web-client/src/components/StickersHelper.tsx` (подсказки по эмодзи)
- Modify: `web-client/src/components/stickers/StickerSetModal.tsx` (модалка набора)
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx` (превью строк в поиске)
- Test: по одному тесту на точку подключения (в существующих тестовых файлах этих компонентов)

**Interfaces:**
- Consumes: `useStickerViewer` из Task 1

В tweb подключено к: `stickersHelper.ts:118`, `emojiHelper.ts:107`, `bubbles.ts:1328` (лента) и `popups/stickers.tsx:310` (модалка). У нас лента и подсказки — это `StickersHelper`, а панель композера — `StickersTab`; экран поиска добавляем сверх tweb, потому что там ячейки такие же и предпросмотр там же уместен.

- [ ] **Step 1: Написать падающие тесты подключения**

По одному на компонент: зажатие на ячейке стикера открывает предпросмотр, отпускание закрывает, отправка по обычному клику по-прежнему работает. Моки — по образцу существующих тестов каждого компонента.

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `cd web-client && npm test`
Expected: FAIL в новых тестах — предпросмотр не открывается

- [ ] **Step 3: Подключить хук**

В каждом компоненте: `rootRef` на контейнер списка, `findSticker` — сопоставление ячейки со стикером по тому же признаку, что уже используется в компоненте для клика (не вводить новый атрибут, если существующий уже есть).

Важно: в ленте сообщений и на экране поиска клик по стикеру уже что-то делает (открывает модалку набора / отправляет стикер) — проверь, что глушение клика после предпросмотра не ломает этот путь, и что зажатие не мешает выделению сообщений.

- [ ] **Step 4: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add web-client/src
git commit -m "feat(stickers): предпросмотр подключён в панели, подсказках, ленте и модалке"
```

---

## Что НЕ входит в этот план

- **Тач-устройства** — в tweb предпросмотр там не работает вовсе (`IS_TOUCH_SUPPORTED → return`), long-tap имеет другое назначение.
- **Предпросмотр GIF** — `stickerViewer` в tweb умеет и GIF, но у нас вкладка GIF живёт своей кладкой; отдельная задача.
- **Эффекты премиум-стикеров** (`effectThumb`, размер 280) — у нас таких стикеров нет, ветка не портируется.
