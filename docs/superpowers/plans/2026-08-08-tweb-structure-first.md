# tweb structure-first: перестройка вёрстки под классы tweb

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить view-слой web-client на **точное DOM-дерево и классы tweb**, портировав SCSS-партиалы tweb почти дословно, — после чего оставшиеся P0 по поведению ложатся на уже правильную структуру.

**Architecture:** Вариант А. Классы tweb (`.bubble`, `.bubbles-group`, `.chatlist-chat`, …) становятся **глобальными** — SCSS-партиалы tweb копируются в `web-client/src/styles/tweb/` практически без правок и подключаются в `index.scss`. React-компоненты рендерят эти классы строками через хелпер `classNames`. CSS-модули остаются у поверхностей, которые ещё не перестроены, и удаляются вместе с перестройкой каждой поверхности. Приёмка каждой поверхности — DOM-diff против живого референса, а не глазомер.

**Tech Stack:** React 19 + TS strict, SCSS (sass), Vite 8, vitest, playwright/chrome-devtools MCP для DOM-diff.

## Источники истины (в порядке приоритета)

1. **Живой DOM-референс:** `docs/research/2026-08-08-tweb-live-dom-reference.md` (+ сырьё `docs/research/tweb-dom/*.json`) — реальные деревья, классы, computed styles, тайминги.
2. **Исходники tweb:** `/Users/denisurevic/Documents/tweb/src` (commit e52b5d931). Проверено: `src/` соответствует живому дизайну — класс `rounded-sections` из `index.html` в SCSS не используется (мёртвый), топбар/композер-пилюли и радиусы из `src/scss` совпали с живыми замерами.
3. **Аудит:** `docs/research/2026-08-08-tweb-deep-structural-audit.md` — карта расхождений и список P0.

Расхождение между (1) и (2) всегда решается в пользу (1) — с пометкой в коде.

## Global Constraints

- Классы, порядок узлов и вложенность — **как в tweb**; отступление допускается только там, где механика React этого требует, и помечается комментарием `// отступление от tweb: <причина>`.
- SCSS-партиалы копируются **дословно**; правки допустимы только: (а) пути `@use`, (б) удаление правил, зависящих от непортированных подсистем — с комментарием, (в) значения из живого референса, если они разошлись с исходником.
- Правила для классов, которые мы пока не рендерим, **не вырезаем** — они не матчатся и стоят копейки, зато включатся сами, когда фича появится.
- Никакого нового framer-motion. Анимации — CSS-переходы/keyframes из tweb.
- Не рендерить пользовательский контент сырой HTML-строкой; DOM — React-нодами.
- Слой данных не трогаем: хуки (`core/hooks/*`), сторы, менеджеры остаются как есть. Меняется только рендер.
- После каждой задачи: `npm run typecheck && npm test -- --run && npx vite build` в `web-client/` — зелёное.
- Ветка `feat/tweb-structure-first` (от текущей `feat/p0-tweb-parity`). Коммит — на задачу.

## Покрытие P0 (35 из аудита)

| Фаза | Закрывает P0 |
|---|---|
| Фаза 2 (лента/баблы) | №2 (reply/имя/forward у всех типов), №3 (blockquote), №4 (mediaSizes), №5 (автоплей видео) |
| Фаза 3 (каркас чата) | №7 (padding под плейты), №8 (пин-бар), №9 (goto-кнопки), №10 (sticky-date), №11 (CommentsBar), №12 (переход между чатами) |
| Фаза 4 (чат-лист) | №13 (сториз-fold) |
| Фаза 5 (вьюер/сториз) | №21–27 |
| Фаза 6 (композер) | — (структурная база для №6) |
| Фаза 7 (логика) | №6 (музыка), №28–31 (анимационный фундамент) |
| Уже сделано (batch 1, ветка feat/p0-tweb-parity) | №1, №14–20, №32–35 |

---

## Фаза 0 — DOM-diff харнес

### Task 0.1: Сериализатор и differ

**Files:**
- Create: `web-client/scripts/domdiff/serialize.js` — функция-сериализатор, инжектится в страницу.
- Create: `web-client/scripts/domdiff/diff.js` — сравнение двух деревьев.
- Create: `web-client/scripts/domdiff/expected/` — эталоны, извлечённые из `docs/research/tweb-dom/*.json`.
- Create: `web-client/scripts/domdiff/README.md`.

**Interfaces:**
- Produces: `serializeTree(rootSelector, opts) => Node` где `Node = {tag, classes: string[], attrs?: Record<string,string>, computed?: Record<string,string>, children?: Node[]}`; `diffTrees(expected, actual, opts) => Finding[]` где `Finding = {path: string, kind: 'missing-class'|'extra-class'|'wrong-tag'|'missing-node'|'extra-node'|'computed', expected: string, actual: string}`.

- [x] **Step 1: Написать сериализатор**

```js
// scripts/domdiff/serialize.js
// Инжектится в страницу (evaluate). Возвращает дерево, пригодное для diff:
// теги + классы + порядок + выбранные computed-свойства.
export const SERIALIZE_FN = `(rootSelector, opts) => {
  const { maxDepth = 14, computedFor = [], props = [] } = opts || {};
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  const want = new Set(computedFor);
  const walk = (el, depth) => {
    if (!el || el.nodeType !== 1 || depth > maxDepth) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'path' || tag === 'defs' || tag === 'use') return null;
    const raw = typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '');
    const classes = raw.trim() ? raw.trim().split(/\\s+/).sort() : [];
    const node = { tag, classes };
    const attrs = {};
    for (const a of ['data-mid','data-peer-id','href','type','contenteditable']) {
      const v = el.getAttribute?.(a); if (v != null) attrs[a] = v;
    }
    if (Object.keys(attrs).length) node.attrs = attrs;
    if (want.size && classes.some(c => want.has(c))) {
      const cs = getComputedStyle(el); const out = {};
      for (const p of props) out[p] = cs.getPropertyValue(p);
      node.computed = out;
    }
    const kids = [...el.children].map(c => walk(c, depth + 1)).filter(Boolean);
    if (kids.length) node.children = kids;
    return node;
  };
  return walk(root, 0);
}`;
```

- [x] **Step 2: Написать differ**

```js
// scripts/domdiff/diff.js
export function diffTrees(expected, actual, opts = {}) {
  const { ignoreClasses = [], tolerance = {} } = opts;
  const findings = [];
  const skip = new Set(ignoreClasses);
  const walk = (e, a, path) => {
    if (!e && !a) return;
    if (!a) { findings.push({ path, kind: 'missing-node', expected: e.tag + '.' + e.classes.join('.'), actual: '' }); return; }
    if (!e) { findings.push({ path, kind: 'extra-node', expected: '', actual: a.tag + '.' + a.classes.join('.') }); return; }
    if (e.tag !== a.tag) findings.push({ path, kind: 'wrong-tag', expected: e.tag, actual: a.tag });
    const ec = e.classes.filter(c => !skip.has(c));
    const ac = a.classes.filter(c => !skip.has(c));
    for (const c of ec) if (!ac.includes(c)) findings.push({ path, kind: 'missing-class', expected: c, actual: ac.join(' ') });
    for (const c of ac) if (!ec.includes(c)) findings.push({ path, kind: 'extra-class', expected: ec.join(' '), actual: c });
    if (e.computed && a.computed) {
      for (const [p, v] of Object.entries(e.computed)) {
        const av = a.computed[p];
        const tol = tolerance[p] ?? 0;
        const num = (s) => parseFloat(String(s));
        const близко = tol && Number.isFinite(num(v)) && Number.isFinite(num(av)) && Math.abs(num(v) - num(av)) <= tol;
        if (av !== v && !близко) findings.push({ path, kind: 'computed', expected: `${p}: ${v}`, actual: `${p}: ${av}` });
      }
    }
    const ek = e.children ?? [], ak = a.children ?? [];
    const n = Math.max(ek.length, ak.length);
    for (let i = 0; i < n; i++) walk(ek[i], ak[i], `${path}>${(ek[i] ?? ak[i]).tag}[${i}]`);
  };
  walk(expected, actual, expected ? expected.tag : 'root');
  return findings;
}
```

- [x] **Step 3: Извлечь первый эталон из референса**

Из `docs/research/tweb-dom/03-bubbles-123.json` вынуть поддеревья баблов (текст in/out, voice, forward, big-emoji, фото-с-реакцией) в `scripts/domdiff/expected/bubbles.json` — привести к форме сериализатора (tag/classes/children, классы отсортированы).

- [x] **Step 4: README с процедурой сверки**

Описать: как снять актуальное дерево нашего стенда через chrome-devtools/playwright MCP (`evaluate` с `SERIALIZE_FN`), как прогнать `diffTrees`, как читать findings; список `ignoreClasses` (наши технические классы, у которых нет аналога в tweb) ведём в README и держим коротким — каждый пункт с обоснованием.

- [x] **Step 5: Прогнать на текущей ленте (baseline)**

Снять наше дерево ленты, сдиффить с `expected/bubbles.json`, сохранить отчёт `scripts/domdiff/baseline-bubbles.txt`. Это стартовая точка: в конце фазы 2 findings по структуре должны стать пустыми.

- [x] **Step 6: Проверки и стоп**

`npm run typecheck` (скрипты вне tsconfig — убедиться, что не ломают), `npm test -- --run`. Коммит не делаем — коммитит оркестратор.

---

## Фаза 1 — Инфраструктура глобального tweb-CSS

### Task 1.1: Каталог `styles/tweb/` и цепочка импорта

**Files:**
- Create: `web-client/src/styles/tweb/_index.scss` (агрегатор; пока пустой список).
- Modify: `web-client/src/styles/index.scss` (подключить агрегатор последним).
- Modify: `web-client/src/styles/_foundation.scss` (дополнить недостающими миксинами/константами tweb по мере надобности).
- Modify: `web-client/index.html` (добавить `rounded-sections animation-level-2` на `<body>` — как в tweb `index.html:41`; `animation-level-*` дальше будет переключать liteMode).

**Interfaces:**
- Produces: соглашение — каждый портированный партиал кладётся как `src/styles/tweb/_<имя>.scss` (имя = имя файла tweb), подключается через `@use` в `_index.scss` в том же порядке, что в tweb `style.scss`.

- [x] **Step 1: Проверить покрытие foundation**

Сверить `web-client/src/styles/_foundation.scss` c `tweb/src/scss/variables.scss` и `tweb/src/scss/mixins/*`: какие `$`-переменные и миксины (`respond-to`, `hover-effect`, `hover-background-effect`, `animation-level`, `splitColor`, `ellipsis` и др.) уже есть, каких нет. Недостающие — портировать дословно.

- [x] **Step 2: Создать агрегатор**

```scss
// src/styles/tweb/_index.scss
// Партиалы tweb, портированные дословно. Порядок — как в tweb src/scss/style.scss.
// Классы глобальные (вариант А программы parity): компоненты рендерят имена tweb.
// @use добавляется по мере перестройки поверхностей.
```

- [x] **Step 3: Подключить в index.scss**

`@use 'tweb';` последним (после токенов/шрифтов/глобалок), чтобы каскад tweb перекрывал наши legacy-глобалки.

- [x] **Step 4: Проверки**

`npx vite build` — CSS собирается, размер не вырос (партиалов пока нет). `npm test -- --run` зелёный.

---

## Фаза 2 — Лента и баблы (P0 №2–5)

Самая большая фаза. Порядок: сначала стили (они не ломают текущий рендер, т.к. классов tweb в DOM ещё нет), затем структура компонентов, затем удаление старых модулей.

### Task 2.1: Порт `_chatBubble.scss` + зависимостей

**Files:**
- Create: `web-client/src/styles/tweb/_chatVariables.scss` (из `tweb/src/scss/partials/_chatVariables.scss`).
- Create: `web-client/src/styles/tweb/_chatBubble.scss` (из `tweb/src/scss/partials/_chatBubble.scss`, 4236 строк).
- Create: `web-client/src/styles/tweb/_quote.scss`, `_markup.scss`, `_spoiler.scss`, `_reaction.scss`, `_reactions.scss`, `_document.scss`, `_audio.scss`, `_peerTyping.scss` (зависимости баблов).
- Modify: `web-client/src/styles/tweb/_index.scss`.

- [ ] **Step 1: Скопировать партиалы и починить импорты**

Копировать файлы 1:1, затем заменить только `@use`/`@import`-пути на наши (`../foundation` и т.п.). Никаких других правок на этом шаге.

- [ ] **Step 2: Собрать и вычистить недостающие зависимости**

`npx vite build` — sass покажет неизвестные переменные/миксины/функции. Каждую — либо портировать в `_foundation.scss`, либо (если тянет непортированную подсистему) удалить правило с комментарием `// не портировано: <что и почему>`. Итерировать до зелёной сборки.

- [ ] **Step 3: Сверить критичные значения с живым референсом**

По `docs/research/2026-08-08-tweb-live-dom-reference.md` §3/3b/3c проверить, что портированные значения дают живые: радиусы группы (`15px 5px 5px 15px` и пр.), `--max-width: 85%` + 30rem кап, стикер-бокс 200×200, floating-время (18px, font 12, padding 0 5px), тень бабла. Расхождение → правка в пользу живого + комментарий.

- [ ] **Step 4: Проверки**

`npx vite build` зелёный; замерить прирост CSS (`ls -la dist/assets/*.css`) и записать в отчёт. `npm test -- --run` зелёный.

### Task 2.2: Каркас ленты — `ChatFeed` на дерево tweb

**Files:**
- Modify: `web-client/src/components/messages/ChatFeed.tsx`
- Modify/Delete: `web-client/src/components/messages/ChatFeed.module.scss` (удалить правила, покрытые tweb-партиалом)

**Interfaces:**
- Produces: дерево `.bubbles > .bubbles-scrollable > .bubbles-inner > .bubbles-date-group > (.bubble.service.is-date | .bubbles-group)`; `.bubbles-group` содержит `.bubbles-group-avatar-container > .bubbles-group-avatar` и баблы; пропсы `MessageRow` не меняются.

- [ ] **Step 1: Снять эталон группы из референса**

Из `docs/research/tweb-dom/03-chat-overview.json` + `03-bubbles-123.json` выписать точное дерево обёрток (какие классы на каких уровнях, где `.bubbles-inner.is-chat`, где `with-message-avatars`).

- [ ] **Step 2: Переписать рендер обёрток**

Заменить `<section>/<header>/.group` на tweb-дерево с классами через `classNames` из `shared/lib/classNames`. Дата-разделитель — `.bubble.service.is-date > .bubble-content-wrapper > .bubble-content > .service-msg` (а не наша пилюля-кнопка; клик-обработчик сохранить на `.service-msg`).

- [ ] **Step 3: Аватар группы**

`.bubbles-group-avatar-container` (absolute, column-reverse) + `.bubbles-group-avatar` sticky — как `_chatBubble.scss:45-88`; убрать нашу колонку с хардкодом `bottom: 72px`.

- [ ] **Step 4: DOM-diff**

Прогнать харнес по обёрткам: findings уровня `.bubbles*`/`.bubbles-group*` пустые.

- [ ] **Step 5: Проверки**

typecheck / tests / build зелёные; визуально лента не разъехалась (скриншот стенда).

### Task 2.3: Бабл — единый каркас и универсальные части

**Files:**
- Modify: `web-client/src/components/messages/MessageRow.tsx`
- Modify: `web-client/src/components/messages/MessageContent.tsx`
- Modify: `web-client/src/components/messages/bubbleParts/primitives.tsx`, `Time.tsx`
- Delete: `web-client/src/components/messages/MessageRow.module.scss`, `MessageBubbles.module.scss` (после переноса всего, что покрыто tweb)

**Interfaces:**
- Produces: `.bubble` c набором модификаторов tweb (`is-in/is-out`, `is-group-first/last`, `can-have-tail`, `just-media`, `is-message-empty`, `sticker`, `emoji-big`, `photo`, `video`, `voice-message`, `audio-message`, `document-message`, `is-album`, `is-reply`, `forwarded`, `hide-name`, `service`, `is-first-unread`, `is-highlighted`, `is-selected`, `has-floating-time`, `with-reply-markup`, `channel-post`) вместо data-атрибутов; внутри — `.bubble-content-wrapper > .bubble-content` у **всех** типов.

- [ ] **Step 1: Функция модификаторов**

Создать чистую функцию `bubbleClasses(msg, ctx)` рядом с `MessageRow.tsx`, возвращающую массив классов tweb по состоянию сообщения. Правила брать из `tweb/src/components/chat/bubbles.ts` (места, где `bubble.classList.add(...)`) и из аудита §4.1. Покрыть юнит-тестом: для набора фикстур (входящее первое/последнее в группе, исходящее с медиа, стикер, сервисное) ожидаемые наборы классов.

- [ ] **Step 2: Переписать `MessageRow` на tweb-дерево**

`.bubble` (с модификаторами) → `.bubble-content-wrapper` → `.bubble-content`. Полосу highlight/selection перевести с нашего `.band` на `::after` из tweb (правила уже в партиале). Чекбокс выделения — `.bubble-select-checkbox`.

- [ ] **Step 3: Универсальные части внутри `.bubble-content`**

`nameContainer` (имя/`.bubble-name-forwarded`+аватар 20px/via/rank), `.reply` (по `_quote.scss`), `.message`, `.attachment`, `svg.bubble-tail` — вставляются одинаково для **любого** типа (это и есть P0 №2). Для `just-media` — floating-плашка `.name-with-reply` поверх медиа (`_chatBubble.scss:1059-1125`).

- [ ] **Step 4: Время**

`Time.tsx` уже близок к tweb (`span.time > .time-inner`) — перевести на глобальные классы, удалить `Time.module.scss`, убрать наш `forwards`-счётчик (в tweb его в строке времени нет), прокинуть `title` (полная дата).

- [ ] **Step 5: DOM-diff по баблам**

Сравнить наше дерево с `expected/bubbles.json` для всех снятых типов. Цель: findings уровня структуры/классов = 0 (кроме задекларированных в `ignoreClasses`).

- [ ] **Step 6: Проверки**

typecheck / tests (юнит на `bubbleClasses` зелёный) / build; скриншот-сверка со скриншотами tweb из `docs/research/tweb-dom/`.

### Task 2.4: Rich-text — blockquote, pre, spoiler, monospace (P0 №3)

**Files:**
- Modify: `web-client/src/components/RichText.tsx`
- Modify/Delete: `web-client/src/components/RichText.module.scss`
- Modify: `web-client/src/components/CodeBlock.tsx` (+ удалить его модуль, перейдя на tweb-классы `.code`, `.code-header`, `.code-code`)

- [ ] **Step 1: Blockquote на tweb-разметку**

`.quote.quote-block.quote-like.quote-like-border.quote-like-icon` + иконка цитаты + коллапс до 3 строк с экспандером (`_quote.scss:57-106`). Peer-цвет — через переменную `--peer-color-rgb` на бабле (см. Task 2.6).

- [ ] **Step 2: pre → `.code`**

Структура из `base.scss:1979-2041`: контейнер `.quote-like.quote-like-border.code` + `.code-header` (язык bold + круглая кнопка копирования) + `.code-code`. Prism-подсветку сохранить, лимиты длины не трогать.

- [ ] **Step 3: inline code и spoiler**

`.monospace-text` — без фона, акцентный цвет, клик = копировать. Spoiler — `_spoiler.scss` (фон-плашка + `opacity:0` текста + reveal-переход), вместо нашего blur.

- [ ] **Step 4: Ссылки**

`.anchor-url` с постоянным underline внутри бабла (`_chatBubble.scss:1970-1972`).

- [ ] **Step 5: Проверки**

`RichText.security.test.ts` и `richtext.bigemoji.test.ts` зелёные (поведение по безопасности не меняем); typecheck/build.

### Task 2.5: Медиа — размеры и структура (P0 №4, №5)

**Files:**
- Create: `web-client/src/core/dom/mediaSizes.ts`
- Modify: `web-client/src/components/messages/RealMediaBubble.tsx`, `AlbumGrid.tsx`, `SecretMediaBubble.tsx`, `bubbleParts/mediaBubbles.tsx`
- Delete: `RealMediaBubble.module.scss`, `AlbumGrid.module.scss` (правила покрыты `_chatBubble.scss`)

- [ ] **Step 1: `mediaSizes` + `setAttachmentSize`**

Порт `tweb/src/helpers/mediaSizes.ts:64-101` (regular 420×400 desktop / 340×340 ≤600px; album 420/340; sticker 200/180; emojiSticker 112; round 280/240) и `setAttachmentSize.ts:64-94` (мин-сторона 200 через aspectCovered; расширение до 320 при тексте/reply; мин 120 / видео 368). Юнит-тест на несколько соотношений с ожидаемыми размерами.

- [ ] **Step 2: Структура `.attachment`**

`.attachment.media-container[.media-container-fitted]` + `img.media-photo.thumbnail` (blur-подложка) + `.media-container-aspecter` — как `wrappers/photo.ts:134-203`. Наш shimmer убрать (в tweb его нет), fade-in полного изображения — как tweb.

- [ ] **Step 3: Альбом**

`.album-item.grouped-item` + `.album-item-media`; `maxWidth` 420/340, `spacing: 1`; углы per-item `calc(var(--border-*-radius) - spacing)` (`prepareAlbum.ts:43-57`). Алгоритм раскладки уже портирован — не трогать.

- [ ] **Step 4: Инлайн-автоплей видео (P0 №5)**

`<video muted loop autoplay playsInline>` для видео ≤ 50 МБ (`video.ts:50`), иконка `nosound` в `.video-time`, остаток времени на timeupdate, play-кнопка только когда автоплей недоступен. Живой референс §3c: в личке у нас будет play-кнопка при `is-sending`/крупном файле — сверить оба состояния.

- [ ] **Step 5: `.video-time` единым компонентом**

top 3px/left 3px, height `calc(var(--messages-time-text-size) + .375rem)`, padding 0 6px, radius = высоте, фон `--message-time-background` — один компонент для одиночного медиа и альбома.

- [ ] **Step 6: DOM-diff + проверки**

Сравнить с эталонами фото/альбома/видео/стикера/документа из референса; `RealMediaBubble.upload.test.tsx` зелёный; typecheck/build.

### Task 2.6: Peer-color и группировка

**Files:**
- Modify: `web-client/src/components/messages/MessageRow.tsx`, `web-client/src/components/peerColor.ts`
- Create: `web-client/src/styles/tweb/_peerColors.scss` (если нужны CSS-переменные палитры)

- [ ] **Step 1: Палитра как в tweb**

`getPeerColorById` — палитра `['#CC5049','#D67722','#955CDB','#40A920','#309EBA','#368AD1','#C7508B']`, индекс по `abs(peerId) % 7` (а не по хешу имени).

- [ ] **Step 2: Переменные на бабле**

На `.bubble` ставить `--peer-color-rgb` (и `--peer-border-background` для градиентных случаев) — от них уже питаются `.name`, `.reply`, `.quote`, `.monospace-text` в портированных партиалах.

- [ ] **Step 3: Проверки**

Юнит на индекс цвета; typecheck/build; DOM-diff (inline-style с переменной допустим — добавить в `ignoreClasses`/исключения差 по атрибуту `style`).

### Task 2.7: Зачистка фазы 2

- [ ] **Step 1: Удалить мёртвые модули**

Убедиться, что `MessageRow.module.scss`, `MessageBubbles.module.scss`, `RealMediaBubble.module.scss`, `AlbumGrid.module.scss`, `Time.module.scss`, `RichText.module.scss` больше не импортируются, и удалить. `grep` по проекту — ни одного импорта.

- [ ] **Step 2: Финальный DOM-diff ленты**

Полный отчёт по всем снятым типам баблов: структура — 0 findings; computed — расхождения только в задекларированном списке допусков.

- [ ] **Step 3: Проверки + коммит-точка**

typecheck / tests / build; скриншоты «до/после» в отчёт.

---

## Фаза 3 — Каркас чата (P0 №7–12)

### Task 3.1: Порт `_chat.scss` (без секции chat-input), `_chatTopbar.scss`, `_chatPinned.scss`

**Files:** Create `web-client/src/styles/tweb/_chat.scss`, `_chatTopbar.scss`, `_chatPinned.scss`; Modify `_index.scss`.

- [ ] **Step 1:** Скопировать, починить импорты, добиться сборки (та же процедура, что в Task 2.1).
- [ ] **Step 2:** Сверить с живым референсом §1/§3: топбар-пилюля 696×48 radius 24, `topbar-floating-plates` (щель 1px), `--chat-width: 696px`, маска фейдов.
- [ ] **Step 3:** Проверки: build зелёный, прирост CSS зафиксирован.

### Task 3.2: `ConversationView` — каркас и плейты (P0 №7)

**Files:** Modify `ConversationView.tsx`, удалить покрытое из `ConversationView.module.scss`.

- [ ] **Step 1:** Дерево `.chat > .sidebar-header.topbar + .bubbles + .chat-input` с `--chat-padding-top/bottom`, где `padding-top` включает `--pinned-floating-height` (сумму высот плейтов) — это и есть фикс P0 №7.
- [ ] **Step 2:** Стек `topbar-floating-plates` — контейнер для пин-бара/плеера/баннеров вместо отдельных плашек с ручным `top`.
- [ ] **Step 3:** Маска скролла: верхняя точка растёт вместе с плейтами (`--bubbles-scrollable-fade-top-add`).
- [ ] **Step 4:** DOM-diff каркаса + проверки.

### Task 3.3: Пин-бар (P0 №8)

**Files:** Modify `conversation/PinnedBar.tsx`, `usePinnedBar.ts`; удалить `PinnedBar.module.scss`.

- [ ] **Step 1:** Разметка `.pinned-container.pinned-message` из живого референса (§3, «пин»): `pinned-message-border-wrapper-1`/сегменты, `.pinned-container-title` 500/14 primary, `animated-counter`.
- [ ] **Step 2:** Скролл-трекинг показываемого пина (`pinnedMessage.tsx:529-589`), throttle 100ms.
- [ ] **Step 3:** Анимация смены — CSS-компонент по образцу `animated-super` (translateY ±20px, .2s ease-in-out), без framer.
- [ ] **Step 4:** Медиа-превью 40×40 при `is-media`; кнопка-меню слева (pinlist/unpin).
- [ ] **Step 5:** DOM-diff + проверки.

### Task 3.4: Corner-кнопки и sticky-date (P0 №9, №10)

**Files:** Modify `conversation/ScrollDownFab.tsx` (→ `bubbles-corner-button` семейство), `ChatFeed.tsx`.

- [ ] **Step 1:** `.bubbles-go-down` на классах tweb (54px, badge-24, появление только opacity/visibility `--layer-transition`).
- [ ] **Step 2:** `.bubbles-go-mention` c badge — показ при непрочитанных упоминаниях, клик = прыжок; источник данных — тот же, что у mention-бейджа чат-листа.
- [ ] **Step 3:** Sticky-date: класс `is-scrolling` на `.bubbles-inner` при скролле (снимается по debounce ~300ms); прилипшая дата без него — `opacity ~0`, transition `.3s ease`.
- [ ] **Step 4:** DOM-diff + проверки.

### Task 3.5: CommentsBar и переход между чатами (P0 №11, №12)

**Files:** Modify `CommentsBar.tsx` (+ бэкенд, если нет recent-авторов треда), `App.tsx`.

- [ ] **Step 1:** `.replies-footer` на классах tweb; аватары — реальные (при отсутствии на бэке добавить `recent_repliers` в DTO треда по образцу `ReactionsFor`).
- [ ] **Step 2:** Переход между чатами: `.chat.tabs-tab` — вход `translate3d(±200px)→0` + fade `.2s ease-in-out`, вместо ремаунта по key.
- [ ] **Step 3:** Проверки (фронт + `go build ./... && go vet ./...` при правке бэка).

---

## Фаза 4 — Чат-лист (P0 №13)

### Task 4.1: Порт `_chatlist.scss`, `_row.scss`, `_leftSidebar.scss`, `_badge.scss`, `_avatar.scss`

**Files:** Create соответствующие файлы в `styles/tweb/`; Modify `_index.scss`.

- [ ] **Step 1:** Копирование + починка импортов + сборка.
- [ ] **Step 2:** Сверка с живым референсом §2 (строка 72px, порядок узлов, пилюли-табы папок).
- [ ] **Step 3:** Проверки.

### Task 4.2: `ChatListItem` на дерево tweb

**Files:** Modify `ChatListItem.tsx`, `ChatList.tsx`, `ArchiveRow.tsx`; удалить их модули.

- [ ] **Step 1:** Дерево `a.row.chatlist-chat.chatlist-chat-bigger > .avatar.dialog-avatar + .row-row.row-title-row + .row-row.row-subtitle-row` — **включая порядок узлов из живого DOM** (референс §2: subtitle→title→avatar в исходном порядке, визуальный порядок задаёт CSS).
- [ ] **Step 2:** Иконка mute — в титуле сразу после имени; галочки статуса 20px с `--chatlist-status-color`.
- [ ] **Step 3:** Бейджи: `dialog-subtitle-badge` с CSS-order (reaction 1 → mention 2 → unread 3 → pinned 4), scale-анимация появления через `--chatlist-badge-transition-*`.
- [ ] **Step 4:** DOM-diff строки + проверки.

### Task 4.3: Сториз-fold (P0 №13)

**Files:** Modify `StoriesRow.tsx`, `Sidebar.tsx`, `ChatList.tsx`.

- [ ] **Step 1:** Порт механики `stories/list.tsx:124-243`: progress от scrollTop, высота контейнера `92*(1-p)`, `translateY(p*-69px)`, полёт аватарок в слот поиска, стек до 3, `--stories-scrolled` поднимает список.
- [ ] **Step 2:** Удалить мёртвый `StoriesStack`, если не переиспользуется.
- [ ] **Step 3:** Проверки + живой смок (скролл вниз/вверх).

---

## Фаза 5 — Медиавьюер и сториз (P0 №21–27)

> Особенность: в tweb сториз-вьюер написан на **CSS-модулях** (`viewer.module.scss`, классы вида `_Viewer_hvblb_1`) — дословный перенос имён невозможен и не нужен. Для сториз сохраняем свои модули, но повторяем **структуру и значения**; DOM-diff по сториз сравнивает только теги/вложенность/computed, без имён классов.

### Task 5.1: Медиавьюер — caption и слайд листания (P0 №21, №22)

**Files:** Modify `messages/MediaLightbox.tsx` + модуль.

- [ ] **Step 1:** `.media-viewer-caption` — центр снизу, scrollable, max-height 6rem/max-width 50rem, opacity .4→1 hover; рендер подписи через `RichText`.
- [ ] **Step 2:** Листание: уходящий mover уезжает за экран 350ms ease (`moveTheMover`), новый въезжает; кольцевое листание убрать — на краях кнопка скрывается.
- [ ] **Step 3:** DOM-diff (референс §9) + проверки.

### Task 5.2: Видеоплеер — большая play-кнопка (P0 №23)

**Files:** Modify `messages/VideoControls.tsx` + модуль.

- [ ] **Step 1:** `.default__button--big` 4rem по центру, скрыта в `is-playing/is-seeking/is-buffering`.
- [ ] **Step 2:** Слайд панели контролов `translate3d(0,52px,0)→0` (вместо opacity+translateY), автоскрытие 3000ms, `cursor: none`.
- [ ] **Step 3:** Проверки.

### Task 5.3: Сториз-вьюер (P0 №24–27)

**Files:** Modify `StoryViewer.tsx` + модуль, `useStoryViewer.ts`.

**Референс:** живой DOM §7b (карусель `_ViewerStoryContainer` с `--translateX`, прогресс через `--progress`, хедер, chat-input «Reply Privately…») + `tweb/src/components/stories/viewer.tsx`.

- [ ] **Step 1:** Карусель соседних авторов: `--scale: .33`, `--translateX` по формуле (MARGIN 40), затемнение соседей, клик по соседу переключает.
- [ ] **Step 2:** Переход между авторами: слайд карусели (desktop) / куб `rotateY(±90deg)` при `isFull`.
- [ ] **Step 3:** Открытие из аватарки: WAAPI 250ms `cubic-bezier(.4,0,.6,1)` — клон аватарки летит в шапку, контейнер морфит из rect с `borderRadius 50%→0`; реверс на закрытие.
- [ ] **Step 4:** Прогресс: для видео длительность = длительность ролика (JS-тикер вместо CSS 5s), звук включён, кнопки play/pause и mute в хедере.
- [ ] **Step 5:** DOM-diff (структура/computed) + проверки.

---

## Фаза 6 — Композер

### Task 6.1: Порт секции `chat-input` и хелперов

**Files:** Create `styles/tweb/_chatInput.scss` (секция из `_chat.scss`, если не вошла в Task 3.1), `_autocompleteHelper.scss`, `_autocompletePeerHelper.scss`, `_chatEmojiHelper.scss`, `_chatStickersHelper.scss`, `_chatInlineHelper.scss`, `_chatBotCommands.scss`, `_chatMarkupTooltip.scss`, `_emojiDropdown.scss`, `_voiceRecordingPanel.scss`, `_chatDrop.scss`.

- [ ] **Step 1:** Копирование + импорты + сборка. **Step 2:** Сверка с референсом §4. **Step 3:** Проверки.

### Task 6.2: `Composer` на дерево tweb

**Files:** Modify `Composer.tsx`, `components/composer/*`; удалить `Composer.module.scss`.

- [ ] **Step 1:** Дерево `.chat-input > .chat-input-container > .rows-wrapper > (.reply-wrapper | .new-message-wrapper)`; одна переиспользуемая reply/edit/forward-плашка (height 0→3rem).
- [ ] **Step 2:** Порядок кнопок как в tweb (scheduled/TTL справа от инпута), `.btn-send-container` с 6 иконками и морфом `grow-icon`/`hide-icon` .4s (референс §4 подтверждает 400ms).
- [ ] **Step 3:** Voice-панель как overlay (absolute поверх строки), порядок: dot/play → волна → таймер справа.
- [ ] **Step 4:** Плейсхолдер отдельным элементом с fade+translateX .15s; drop-зона `_chatDrop.scss`.
- [ ] **Step 5:** DOM-diff + `Composer.hotkeys.test.tsx` зелёный + проверки.

---

## Фаза 7 — Логика и поведение

### Task 7.1: Анимационный фундамент (P0 №28–31)

**Files:** Modify `components/animationIntersector.ts`; Create `core/dom/heavyAnimation.ts`; Modify `styles/index.scss`, `motion.ts`.

- [ ] **Step 1:** Порт `animationIntersector` (единый IO, группы, `onlyOnePlayableGroup`, lock/unlock, пауза по visibilitychange); подключить lottie/video-стикеры и custom-emoji.
- [ ] **Step 2:** `heavyAnimation` (dispatch/on/off/isInProgress) + вызовы в переходах, скролле к сообщению, смене темы; интерсектор глушит анимации на время.
- [ ] **Step 3:** `animation-level`: переключать `body.animation-level-0/2` из настройки reduceMotion (как tweb `appImManager.ts:2209-2211`) — портированные партиалы уже содержат `@include animation-level(2)`, поэтому гейт заработает сам; плюс страховочное правило для не-tweb стилей.
- [ ] **Step 4:** navigation-переход с параллаксом (−25% + brightness 80%) для стека экранов.
- [ ] **Step 5:** Проверки + смок.

### Task 7.2: Музыкальный бабл (P0 №6)

**Files:** Modify `bubbleParts/mediaBubbles.tsx`; Create `shared/ui/MediaProgressLine/*`.

- [ ] **Step 1:** `audio-element.audio.audio-48` по живому референсу §3 «аудио-трек»: toggle 48×48 с clip-path play-иконкой, `audio-details` (title middle-ellipsis + subtitle с `audio-time` и `progress-line[--progress]`).
- [ ] **Step 2:** Воспроизведение через `mediaPlaybackController` (отдельная очередь музыки), прогресс-линия с drag-scrub.
- [ ] **Step 3:** Проверки.

### Task 7.3: Остаточные поведенческие хвосты

- [ ] **Step 1:** rAF-прогресс для voice-волны и кольца кружка (вместо 4 Гц timeupdate).
- [ ] **Step 2:** Общая очередь voice+round, per-type playbackRate с персистом.
- [ ] **Step 3:** Проверки.

---

## Порядок и приёмка

1. Фазы идут **последовательно** (2 → 3 → 4 → 5 → 6 → 7); внутри фазы задачи по стилям параллелятся с харнесом, задачи по структуре — строго по очереди (общие файлы).
2. Каждая задача завершается: `typecheck` + `tests` + `build` + **DOM-diff по своей поверхности**.
3. Каждая фаза завершается verify-проходом: независимый агент сверяет результат с живым референсом и исходниками tweb и чинит расхождения (процедура себя оправдала на batch 1 — нашла 10+ расхождений в одной волне).
4. Старый план `docs/superpowers/plans/2026-08-08-p0-tweb-parity.md` — **отменён** в части batch 2/3; его batch 1 уже влит в `feat/p0-tweb-parity`.

## Риски и как их держим

| Риск | Митигация |
|---|---|
| Глобальные классы tweb конфликтуют с нашими глобалками | Наших глобальных классов мало (`.tgico`, prism `.token.*`, `.main-screen-*`, `.chatlist-exit*`) — пересечений с tweb нет; проверять `grep` при каждом новом партиале |
| Рост CSS-бандла | База на старте фазы 2: `dist/assets/index-*.css` = **184 632 Б**. Замерять после каждого партиала; целевой ориентир — не более +150 КБ несжатого суммарно (tweb-партиалы ленты+чата+листа); при превышении — резать только заведомо мёртвые подсистемы с комментарием |
| Промежуточные состояния «наполовину tweb, наполовину модули» | Переход поверхности делается одной задачей и заканчивается удалением её модуля; частично перестроенных поверхностей между коммитами не остаётся |
| Регресс поведения при переписывании view | Слой данных не трогаем; существующие тесты (746) — страховка; после каждой фазы — живой смок стенда |
