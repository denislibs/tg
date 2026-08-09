# Порт последовательности инициализации tweb 1:1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Первая отрисовка нашего клиента (залогиненный пользователь) покадрово неотличима от tweb: белый кадр 0 → цвета темы (transition .2s) → обои раньше интерфейса (fade .2s при первом заходе) → fade `#main-columns` 300 мс по готовности шрифтов → канвас-скелетон диалогов с бегущим бликом → волна стирания 150 мс/строка → fade-in аватарок 200 мс.

**Architecture:** Мы не копируем механизм загрузки tweb (у нас React + IDB-гидрация), но воспроизводим 1:1 его **видимый DOM, классы, CSS и тайминги**. Референс — исходники `/Users/denisurevic/Documents/tweb` (далее `TWEB/`) и живой DOM-дамп `docs/research/2026-08-08-tweb-live-dom-reference.md`. Решения пользователя: сплеш `#initial-loader` и inline-скрипт темы удаляем (строго 1:1 — кадр 0 белый, как в tweb); пилюлю «Выберите чат» удаляем (в tweb K её нет).

**Tech Stack:** React 19, TS strict, SCSS (портированные партиалы в `web-client/src/styles/tweb/`), vitest.

## Global Constraints

- Всё в `web-client/`; пути ниже — от `web-client/`, если не указан `TWEB/`.
- Отвечать/комментировать по-русски; комментарии — только о том, чего не видно из кода.
- Никакого MUI/emotion; стили — SCSS-партиалы `styles/tweb/*` (порт «дословно») либо CSS-модули.
- Классы, размеры и тайминги — **точно из tweb**, ничего не выдумывать: `--transition-standard-in: .3s cubic-bezier(.4,0,.2,1)`; fade обоев `.2s ease`; шиммер `inc 0.032/кадр`, `lightSpread 0.55`, пауза `850ms`; волна стирания `DURATION 150 / DELAY 15 / easeInOutSine`; аватар `fade-in-opacity .2s ease forwards`; строка диалога 72px, аватар 54px; «Updating…» не раньше 2000 мс.
- После каждой задачи: `npm run typecheck && npm test` зелёные; в конце задачи коммит.
- Прод-сборку для ручной проверки собирать `npx vite build --outDir ../client-build` (раздаёт nginx стенда `msgrverify` на :38080/:38443).
- Мёртвый код удалять сразу (DialogSkeleton, initialLoader и т.п.).

---

### Task 1: Кадр 0 как в tweb — убрать сплеш и inline-скрипт темы

В tweb (`TWEB/index.html`) нет ни лоадера, ни pre-theme-скрипта: до JS виден белый холст (`meta color-scheme=light`, `body { background: var(--body-background-color); transition: background-color .2s }`, переменная не задана → transparent). Цвета ставит только `themeController`. У нас это `#initial-loader` + inline-скрипт (index.html:19-52) — удаляем целиком.

**Files:**
- Modify: `index.html`
- Delete: `src/client/initialLoader.ts`
- Modify: `src/App.tsx` (вызов `removeInitialLoader`, App.tsx:187-189)
- Modify: `src/styles/index.scss` (фолбэк `#181818`)

**Interfaces:**
- Produces: `index.html` без `#initial-loader`; `<meta name="color-scheme" content="light">` в `<head>`; body-классы дополнятся в Task 5.

- [ ] **Step 1: index.html — удалить сплеш и скрипт, добавить meta**

Удалить: inline `<script>` темы (строки 19-36), inline `<style>` `#initial-loader` (41-52), `<div id="initial-loader"></div>` (61). Добавить в `<head>` (как `TWEB/index.html:17`):

```html
<meta name="color-scheme" content="light">
```

- [ ] **Step 2: удалить src/client/initialLoader.ts и его вызов**

`git rm src/client/initialLoader.ts`. В `src/App.tsx` убрать импорт `removeInitialLoader` и `useEffect(() => removeInitialLoader())` (App.tsx:187-189). Прогнать `grep -rn initialLoader src` — ссылок остаться не должно.

- [ ] **Step 3: styles/index.scss — фон как в tweb**

Было (index.scss:12-20): `html, body, #root { background: var(--body-background-color, #181818) }`. Стало — без фолбэка, transition уже обеспечивает наш порт base.scss (проверить `styles/tweb/`-выдержку base: `body { transition: background-color .2s }`; если нет — добавить туда, `TWEB/src/scss/base.scss:441-447`):

```scss
html, body, #root {
  height: 100%;
  background: var(--body-background-color);
}
```

- [ ] **Step 4: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS (если тесты ссылались на initialLoader — поправить/удалить их).

- [ ] **Step 5: ручная проверка кадра 0**

`npx vite build --outDir ../client-build`, открыть https://localhost:38443 с холодным кэшем (DevTools → Disable cache): первый кадр белый, затем тема появляется с плавным переходом фона 0.2s. `document.getElementById('initial-loader')` → null. Зомби-узла `#initial-loader.hide` (был виден в DOM-дампе) больше нет.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(init): кадр 0 как tweb — без сплеша и pre-theme скрипта"
```

---

### Task 2: Пустой центр 1:1 — убрать пилюлю, всегда держать `.chat.tabs-tab.active`

tweb всегда создаёт колонку чата: `#column-center > .chats-container.tabs-container > div.chat.tabs-tab.active` (живой дамп §1; `TWEB/src/components/chat/chat.ts:250`, `appImManager.ts:314-315`), а «Select a chat»-пилюли не существует (грепом по `TWEB/src/lang.ts` её нет — это фича Web A/Z). У нас вместо этого `._empty_ > ._emptyPill_` (App.tsx:132-134).

**Files:**
- Modify: `src/App.tsx` (блок пустого состояния)
- Modify: `src/App.module.scss` (удалить `.empty`, `.emptyPill`)
- Modify: `src/i18n/dict.ru.ts` (удалить ключ пилюли, если больше нигде не используется)

**Interfaces:**
- Produces: при отсутствии выбранного чата `#column-center > .chats-container` содержит `<div class="chat tabs-tab active">` (пустой). `Chat.tsx` уже рендерит эти классы сам (Chat.tsx:1049) — пустой div рендерится только когда чат не выбран.

- [ ] **Step 1: App.tsx — заменить пилюлю на пустую колонку**

Найти рендер пустого состояния (App.tsx:132-134, `s.empty`/`s.emptyPill`) и заменить на:

```tsx
<div className="chat tabs-tab active" />
```

- [ ] **Step 2: App.module.scss + dict — удалить мёртвое**

Удалить правила `.empty`, `.emptyPill` (App.module.scss:26-35). `grep -rn "Выберите чат" src` → если ключ больше не используется, удалить строку из `dict.ru.ts`.

- [ ] **Step 3: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: ручная проверка**

Пересобрать, открыть стенд без выбранного чата: по центру только обои с узором, DOM `#column-center` совпадает с эталоном `01-skeleton.json`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(init): пустой центр 1:1 tweb — .chat.tabs-tab.active вместо пилюли"
```

---

### Task 3: Обои раньше интерфейса — eager mount, слоты и первый fade

tweb вставляет слой обоев **первым потомком body до построения UI** (`TWEB/src/index.ts:544-545`, `chatBackground.tsx:377-381` `parent.insertBefore(element, parent.firstChild)`) и показывает слот так: первый в жизни фон — `instant`, если содержимое в кэше, иначе **fade `.2s ease`** (`resolveTransition`, `chatBackground.tsx:349-359`; `.SlotFade { transition: opacity .2s ease }`, `chatBackground.module.scss:42-44`; перед активацией слота принудительный reflow `void el.offsetWidth`, `chatBackground.tsx:411-414`). У нас фон — lazy-чанк с плоским Suspense-фолбэком и резкой подменой (`ChatBackgroundLazy.tsx`), узор доезжает отдельно после `img.onload`.

**Files:**
- Delete: `src/components/ChatBackgroundLazy.tsx`
- Modify: `src/components/ChatBackground.tsx`
- Create: `src/components/ChatBackground.module.scss`
- Create: `src/components/chatBackgroundTransition.ts` (+ Test: `src/components/chatBackgroundTransition.test.ts`)
- Modify: `src/App.tsx` (импорт + портал)

**Interfaces:**
- Consumes: существующие `gradientRenderer`, проп `themeColors` — без изменений.
- Produces: `<ChatBackground themeColors?>` рендерится в портал-контейнер, вставленный первым потомком `document.body`; экспорт `resolveTransition(args: { hadPrevious: boolean; cached: boolean }): 'instant' | 'fade'`.

- [ ] **Step 1: тест resolveTransition (падает)**

```ts
// src/components/chatBackgroundTransition.test.ts
import { describe, expect, it } from 'vitest'
import { resolveTransition } from './chatBackgroundTransition'

// tweb chatBackground.tsx:349-359 — первый в жизни фон: из кэша instant, иначе fade.
describe('resolveTransition', () => {
  it('первый показ без кэша — fade', () => {
    expect(resolveTransition({ hadPrevious: false, cached: false })).toBe('fade')
  })
  it('первый показ из кэша — instant', () => {
    expect(resolveTransition({ hadPrevious: false, cached: true })).toBe('instant')
  })
  it('повторная установка того же фона — instant', () => {
    expect(resolveTransition({ hadPrevious: true, cached: true })).toBe('instant')
  })
})
```

- [ ] **Step 2: убедиться, что тест падает**

Run: `npx vitest run src/components/chatBackgroundTransition.test.ts`
Expected: FAIL («Cannot find module './chatBackgroundTransition'»).

- [ ] **Step 3: реализация resolveTransition**

```ts
// src/components/chatBackgroundTransition.ts
// Порт tweb chatBackground.tsx resolveTransition (усечённо: 'auto'-ветка — наша
// единственная: первый показ решается по кэшу, повторные — instant).
export function resolveTransition(args: { hadPrevious: boolean; cached: boolean }): 'instant' | 'fade' {
  if (args.hadPrevious) return 'instant'
  return args.cached ? 'instant' : 'fade'
}
```

Run: `npx vitest run src/components/chatBackgroundTransition.test.ts` → PASS.

- [ ] **Step 4: ChatBackground.module.scss — слои и слоты tweb**

Порт из `TWEB/src/components/chat/bubbles/chatBackground.module.scss` (классы можно называть локально — это CSS-модуль, как и в tweb):

```scss
.Layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.Slot {
  position: absolute;
  inset: 0;
  opacity: 0;
}
.SlotActive { opacity: 1; }
.SlotFade { transition: opacity .2s ease; }
.GradientCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 5: ChatBackground.tsx — портал первым потомком body + слот**

Убрать inline-стили `position:fixed`-обёртки; рендерить через портал в контейнер, вставленный первым потомком body (эквивалент tweb `insertBefore(..., parent.firstChild)`):

```tsx
const [host] = useState(() => document.createElement('div'))
useLayoutEffect(() => {
  document.body.insertBefore(host, document.body.firstChild)
  return () => { host.remove() }
}, [host])
```

Содержимое: `.Layer > .Slot` (в слоте оба канваса). Готовность слота = градиент инициализирован **и** узор загружен (`img.onload` паттерна, ChatBackground.tsx:130-133). По готовности: `transition = resolveTransition({ hadPrevious, cached })`, где `cached` — синхронная готовность (`img.complete` уже загруженного pattern.svg). При `'fade'` добавить `.SlotFade`, затем `void slotEl.offsetWidth` (reflow как в tweb), затем `.SlotActive`; при `'instant'` — сразу `.SlotActive`. `hadPrevious` — ref, взводится после первой активации (смена чат-темы остаётся мгновенной, как сейчас).

- [ ] **Step 6: App.tsx — eager import, удалить lazy**

`import ChatBackground from './components/ChatBackground'` вместо `./ChatBackgroundLazy`; `git rm src/components/ChatBackgroundLazy.tsx`. Убрать Suspense-обёртку, если она была только для фона.

- [ ] **Step 7: typecheck + тесты + ручная проверка**

`npm run typecheck && npm test` → PASS. Пересобрать; холодный старт: обои (градиент + узор вместе) проявляются fade-ом 0.2s **до/одновременно с** появлением интерфейса, без поздней резкой подмены и без «доезжающего» узора. DOM: контейнер обоев — первый потомок `body` (как `div > div._Layer…` в эталоне §1).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(init): обои как tweb — первым потомком body, слоты + первый fade .2s"
```

---

### Task 4: Появление shell — fadeInWhenFontsReady(#main-columns) вместо WAAPI

tweb прячет `#main-columns` (`style.opacity='0'`, `TWEB/src/index.ts:529,615`) и проявляет его в rAF после шрифтов (кап 1 с) через CSS `#main-columns { transition: opacity var(--transition-standard-in) }` (.3s cubic-bezier(.4,0,.2,1), `_pages.scss:6-9`). У нас CSS уже портирован (`styles/tweb/pages/_pages.scss:11-14`) и хелпер уже есть (`src/core/dom/loadFonts.ts` → `fadeInWhenFontsReady`, ни разу не вызывается), но `useShellEnterAnimation` вместо этого играет WAAPI-fade 200 мс по `#page-chats` — заменить.

**Files:**
- Modify: `src/core/hooks/useShellEnterAnimation.ts`

**Interfaces:**
- Consumes: `fadeInWhenFontsReady(el: HTMLElement | null): Promise<void>` из `src/core/dom/loadFonts.ts`.
- Produces: ветка обычного показа больше не использует `el.animate`; ветка `ANIMATE_MAIN_KEY` (main-screen-enter после смены аккаунта) — без изменений.

- [ ] **Step 1: заменить обычную ветку**

В `useShellEnterAnimation.ts` (строки 17-21) вместо `el.animate([...])`:

```ts
import { fadeInWhenFontsReady } from '../dom/loadFonts'
// ...
if (!localStorage.getItem(ANIMATE_MAIN_KEY)) {
  // tweb src/index.ts:615 — прячем #main-columns до готовности шрифтов (кап 1с),
  // проявление отдаёт CSS: transition opacity .3s cubic-bezier(.4,0,.2,1).
  void fadeInWhenFontsReady(document.getElementById('main-columns'))
  return
}
```

При смене аккаунта (`ANIMATE_MAIN_KEY`) — оставить как есть: tweb в этой ветке тоже ждёт `fontsPromise` до `main-screen-entering` (`TWEB/src/index.ts:624-642`); добавить `void loadFonts()` перед `playMainScreenEnter(el)` не нужно — enter играется по `#page-chats`, шрифты уже прогреты повторным заходом (`document.fonts.check` в `fadeInWhenFontsReady`).

- [ ] **Step 2: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: ручная проверка**

Пересобрать. Холодный старт (кэш шрифтов очищен): интерфейс проявляется одним fade ~300 мс (замерить в DevTools → Animations: transition на `#main-columns`, easing cubic-bezier(0.4, 0, 0.2, 1)). Повторный заход: без прятанья (шрифты в кэше — как наш instant-boot путь).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(init): fade #main-columns .3s по готовности шрифтов — как tweb fadeInWhenFontsReady"
```

---

### Task 5: Гейты классов body — `has-auth-pages` статически, `is-left-column-shown`

tweb: `<body class="animation-level-2 has-auth-pages rounded-sections">` прямо в HTML (`TWEB/index.html:41`); `bootstrapIm` после `doubleRaf()` снимает `has-auth-pages` (`bootstrapIm.ts:60-61`) — до этого transition `.main-column` заглушен (`_chats.scss:52-54`, у нас уже портирован: `styles/tweb/pages/_chats.scss:47-54`); `appImManager.selectTab` ставит `body.is-left-column-shown` (`appImManager.ts:2593`; есть в эталонных классах body §1). У нас `has-auth-pages` ставится только из AuthFlow (AuthFlow.tsx:81-86), на залогиненном старте гейта нет, `is-left-column-shown` нет вовсе.

**Files:**
- Modify: `index.html` (класс body)
- Modify: `src/App.tsx` (Shell-эффект)

**Interfaces:**
- Consumes: `doubleRaf()` из `src/core/accountTransition.ts` (уже используется в AuthFlow.tsx:86).
- Produces: на залогиненном старте body проходит `has-auth-pages` → (doubleRaf) → без него; `is-left-column-shown` присутствует, пока Shell смонтирован.

- [ ] **Step 1: index.html**

`<body class="rounded-sections animation-level-2 has-horizontal-folders">` → добавить `has-auth-pages` (порядок не важен, состав — как tweb + наши прижившиеся классы).

- [ ] **Step 2: Shell-эффект в App.tsx**

В компоненте Shell (App.tsx:42-51, рядом с `useShellEnterAnimation`):

```tsx
useLayoutEffect(() => {
  document.body.classList.add('is-left-column-shown') // tweb appImManager.selectTab(CHATLIST)
  // tweb bootstrapIm.ts:60-61 — transition .main-column включается кадром позже,
  // чтобы колонка не «въехала» из офскрина при первом показе.
  void doubleRaf().then(() => document.body.classList.remove('has-auth-pages'))
  return () => { document.body.classList.remove('is-left-column-shown') }
}, [])
```

AuthFlow уже добавляет/снимает `has-auth-pages` сам — статический класс в HTML делает его add идемпотентным, конфликтов нет.

- [ ] **Step 3: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: ручная проверка**

Пересобрать. В DevTools на живом стенде: сразу после загрузки body-классы содержат `is-left-column-shown` и не содержат `has-auth-pages` (совпадает с эталоном §1: `animation-level-2 rounded-sections is-left-column-shown has-horizontal-folders`). На экране логина `has-auth-pages` присутствует.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(init): body-гейты tweb — has-auth-pages из HTML, is-left-column-shown в Shell"
```

---

### Task 6: Канвас-скелетон диалогов + волна стирания (порт dialogsPlaceholder)

Сердце задачи. tweb рисует скелетон списка одним `<canvas class="dialogs-placeholder-canvas">` поверх чатлиста (`TWEB/src/helpers/dialogsPlaceholder.ts`): заливка `surface-color`, дырки строк вырезаны `destination-out` (аватар 54, строка 72, `marginLeft 17`, `avatarMarginRight 10`, `lineHeight 10`, `lineBorderRadius 6`, `statusWidth 24`, рандомные ширины кэшируются), бегущий блик — rAF (`TWEB/src/helpers/canvas/shimmer.ts`: `inc 0.032`, `lightSpread 0.55`, `pauseInterval 850`, старт `-0.6`), на время показа скролл блокируется (`overflowY:hidden`). Замена — **волна стирания**: `detach(rowCount)` → построчно `DURATION 150 мс`, каскад `DELAY 15 мс`, `easeInOutSine`, из-под канваса появляются уже отрендеренные строки (`dialogsPlaceholder.ts:144-214`). Наш `DialogSkeleton` (9 DOM-строк, лесенка opacity, `skelShimmer 1.4s`) удаляем; заодно уходит наблюдавшаяся белая дыра ~200 мс между скелетоном и списком (у нас скелетон unmount'ился раньше рендера строк).

**Files:**
- Create: `src/components/chatlist/dialogsPlaceholder.ts` (порт `TWEB/src/helpers/dialogsPlaceholder.ts` + `TWEB/src/helpers/canvas/shimmer.ts`)
- Create: `src/shared/lib/easeInOutSine.ts` (порт `TWEB/src/helpers/easing/easeInOutSine.ts`) + Test: `src/shared/lib/easeInOutSine.test.ts`
- Test: `src/components/chatlist/dialogsPlaceholder.test.ts` (детач-прогресс)
- Modify: `src/components/ChatList.tsx` (ChatList.tsx:55-74)
- Modify: `src/styles/tweb/_leftSidebar.scss` — если файла нет, правило положить в `src/styles/tweb/_chatlist.scss`
- Delete: `src/components/DialogSkeleton.tsx`, `src/components/DialogSkeleton.module.scss`

**Interfaces:**
- Produces:
  ```ts
  class DialogsPlaceholder {
    attach(args: { container: HTMLElement; blockScrollable?: HTMLElement }): void
    detach(availableLength: number): void   // волна стирания, потом remove()
    remove(): void                          // мгновенно (без анимации)
  }
  // чистая функция для тестов и рендера волны:
  export function detachRowProgress(args: {
    elapsed: number; row: number; availableLength: number; length: number
  }): number // 0..1, alpha стирания строки
  ```
- Consumes: `easeInOutSine(t, b, c, d)` из `src/shared/lib/easeInOutSine.ts`.

- [ ] **Step 1: тест easeInOutSine (падает)**

```ts
// src/shared/lib/easeInOutSine.test.ts
import { describe, expect, it } from 'vitest'
import { easeInOutSine } from './easeInOutSine'

// Сигнатура tweb (t: elapsed, b: старт, c: дельта, d: длительность).
describe('easeInOutSine', () => {
  it('края', () => {
    expect(easeInOutSine(0, 0, 1, 150)).toBeCloseTo(0)
    expect(easeInOutSine(150, 0, 1, 150)).toBeCloseTo(1)
  })
  it('середина = 0.5', () => {
    expect(easeInOutSine(75, 0, 1, 150)).toBeCloseTo(0.5)
  })
})
```

Run: `npx vitest run src/shared/lib/easeInOutSine.test.ts` → FAIL.

- [ ] **Step 2: порт easeInOutSine**

```ts
// src/shared/lib/easeInOutSine.ts — порт TWEB/src/helpers/easing/easeInOutSine.ts
export function easeInOutSine(t: number, b: number, c: number, d: number): number {
  return (-c / 2) * (Math.cos((Math.PI * t) / d) - 1) + b
}
```

Run → PASS.

- [ ] **Step 3: тест detachRowProgress (падает)**

```ts
// src/components/chatlist/dialogsPlaceholder.test.ts
import { describe, expect, it } from 'vitest'
import { detachRowProgress } from './dialogsPlaceholder'

// tweb dialogsPlaceholder.ts:169-176 — DURATION 150, DELAY 15 на строку;
// строки за пределами availableLength стартуют с задержкой последней доступной.
describe('detachRowProgress', () => {
  it('строка 0 начинается сразу, к 150мс полностью стёрта', () => {
    expect(detachRowProgress({ elapsed: 0, row: 0, availableLength: 5, length: 5 })).toBeCloseTo(0)
    expect(detachRowProgress({ elapsed: 150, row: 0, availableLength: 5, length: 5 })).toBeCloseTo(1)
  })
  it('строка 2 ждёт свой каскад 30мс', () => {
    expect(detachRowProgress({ elapsed: 30, row: 2, availableLength: 5, length: 5 })).toBeCloseTo(0)
    expect(detachRowProgress({ elapsed: 30 + 75, row: 2, availableLength: 5, length: 5 })).toBeCloseTo(0.5)
  })
  it('строки за availableLength стартуют вместе с последней доступной', () => {
    const a = detachRowProgress({ elapsed: 100, row: 7, availableLength: 3, length: 9 })
    const b = detachRowProgress({ elapsed: 100, row: 8, availableLength: 3, length: 9 })
    expect(a).toBeCloseTo(b)
  })
})
```

Run: `npx vitest run src/components/chatlist/dialogsPlaceholder.test.ts` → FAIL.

- [ ] **Step 4: порт dialogsPlaceholder.ts**

Портировать `TWEB/src/helpers/dialogsPlaceholder.ts` + `TWEB/src/helpers/canvas/shimmer.ts` в один файл `src/components/chatlist/dialogsPlaceholder.ts`, «дословно» по логике рисования. Адаптации (только эти):

| tweb | у нас |
|---|---|
| `import liteMode` | `const animationsEnabled = () => !document.body.classList.contains('animation-level-0')` |
| `rootScope.addEventListener('theme_changed')` | `MutationObserver` на `document.documentElement` (attributes: `data-theme`, `style`) → `renderDetails()` |
| `mediaSizes.addEventListener('resize')` | `window.addEventListener('resize')` → `renderDetails()` |
| `getRectFrom` (#folders-container) | `container.getBoundingClientRect()` |
| цвета | `getComputedStyle(document.documentElement).getPropertyValue('--surface-color' / '--background-color')` при каждом `renderDetails()` |

Константы — точно из tweb: размеры строк (`dialogsPlaceholder.ts:66-76`), рандомные ширины с кэшем (`:308-312`), шиммер (`shimmer.ts:13-16`), волна (`DURATION 150 / DELAY 15`). `detachRowProgress` — экспортируемая чистая функция, используемая из `renderDetachAnimationFrame`. Канвас: `class="dialogs-placeholder-canvas"`, размер = rect контейнера × `devicePixelRatio`. `attach` ставит `blockScrollable.style.overflowY = 'hidden'`, `remove()` возвращает `''` (tweb `:125-128`). Тест из Step 3 — PASS.

- [ ] **Step 5: CSS**

В `src/styles/tweb/_chatlist.scss` (порт `TWEB/src/scss/partials/_leftSidebar.scss:434-443`):

```scss
.dialogs-placeholder-canvas {
  position: absolute;
  top: 0;
  z-index: 2;

  body.has-horizontal-folders & {
    top: .5rem;
  }
}
```

- [ ] **Step 6: интеграция в ChatList.tsx**

Убрать `{loaded ? <ul className="chatlist">…</ul> : <DialogSkeleton />}` (ChatList.tsx:55-74) — `<ul className="chatlist">` рендерится **всегда** (пустой, пока строк нет). Поверх — плейсхолдер через ref-эффект:

```tsx
const placeholderRef = useRef<DialogsPlaceholder | null>(null)
const listWrapRef = useRef<HTMLDivElement>(null) // существующая обёртка скролла списка

// показываем только на «первом в жизни» заходе — когда IDB-кэша не было
// (tweb гейт loadedDialogsAtLeastOnce, autonomousDialogList/base.ts:210-214)
useLayoutEffect(() => {
  if (loaded || bootData?.hydratedFromCache) return
  const p = new DialogsPlaceholder()
  placeholderRef.current = p
  p.attach({ container: listWrapRef.current!, blockScrollable: listWrapRef.current! })
  return () => { p.remove() }
}, [])

useEffect(() => {
  if (!loaded) return
  placeholderRef.current?.detach(items.length) // волна стирания поверх уже отрендеренных строк
  placeholderRef.current = null
}, [loaded])
```

`bootData.hydratedFromCache` уже есть (`src/client/bootData.ts`). Контейнеру списка — `position: relative`, если ещё нет.

- [ ] **Step 7: удалить DialogSkeleton**

`git rm src/components/DialogSkeleton.tsx src/components/DialogSkeleton.module.scss`; `grep -rn DialogSkeleton src` → пусто; выпилить упоминания из тестов.

- [ ] **Step 8: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: ручная проверка (сценарий «первый заход»)**

Пересобрать. В DevTools: Application → очистить IndexedDB `msgr-store` (токен в `msgr` не трогать), Network → Slow 3G, перезагрузка. Ожидание: в сайдбаре канвас-скелетон (строки 72px, аватары 54px, бегущий блик ~1.1 с с паузой 850 мс), скролл заблокирован; при приходе диалогов — волна стирания сверху вниз (≈150 мс/строка, каскад 15 мс), **без кадра пустого белого списка**; скролл вернулся. Повторная перезагрузка (кэш есть): скелетона нет, список сразу. Переключить «Без анимации» → скелетон статичен, замена мгновенная.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(init): канвас-скелетон диалогов tweb — шиммер + волна стирания 150мс/строка"
```

---

### Task 7: Fade-in аватарок 200 мс

tweb вешает на загрузившуюся фотографию `avatar-photo fade-in` → `animation: fade-in-opacity .2s ease forwards` (`TWEB/src/scss/partials/_avatar.scss:126-128`, `avatarNew.tsx:552`), и снимает класс после окончания, чтобы последующие ре-рендеры не мигали (`avatarNew.tsx:600`). CSS у нас уже портирован (`src/styles/tweb/_avatar.scss:126-127`), но `Avatar.tsx` класс не ставит — фото появляется резко.

**Files:**
- Modify: `src/shared/ui/Avatar/Avatar.tsx` (строка 88 — `img.avatar-photo`)

**Interfaces:**
- Produces: `<img class="avatar-photo fade-in">` на время первой загрузки; класс снимается по `animationend`.

- [ ] **Step 1: реализация**

```tsx
<img
  className="avatar-photo fade-in"
  src={src}
  alt=""
  loading="lazy"
  decoding="async"
  onAnimationEnd={(e) => e.currentTarget.classList.remove('fade-in')}
/>
```

Кэшированные картинки: браузер декодирует их к первому кадру, но анимация всё равно отыгрывает 200 мс — ровно как в tweb (`animate = true` для фото). Ничего дополнительно не гейтить.

- [ ] **Step 2: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: ручная проверка**

Пересобрать; Slow 3G, перезагрузка: фотографии аватарок в чатлисте проявляются fade-ом 0.2s (в DevTools → Animations видна `fade-in-opacity`), плейсхолдер-градиент под ними — без мигания при повторных рендерах списка.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(init): fade-in аватарок .2s — класс fade-in как tweb avatarNew"
```

---

### Task 8: «Обновление…» в поиске — не раньше 2 секунд

tweb показывает статус соединения в плейсхолдере поиска только спустя `INITIAL_DELAY = 2000` мс после старта (смена состояния — с задержкой `CHANGE_STATE_DELAY = 400`; `TWEB/src/components/connectionStatus.ts:19-21`). У нас `placeholder={loaded ? t('Search') : t('Updating…')}` (Sidebar.tsx:213) — «Обновление…» мигает с первого кадра при каждом холодном старте.

**Files:**
- Create: `src/core/hooks/useConnectionStatusLabel.ts` + Test: `src/core/hooks/useConnectionStatusLabel.test.ts`
- Modify: `src/components/Sidebar.tsx:213`

**Interfaces:**
- Produces: `useConnectionStatusLabel(loaded: boolean): boolean` — `true`, когда пора показывать «Updating…» (не раньше 2000 мс от монтирования и только пока `!loaded`).

- [ ] **Step 1: тест (падает)**

```ts
// src/core/hooks/useConnectionStatusLabel.test.ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStatusLabel } from './useConnectionStatusLabel'

describe('useConnectionStatusLabel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('первые 2с — false, даже если не loaded', () => {
    const { result } = renderHook(() => useConnectionStatusLabel(false))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1999))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('loaded до истечения 2с — не показывается вовсе', () => {
    const { result, rerender } = renderHook(({ l }) => useConnectionStatusLabel(l), { initialProps: { l: false } })
    act(() => vi.advanceTimersByTime(1000))
    rerender({ l: true })
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(false)
  })
})
```

Run: `npx vitest run src/core/hooks/useConnectionStatusLabel.test.ts` → FAIL.

- [ ] **Step 2: реализация**

```ts
// src/core/hooks/useConnectionStatusLabel.ts
import { useEffect, useState } from 'react'

// tweb connectionStatus.ts:19 INITIAL_DELAY — статус не показывается
// в первые 2с после старта, чтобы не мигать на каждом холодном заходе.
const INITIAL_DELAY = 2000

export function useConnectionStatusLabel(loaded: boolean): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setElapsed(true), INITIAL_DELAY)
    return () => clearTimeout(t)
  }, [])
  return elapsed && !loaded
}
```

Run → PASS.

- [ ] **Step 3: Sidebar.tsx**

```tsx
const showUpdating = useConnectionStatusLabel(loaded)
// ...
placeholder={showUpdating ? t('Updating…') : t('Search')}
```

- [ ] **Step 4: typecheck + тесты**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(init): «Обновление…» в поиске не раньше 2с — tweb ConnectionStatus INITIAL_DELAY"
```

---

### Task 9: Финальная покадровая сверка со стендом

- [ ] **Step 1: сборка и прогон**

`npx vite build --outDir ../client-build`. Прогнать три сценария на https://localhost:38443 (DevTools, Slow 3G, скринкаст/Performance-запись):
1. **Первый заход** (очищены SW-кэши и IDB `msgr-store`, токен на месте): белый кадр → цвета темы (transition .2s) → обои fade .2s → `#main-columns` fade .3s (скелетон уже под ним) → волна стирания → fade-in аватарок.
2. **Повторный заход**: без скелетона, без прятанья по шрифтам, список из кэша в первом кадре.
3. **Экран логина**: `has-auth-pages` на body, обои/каркас не мелькают.

- [ ] **Step 2: DOM-сверка**

Сравнить дампом (как в `docs/research/2026-08-08-tweb-live-dom-reference.md` §1): body-классы `animation-level-2 rounded-sections is-left-column-shown has-horizontal-folders`; фон-слой первым потомком body; `#column-center > .chats-container > .chat.tabs-tab.active`; нет `#initial-loader`; при загрузке присутствует `canvas.dialogs-placeholder-canvas`.

- [ ] **Step 3: зафиксировать результат**

Обновить `docs/research/2026-08-09-init-sequence-comparison.md` (сверка из этой сессии) пометкой «после порта» с новыми кадрами; закоммитить.

```bash
git add -A && git commit -m "docs(init): покадровая сверка после порта инициализации"
```
