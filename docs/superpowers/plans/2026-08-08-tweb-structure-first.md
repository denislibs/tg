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

- [x] **Step 1: Скопировать партиалы и починить импорты**

Копировать файлы 1:1, затем заменить только `@use`/`@import`-пути на наши (`../foundation` и т.п.). Никаких других правок на этом шаге.

- [x] **Step 2: Собрать и вычистить недостающие зависимости**

`npx vite build` — sass покажет неизвестные переменные/миксины/функции. Каждую — либо портировать в `_foundation.scss`, либо (если тянет непортированную подсистему) удалить правило с комментарием `// не портировано: <что и почему>`. Итерировать до зелёной сборки.

- [x] **Step 3: Сверить критичные значения с живым референсом**

По `docs/research/2026-08-08-tweb-live-dom-reference.md` §3/3b/3c проверить, что портированные значения дают живые: радиусы группы (`15px 5px 5px 15px` и пр.), `--max-width: 85%` + 30rem кап, стикер-бокс 200×200, floating-время (18px, font 12, padding 0 5px), тень бабла. Расхождение → правка в пользу живого + комментарий.

- [x] **Step 4: Проверки**

`npx vite build` зелёный; замерить прирост CSS (`ls -la dist/assets/*.css`) и записать в отчёт. `npm test -- --run` зелёный.

### Task 2.2: Каркас ленты — `ChatFeed` на дерево tweb

**Files:**
- Modify: `web-client/src/components/messages/ChatFeed.tsx`
- Modify/Delete: `web-client/src/components/messages/ChatFeed.module.scss` (удалить правила, покрытые tweb-партиалом)

**Interfaces:**
- Produces: дерево `.bubbles > .bubbles-scrollable > .bubbles-inner > .bubbles-date-group > (.bubble.service.is-date | .bubbles-group)`; `.bubbles-group` содержит `.bubbles-group-avatar-container > .bubbles-group-avatar` и баблы; пропсы `MessageRow` не меняются.

- [x] **Step 1: Снять эталон группы из референса**

Из `docs/research/tweb-dom/03-chat-overview.json` + `03-bubbles-123.json` выписать точное дерево обёрток (какие классы на каких уровнях, где `.bubbles-inner.is-chat`, где `with-message-avatars`).

- [x] **Step 2: Переписать рендер обёрток**

Заменить `<section>/<header>/.group` на tweb-дерево с классами через `classNames` из `shared/lib/classNames`. Дата-разделитель — `.bubble.service.is-date > .bubble-content-wrapper > .bubble-content > .service-msg` (а не наша пилюля-кнопка; клик-обработчик сохранить на `.service-msg`).

- [x] **Step 3: Аватар группы**

`.bubbles-group-avatar-container` (absolute, column-reverse) + `.bubbles-group-avatar` sticky — как `_chatBubble.scss:45-88`; убрать нашу колонку с хардкодом `bottom: 72px`.

- [x] **Step 4: DOM-diff**

Прогнать харнес по обёрткам: findings уровня `.bubbles*`/`.bubbles-group*` пустые.

- [x] **Step 5: Проверки**

typecheck / tests / build зелёные; визуально лента не разъехалась (скриншот стенда).

### Task 2.3: Бабл — единый каркас и универсальные части

**Files:**
- Modify: `web-client/src/components/messages/MessageRow.tsx`
- Modify: `web-client/src/components/messages/MessageContent.tsx`
- Modify: `web-client/src/components/messages/bubbleParts/primitives.tsx`, `Time.tsx`
- Delete: `web-client/src/components/messages/MessageRow.module.scss`, `MessageBubbles.module.scss` (после переноса всего, что покрыто tweb)

**Interfaces:**
- Produces: `.bubble` c набором модификаторов tweb (`is-in/is-out`, `is-group-first/last`, `can-have-tail`, `just-media`, `is-message-empty`, `sticker`, `emoji-big`, `photo`, `video`, `voice-message`, `audio-message`, `document-message`, `is-album`, `is-reply`, `forwarded`, `hide-name`, `service`, `is-first-unread`, `is-highlighted`, `is-selected`, `has-floating-time`, `with-reply-markup`, `channel-post`) вместо data-атрибутов; внутри — `.bubble-content-wrapper > .bubble-content` у **всех** типов.

- [x] **Step 1: Функция модификаторов**

Создать чистую функцию `bubbleClasses(msg, ctx)` рядом с `MessageRow.tsx`, возвращающую массив классов tweb по состоянию сообщения. Правила брать из `tweb/src/components/chat/bubbles.ts` (места, где `bubble.classList.add(...)`) и из аудита §4.1. Покрыть юнит-тестом: для набора фикстур (входящее первое/последнее в группе, исходящее с медиа, стикер, сервисное) ожидаемые наборы классов.

- [x] **Step 2: Переписать `MessageRow` на tweb-дерево**

`.bubble` (с модификаторами) → `.bubble-content-wrapper` → `.bubble-content`. Полосу highlight/selection перевести с нашего `.band` на `::after` из tweb (правила уже в партиале). Чекбокс выделения — `.bubble-select-checkbox`.

- [x] **Step 3: Универсальные части внутри `.bubble-content`**

`nameContainer` (имя/`.bubble-name-forwarded`+аватар 20px/via/rank), `.reply` (по `_quote.scss`), `.message`, `.attachment`, `svg.bubble-tail` — вставляются одинаково для **любого** типа (это и есть P0 №2). Для `just-media` — floating-плашка `.name-with-reply` поверх медиа (`_chatBubble.scss:1059-1125`).

- [x] **Step 4: Время**

`Time.tsx` уже близок к tweb (`span.time > .time-inner`) — перевести на глобальные классы, удалить `Time.module.scss`, убрать наш `forwards`-счётчик (в tweb его в строке времени нет), прокинуть `title` (полная дата).

- [x] **Step 5: DOM-diff по баблам**

Сравнить наше дерево с `expected/bubbles.json` для всех снятых типов. Цель: findings уровня структуры/классов = 0 (кроме задекларированных в `ignoreClasses`).

- [x] **Step 6: Проверки**

typecheck / tests (юнит на `bubbleClasses` зелёный) / build; скриншот-сверка со скриншотами tweb из `docs/research/tweb-dom/`.

### Task 2.4: Rich-text — blockquote, pre, spoiler, monospace (P0 №3)

**Files:**
- Modify: `web-client/src/components/RichText.tsx`
- Modify/Delete: `web-client/src/components/RichText.module.scss`
- Modify: `web-client/src/components/CodeBlock.tsx` (+ удалить его модуль, перейдя на tweb-классы `.code`, `.code-header`, `.code-code`)

- [x] **Step 1: Blockquote на tweb-разметку**

`.quote.quote-block.quote-like.quote-like-border.quote-like-icon` + иконка цитаты + коллапс до 3 строк с экспандером (`_quote.scss:57-106`). Peer-цвет — через переменную `--peer-color-rgb` на бабле (см. Task 2.6).

- [x] **Step 2: pre → `.code`**

Структура из `base.scss:1979-2041`: контейнер `.quote-like.quote-like-border.code` + `.code-header` (язык bold + круглая кнопка копирования) + `.code-code`. Prism-подсветку сохранить, лимиты длины не трогать.

- [x] **Step 3: inline code и spoiler**

`.monospace-text` — без фона, акцентный цвет, клик = копировать. Spoiler — `_spoiler.scss` (фон-плашка + `opacity:0` текста + reveal-переход), вместо нашего blur.

- [x] **Step 4: Ссылки**

`.anchor-url` с постоянным underline внутри бабла (`_chatBubble.scss:1970-1972`).

- [x] **Step 5: Проверки**

`RichText.security.test.ts` и `richtext.bigemoji.test.ts` зелёные (поведение по безопасности не меняем); typecheck/build.

### Task 2.5: Медиа — размеры и структура (P0 №4, №5)

**Files:**
- Create: `web-client/src/core/dom/mediaSizes.ts`
- Modify: `web-client/src/components/messages/RealMediaBubble.tsx`, `AlbumGrid.tsx`, `SecretMediaBubble.tsx`, `bubbleParts/mediaBubbles.tsx`
- Delete: `RealMediaBubble.module.scss`, `AlbumGrid.module.scss` (правила покрыты `_chatBubble.scss`)

- [x] **Step 1: `mediaSizes` + `setAttachmentSize`**

Порт `tweb/src/helpers/mediaSizes.ts:64-101` (regular 420×400 desktop / 340×340 ≤600px; album 420/340; sticker 200/180; emojiSticker 112; round 280/240) и `setAttachmentSize.ts:64-94` (мин-сторона 200 через aspectCovered; расширение до 320 при тексте/reply; мин 120 / видео 368). Юнит-тест на несколько соотношений с ожидаемыми размерами.

- [x] **Step 2: Структура `.attachment`**

`.attachment.media-container[.media-container-fitted]` + `img.media-photo.thumbnail` (blur-подложка) + `.media-container-aspecter` — как `wrappers/photo.ts:134-203`. Наш shimmer убрать (в tweb его нет), fade-in полного изображения — как tweb.

- [x] **Step 3: Альбом**

`.album-item.grouped-item` + `.album-item-media`; `maxWidth` 420/340, `spacing: 1`; углы per-item `calc(var(--border-*-radius) - spacing)` (`prepareAlbum.ts:43-57`). Алгоритм раскладки уже портирован — не трогать.

- [x] **Step 4: Инлайн-автоплей видео (P0 №5)**

`<video muted loop autoplay playsInline>` для видео ≤ 50 МБ (`video.ts:50`), иконка `nosound` в `.video-time`, остаток времени на timeupdate, play-кнопка только когда автоплей недоступен. Живой референс §3c: в личке у нас будет play-кнопка при `is-sending`/крупном файле — сверить оба состояния.

- [x] **Step 5: `.video-time` единым компонентом**

top 3px/left 3px, height `calc(var(--messages-time-text-size) + .375rem)`, padding 0 6px, radius = высоте, фон `--message-time-background` — один компонент для одиночного медиа и альбома.

- [x] **Step 6: DOM-diff + проверки**

Сравнить с эталонами фото/альбома/видео/стикера/документа из референса; `RealMediaBubble.upload.test.tsx` зелёный; typecheck/build.

### Task 2.6: Peer-color и группировка

**Files:**
- Modify: `web-client/src/components/messages/MessageRow.tsx`, `web-client/src/components/peerColor.ts`
- Create: `web-client/src/styles/tweb/_peerColors.scss` (если нужны CSS-переменные палитры)

- [x] **Step 1: Палитра как в tweb**

`getPeerColorById` — палитра `['#CC5049','#D67722','#955CDB','#40A920','#309EBA','#368AD1','#C7508B']`, индекс по `abs(peerId) % 7` (а не по хешу имени).

- [x] **Step 2: Переменные на бабле**

На `.bubble` ставить `--peer-color-rgb` (и `--peer-border-background` для градиентных случаев) — от них уже питаются `.name`, `.reply`, `.quote`, `.monospace-text` в портированных партиалах.

- [x] **Step 3: Проверки**

Юнит на индекс цвета; typecheck/build; DOM-diff (inline-style с переменной допустим — добавить в `ignoreClasses`/исключения差 по атрибуту `style`).

### Task 2.7: Зачистка фазы 2

- [x] **Step 1: Удалить мёртвые модули**

Убедиться, что `MessageRow.module.scss`, `MessageBubbles.module.scss`, `RealMediaBubble.module.scss`, `AlbumGrid.module.scss`, `Time.module.scss`, `RichText.module.scss` больше не импортируются, и удалить. `grep` по проекту — ни одного импорта.

- [x] **Step 2: Финальный DOM-diff ленты**

Полный отчёт по всем снятым типам баблов: структура — 0 findings; computed — расхождения только в задекларированном списке допусков.

- [x] **Step 3: Проверки + коммит-точка**

typecheck / tests / build; скриншоты «до/после» в отчёт.

---

## Фаза 3 — Каркас чата (P0 №7–12)

### Task 3.0: Колоночный каркас оболочки (ПРЕДУСЛОВИЕ, найдено при попытке 3.1)

**Почему:** пробный порт `_chat.scss` показал, что партиал не самодостаточен. `.bubbles`
позиционируется **абсолютом относительно колоночной системы tweb**:
`inset-inline: calc(var(--page-chats-padding) * -1)`, а внутри `#column-center` —
через `--folders-sidebar-offset`, `--left-column-width`, `--right-column-width` и
`body.is-right-column-shown:not(.right-column-floats)`; `.bubbles-inner` считает
`max-width: calc(var(--chat-width) - var(--chat-bubbles-padding) * 2)`, где
`--chat-width` пишет `helpers/updateColumnWidths.ts`. У нас оболочка — flex-ряд
(сайдбар + колонка), этих переменных и узла `#column-center` нет, поэтому
подключение партиала выносит ленту из раскладки (проверено на стенде: лента
уехала под сайдбар). Партиал верный — не хватает подсистемы, на которую он опирается.

Проба откачена, ветка оставлена в зелёном состоянии фазы 2.

**Files:**
- Create: `web-client/src/core/dom/updateColumnWidths.ts` (порт `tweb/src/helpers/updateColumnWidths.ts`).
- Modify: `web-client/src/App.tsx` — скелет `#column-left` / `#column-center` / `#column-right` внутри `.tabs-container`, как в живом DOM §1.
- Modify: `web-client/src/components/Chat.tsx`, `Sidebar.tsx` — переезд на этот скелет.
- Modify: `web-client/src/styles/index.scss` — убрать наши layout-переменные колонок, оставив те, что пишет порт.

- [x] **Step 1:** Снять с живого tweb значения `--chat-width`, `--left-column-width`, `--right-column-width`, `--page-chats-padding`, `--folders-sidebar-offset` в трёх режимах (узкий / обычный / открытая правая колонка) — эталон для порта.
- [x] **Step 2:** Портировать `updateColumnWidths.ts` дословно; классы состояния (`body.is-right-column-shown`, `body.right-column-floats`, `body.is-left-column-shown`) ставить там же, где tweb.
- [x] **Step 3:** Перевести оболочку на скелет колонок; проверить три режима по DOM-diff обёрток.
- [x] **Step 4:** Только после этого — Task 3.1 (партиалы `_chat`/`_chatTopbar`/`_chatPinned`).

### Task 3.1: Порт `_chat.scss` (без секции chat-input), `_chatTopbar.scss`, `_chatPinned.scss`

**Files:** Create `web-client/src/styles/tweb/_chat.scss`, `_chatTopbar.scss`, `_chatPinned.scss`; Modify `_index.scss`.

- [x] **Step 1:** Скопировать, починить импорты, добиться сборки (та же процедура, что в Task 2.1).
      Сверх плана понадобились `_sidebar.scss` (от него наследует `.topbar`),
      `_scrollable.scss` (без него лента не скроллит — скроллила страница),
      `pages/_chats.scss` и выдержка `.whole` из base.scss (каркас `#main-columns`).
- [x] **Step 2:** Сверено на стенде при vw=1728: топбар 696×48 @ (704,16), плейт пина
      696×48 @ (704,72) — щель 8px, `--chat-width: 696px`, `.bubbles` 376..1728,
      `bubbles-padding-top` 72 (128 с пином), `-bottom` 64. Всё совпало с tweb.
- [x] **Step 3:** typecheck/тесты (788)/build зелёные.

### Task 3.2: `Chat` — каркас и плейты (P0 №7)

**Files:** Modify `Chat.tsx`, удалить покрытое из `Chat.module.scss`.

- [x] **Step 1:** Дерево собрано; распорки `.bubbles-padding-top/-bottom` вместо паддингов
      контента, высоты — по `chat.ts recomputePaddings`. P0 №7 закрыт.
- [x] **Step 2:** `topbar-floating-plates` — стек пин-бара и тегов «Избранного»; высоту
      меряет `useMeasuredHeight` и пишет в `--pinned-floating-height` (tweb setFloating).
      Плеер — отдельная плашка `.pinned-container.pinned-audio` + `body.is-pinned-audio-shown`.
- [x] **Step 3:** Маску считает CSS (`.bubbles-scrollable`), инлайн-градиент удалён.
- [ ] **Step 4:** DOM-diff каркаса (эталонов обёрток пока нет — снят только по баблам).

### Task 3.3: Пин-бар (P0 №8)

**Files:** Modify `conversation/PinnedBar.tsx`, `usePinnedBar.ts`; удалить `PinnedBar.module.scss`.

- [x] **Step 1:** Разметка `.pinned-container.pinned-message` целиком; `PinnedBorder` переехал на классы tweb (`-border`, `-wrapper-1`, `-mask`/`mask-top`/`mask-bottom`, `-wrapper`, `-mark`).
- [x] **Step 2:** Скролл-трекинг: `pinIndexForVisibleMid` (порт `testMid`) по нижнему видимому баблу, throttle 100ms — как `throttle(setCorrectIndex, 100)`.
- [x] **Step 3:** Портирован партиал `_animatedSuper.scss` + компонент `AnimatedSuper` (ряды `is-hiding` + `from-top`/`from-bottom`), им живут подпись и медиа-превью.
- [x] **Step 4:** Медиа-превью 40×40 (`is-media` + `.pinned-message-media`); слева `.pinned-message-pinlist` (только при `is-many`), справа `.pinned-message-unpin`.
- [x] **Step 5:** Проверено на стенде (пин ставился и снимался), typecheck/тесты/build зелёные.

### Task 3.4: Corner-кнопки и sticky-date (P0 №9, №10)

**Files:** Modify `conversation/ScrollDownFab.tsx` (→ `bubbles-corner-button` семейство), `ChatFeed.tsx`.

- [x] **Step 1:** `ScrollDownFab` = `button.btn-circle.btn-corner.z-depth-1.bubbles-corner-button.chat-secondary-button.bubbles-go-down` + `span.badge.badge-24.badge-primary`; появление — классом `is-go-down-visible` на `.chat`, кнопка всегда в DOM. Портирован `_badge.scss`, в мост добавлены `.btn-corner` и `.z-depth-1` (мост подключён ПЕРВЫМ — в tweb `_button.scss` идёт до `_chat.scss`).
- [ ] **Step 2:** `.bubbles-go-mention` — отложено: непрочитанных упоминаний в модели пока нет (нужен счётчик из чат-листа).
- [x] **Step 3:** `is-scrolling` на `.bubbles-inner` (снимается через 1350ms, как tweb bubbles.ts:4207-4230) + пометка прилипшей даты `is-sticky`; проверено: при скролле дата видна, в покое гаснет в `opacity: .00001`.
- [ ] **Step 4:** DOM-diff каркаса (эталонов обёрток нет).

### Task 3.5: CommentsBar и переход между чатами (P0 №11, №12)

**Files:** Modify `CommentsBar.tsx` (+ бэкенд, если нет recent-авторов треда), `App.tsx`.

- [x] **Step 1:** `.replies-footer` — сделано раньше; аватары теперь реальные: бэкенд
      отдаёт `recent_repliers` (до 3 последних комментаторов карточками id/имя/аватар)
      в ответе `/channels/{id}/comment_counts`; репозиторий — `RecentThreadRepliers`.
- [ ] **Step 2:** Переход между чатами — ОТКАТАН. Реализация сдвигом ±200px давала
      не тот эффект (уходящий чат уезжал поверх сайдбара), потому что `.chats-container`
      у нас блочный: в tweb оба таба лежат в одной ячейке грида `.tabs-container`
      (_slider.scss), который у нас ещё не портирован. Вернуть вместе с фазой 4.
- [x] **Step 3:** Проверки: фронт (typecheck/793 теста/build) + `go build ./... && go vet ./...`.

---

## Фаза 4 — Чат-лист (P0 №13)

### Task 4.1: Порт `_chatlist.scss`, `_row.scss`, `_leftSidebar.scss`, `_avatar.scss`, `_slider.scss`

`_badge.scss` уже портирован (фаза 3, вместе с угловыми кнопками).

- [x] **Step 1:** Портированы дословно `_ripple`, `_button`, `_chatlist`, `_slider`,
      `_leftSidebar`, `_avatar`, `_row`, `_transition`, `_stackedAvatars`; `_index.scss`
      выстроен в порядке tweb `style.scss` (номера строк проставлены комментариями).
- [ ] **Step 2:** Сверка с живым референсом §2 (строка 72px, порядок узлов, пилюли-табы папок).
- [x] **Step 3:** Переход между чатами — **НЕ ДЕЛАЕМ, и вот почему** (закрываю вопрос
      окончательно, я пытался вернуть его дважды и оба раза ошибался).
      Замер на живом tweb: в `.chats-container` в любой момент РОВНО ОДИН `.chat`
      (`count: 1` после сессии с десятками переключений). Переключение чата из списка
      идёт через `appImManager.setInnerPeer` → `spliceChats(0, false, false, spliced)`,
      который делает `chat.container.remove()` СИНХРОННО, — к моменту вызова
      `chatsSelectTab` прежнего узла в дереве уже нет, анимировать нечего.
      Правило `.chat:not(.active) { transform: translate3d(∓200px) }` из `_chat.scss`
      относится к СТЕКУ чатов (открытие треда/комментариев и возврат назад), где два
      контейнера действительно сосуществуют, — а не к смене чата в списке.
      Вывод по процессу: поведение нельзя выводить из чтения CSS — только замер живого
      tweb. Если когда-нибудь понадобится анимация стека тредов — снимать её отдельно.
- [x] **Step 4:** Мост очищен: `.btn-corner`, `.btn-circle`, `.chatlist-container`,
      `.chats-container.tabs-container` теперь приходят из настоящих партиалов. Остались
      только выдержки из `scss/components/_global.scss` (`.z-depth-1`, `.position-center`).
- [x] **Step 5:** typecheck / 793 теста / build зелёные; на стенде замерены колонки,
      топбар, лента, композер, кнопка «вниз» и FAB сайдбара — без сдвигов.

### Task 4.2: `ChatListItem` на дерево tweb

**Files:** Modify `ChatListItem.tsx`, `ChatList.tsx`, `ArchiveRow.tsx`; удалить их модули.

- [x] **Step 1:** Дерево собрано в порядке живого DOM (subtitle → title → avatar),
      строка — `a.row.no-wrap.row-with-padding.row-clickable.hover-effect.rp.chatlist-chat
      .chatlist-chat-bigger.row-big`, выбранная несёт `active` (в tweb это она красит
      строку в акцент и весь текст в белый), замьюченная — `is-muted`.
      Портированы `_row`/`_chatlist`/`_avatar` + выдержка `base.scss:1600-1697`
      (`.peer-title`, `.chatlist-chat`) в `_chatlistRow.scss`.
- [x] **Step 2:** Mute-иконка в титуле после имени (`dialog-muted-icon`), статус —
      `span.message-status.sending-status` 20px (цвет из `--chatlist-status-color`).
- [x] **Step 3:** Бейджи на классах tweb (`dialog-subtitle-badge badge badge-22` +
      `-reaction`/`-mention`/`-unread`/`-pinned`, размер 22 как BADGE_SIZE в
      appDialogsManager); порядок в DOM — реакции → упоминания → непрочитанные → пин.
- [ ] **Step 4:** DOM-diff строки (эталон строки в дампах есть — снять и сверить).

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
- [ ] **Step 3:** `animation-level`: переключать `body.animation-level-0/2` из настройки reduceMotion (как tweb `appImManager.ts:2209-2211`).

  **Важно — исходная формулировка шага была неверна.** Класс `animation-level-2` **уже стоит статикой** в `web-client/index.html:28`, поэтому портированные `@include animation-level(2)` (233 правила в 40 партиалах) не мёртвые, а всегда включены. Дыра ровно одна: ничто не ставит `animation-level-0`. Атрибут `data-reduce-motion` на `<html>` (`App.tsx:224`) **не читает ни одно CSS-правило** (проверено грепом по `styles/`) — он влияет только на `MotionConfig` framer-motion.

  Работы: в `App.tsx` вместо `toggleAttribute('data-reduce-motion', …)` писать
  ```ts
  document.body.classList.toggle('animation-level-0', reduceMotion)
  document.body.classList.toggle('animation-level-2', !reduceMotion)
  ```
  и снять `data-reduce-motion` вместе с его чтением в `components/storyViewerMorph.ts:47`.

  Переключатель сразу оживляет уже разведённую, но всегда-ложную проводку: `components/chatlist/dialogsPlaceholder.ts:39`, `shared/ui/Avatar/Avatar.tsx:57`, `core/hooks/useCollapsable.ts:47`, `components/storyViewerMorph.ts:49`.

- [ ] **Step 4:** navigation-переход с параллаксом для стека экранов. `App.tsx:159` уже вешает `data-animation="navigation"` на `#main-columns`, портированный `styles/tweb/_slider.scss:226-241` уже описывает переходы для `.animating`/`.backwards` — не хватает JS-части (`tweb components/transition.ts:23-32`): уходящему экрану `filter: brightness(80%)` + `transform: translate3d(-width*.25, 0, 0)`, приходящему `translate3d(width, 0, 0)` → reflex → сброс инлайновых стилей.
- [ ] **Step 5:** Проверки + смок.

### ~~Task 7.2: Музыкальный бабл (P0 №6)~~ — ЗАКРЫТА до старта фазы

Сделана в батче фиксов (см. задачу «Батч фиксов: пин-бар, Time-пин, музыкальный бабл…»). Подтверждение в коде: `components/messages/RealMediaBubble.tsx:395-490` рендерит `audio-element.audio` с `audio-details`/`audio-time`; воспроизведение — `core/audio/mediaPlaybackController.ts`; drag-scrub — `input.progress-line__seek` (`RealMediaBubble.tsx:478-485`). Отдельного `shared/ui/MediaProgressLine/*` не заводили: линия живёт внутри бабла, как у tweb.

### Task 7.3: Остаточные поведенческие хвосты

- [ ] **Step 1:** rAF-прогресс для voice-волны и кольца кружка (вместо 4 Гц `timeupdate` — сейчас `core/audio/mediaPlaybackController.ts:23,116`).
- [ ] **Step 2:** Общая очередь voice+round, per-type playbackRate с персистом.
- [ ] **Step 3:** Проверки.

### Task 7.4: Анимации баблов 1:1 с tweb

CSS портирован байт-в-байт (`styles/tweb/_chatBubble.scss`), включая `@keyframes bubbleSelected`, `audio-dots`, `accuracy-wave`, `.can-zoom-fade`. Расхождения — на JS-стороне: класс, который анимацию запускает, либо не вешается, либо заменён собственной реализацией на framer-motion.

**Files:**
- Create: `web-client/src/core/dom/ladder.ts`, `web-client/src/core/dom/ladder.test.ts`
- Modify: `web-client/src/components/messages/MessageRow.tsx:14,160-162`, `web-client/src/components/messages/ChatFeed.tsx:265-300`, `web-client/src/components/messages/RealMediaBubble.tsx:229`, `web-client/src/components/messages/RealMediaBubble.module.scss:61-68`, `web-client/src/components/messages/MessageRow.module.scss:241-251`, `web-client/src/components/messages/bubbleParts/Time.tsx:169-182`, `web-client/src/components/messages/bubbleParts/Time.module.scss:75-88`, `web-client/src/components/messages/EmptyChatGreeting.tsx`, `web-client/src/components/messages/bubbleClasses.ts:141`
- Delete: `web-client/src/components/animations/bubbleAnimations.tsx`, `web-client/src/components/animations/bubbleAnimations.module.scss`

**Interfaces:**
- Produces: `animateLadder(chatInner: HTMLElement, wrappers: HTMLElement[], opts?: {delay?: number; offsetIndex?: number}): Promise<void>` — потребляется `ChatFeed.tsx` и (Step 2) обёрткой `dispatchHeavyAnimationEvent` из Task 7.1.
- Consumes: `dispatchHeavyAnimationEvent(promise, timeout)` из `core/dom/heavyAnimation.ts` (Task 7.1, Step 2). **Task 7.4 идёт строго после 7.1.**

- [ ] **Step 1: Лестница появления — переложить с framer-motion на `zoom-fade`**

  Сейчас: `MessageRow.tsx:160` оборачивает **весь ряд** (`.bubble`) в `BubbleAppear` — `motion.div` с `initial={{opacity:0, scale:.8}}`, задержка `ChatFeed.tsx:267` = `min(msgs.length-1-i, 12) * 0.03`.

  В tweb (`components/chat/bubbles.ts:10363-10460`) анимируется **не ряд**, а `.bubble-content-wrapper` (`bubble.lastElementChild`) плюс `item.group.avatar.node` у последнего в группе; класс `zoom-fading` вешается на `chatInner`; `delay = 40` мс (`10` для дорендера), `offsetIndex = 1`; порядок — `topIds` / `middleIds` / `bottomIds` относительно целевого сообщения; кэп на количество отсутствует.

  Новый `core/dom/ladder.ts`:
  ```ts
  // Порт tweb bubbles.ts:10363-10460 (animateAsLadder).
  // Анимирует .bubble-content-wrapper через классы zoom-fade/can-zoom-fade —
  // сам переход описан в styles/tweb/_chatBubble.scss:3210-3222.
  const TRANSITION_TIME = 300

  export function animateLadder(
    chatInner: HTMLElement,
    wrappers: HTMLElement[],
    {delay = 40, offsetIndex = 1}: {delay?: number; offsetIndex?: number} = {},
  ): Promise<void> {
    if (!wrappers.length) return Promise.resolve()

    chatInner.classList.add('zoom-fading')

    let lastMsDelay = 0
    wrappers.forEach((el, idx) => {
      lastMsDelay = ((idx + offsetIndex) || 0.1) * delay
      el.classList.add('zoom-fade', 'can-zoom-fade')
      el.style.setProperty('transition-delay', `${lastMsDelay}ms`, 'important')
    })

    const last = wrappers[wrappers.length - 1]
    const done = new Promise<void>((resolve) => {
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== last) return
        last.removeEventListener('transitionend', onEnd)
        resolve()
      }
      last.addEventListener('transitionend', onEnd)
      // страховка: transitionend не придёт при animation-level-0
      window.setTimeout(resolve, lastMsDelay + TRANSITION_TIME + 50)
    })

    requestAnimationFrame(() => {
      wrappers.forEach((el) => el.classList.remove('zoom-fade'))
    })

    return done.then(() => {
      requestAnimationFrame(() => {
        wrappers.forEach((el) => {
          el.style.transitionDelay = ''
          el.classList.remove('can-zoom-fade')
        })
        chatInner.classList.remove('zoom-fading')
      })
    })
  }
  ```

  Вызов идёт **из `Chat.tsx`, а не из `ChatFeed.tsx`**: `ChatFeed` рендерит фрагмент из `<section class="bubbles-date-group">`, а аналог tweb-овского `chatInner` — это `.bubbles-inner` в `Chat.tsx:1166-1169`, у него уже есть `contentRef`.
  ```ts
  // Chat.tsx, рядом с useFeedReveal
  useLayoutEffect(() => {
    if (!ladderActive) return
    const inner = contentRef.current
    if (!inner) return
    const wrappers = Array.from(
      inner.querySelectorAll<HTMLElement>('.bubble > .bubble-content-wrapper'),
    ).reverse() // снизу вверх, как tweb bottomIds
    void animateLadder(inner, wrappers)
  }, [ladderActive])
  ```
  `ChatFeed.tsx`: убрать расчёт `ladderDelay` (строка 267) и одноимённый проп; сам `ladderActive` в `ChatFeed` больше не нужен — удалить из интерфейса пропсов (`ChatFeed.tsx:41`).
  `MessageRow.tsx`: снять импорт `BubbleAppear` (строка 14) и пропсы `ladderActive`/`ladderDelay` (строки 78-79, 96), корень ряда — обычный `<div className={classNames(...cls, s.row)}>` с теми же `data-*` и обработчиками.

- [ ] **Step 2: Обернуть лестницу в heavy-animation**

  tweb (`bubbles.ts:10441-10444`) держит `dispatchHeavyAnimationEvent(promise, max(delays) + 300)` на всё время каскада — интерсектор из Task 7.1 глушит лотти и видео, иначе каскад конкурирует с десятком играющих стикеров. В `animateLadder` вернуть `dispatchHeavyAnimationEvent(done, lastMsDelay + TRANSITION_TIME)` вместо голого `done`.

- [ ] **Step 3: Тест на лестницу**

  `core/dom/ladder.test.ts` (vitest + jsdom): три `div.bubble > div.bubble-content-wrapper`, вызвать `animateLadder`, проверить —
  - у всех трёх обёрток есть `zoom-fade` и `can-zoom-fade`, у `chatInner` — `zoom-fading`;
  - `transition-delay` = `40ms`, `80ms`, `120ms` (offsetIndex 1);
  - после одного `requestAnimationFrame` класс `zoom-fade` снят, `can-zoom-fade` остался;
  - после `transitionend` на последней обёртке + rAF сняты `can-zoom-fade`, `transition-delay` и `zoom-fading`.

  Запуск: `npx vitest run src/core/dom/ladder.test.ts`.

- [ ] **Step 4: `.fade-in` у превью медиа**

  `_chatBubble.scss:874-879`: `.media-container-fitted > .thumbnail { opacity: .8 }`, а `.thumbnail.fade-in` → `animation: thumbnail-fade-in-opacity .2s ease-in-out forwards`. Класс `fade-in` у нас не ставится нигде — превью проявляется рывком. В `RealMediaBubble.tsx:229` добавить `onLoad`, который вешает `fade-in` на сам `img.media-photo.thumbnail`.

- [ ] **Step 5: `.backwards` при снятии выделения**

  `_chatBubble.scss:268-282`: вход выделения — `fade-in-opacity .2s`, выход — `.backwards:after { fade-in-backwards-opacity .2s }`. Мы ставим `is-selected` (`bubbleClasses.ts:141`), но никогда `backwards` — снятие выделения происходит в один кадр. Провести `is-selected` через `useSetTransition(isSelected, 'is-selected', 200)` (хук уже есть, `core/hooks/useSetTransition.ts`) и подмешивать результат в классы ряда вместо безусловного `cls.push('is-selected')`.

- [ ] **Step 6: Снять отсебятину**

  Каждая позиция — проверена против tweb, аналога нет:
  - `Time.module.scss:82-89` — `.effectButton { transition: transform .12s ease; &:hover { transform: scale(1.15) } }`. В tweb эффект сообщения — `span.time-effect` внутри `.time-inner` (`components/chat/messageRender.ts:87`), это кастом-эмодзи-стикер, переигрывается по клику и по IntersectionObserver (`bubbles.ts:2502-2503`), ховер-скейла нет. Убрать `transition`/`:hover`, переименовать класс в глобальный `time-effect`.
  - `MessageRow.module.scss:241-251` — `.reactionAnimating` хардкодит `.3s cubic-bezier(.4,0,.2,1)`. Это ровно `--transition-standard-in`, и портированный `_reaction.scss:142-152` уже эмитит те же переходы для `reaction-element`. Дубль снять.
  - `RealMediaBubble.module.scss:61-68` — `.docDl { opacity: 0; transition: opacity .2s ease-in-out }`. В `_document.scss` у tweb такого слоя нет; заменить на ховер-правило из портированного партиала.
  - `EmptyChatGreeting.tsx:13-20` — `motion.div` со `scale .9 → 1` за `.22s`. В tweb `.empty-bubble-placeholder .bubble-content-wrapper { transition: var(--bubble-transition-in) }` (`_chatBubble.scss:4066-4072`) — те же `zoom-fade`-классы, `.3s` и `scale3d(.8,.8,1)`. Перевести на `animateLadder`-классы, framer-motion убрать (пересекается с Task 7.5).

- [ ] **Step 7: Сдвиг градиента обоев — привязать к скроллу (сообщено с экрана: «много нажимаешь — фон сам меняется»)**

  Сейчас `web-client/src/core/hooks/useChatSend.ts` шлёт `window.dispatchEvent(new Event('tg-send'))` из **13 мест**, а `ChatBackground.tsx:196-200` по этому событию зовёт `rendererRef.current?.toNextPosition()` — **без аргумента**, то есть ветку самоанимации (`gradientRenderer.ts:381-400`). Градиент уезжает сам по себе на каждую отправку, и при быстрой отправке подряд фон заметно «гуляет».

  В tweb это устроено иначе, три отличия:
  1. **Триггер — не отправка, а появление сообщения:** `bubbles.ts:1859-1864` ставит `updateGradient = true` в обработчике `history_append` (любое новое сообщение в этом чате, входящее тоже), и только `if (liteMode.isAvailable('chat_background'))`.
  2. **Сдвиг едет вместе со скроллом:** `bubbles.ts:4710-4714` зовёт `gradientRenderer?.toNextPosition(dimensions.getProgress)` из `startCallback` у `scrollIntoViewNew`, то есть прогресс градиента = прогресс анимации прокрутки (`gradientRenderer.ts:373-378` — ветка `getProgress`, `animateSingle(drawNextPositionAnimated)`). Свободной самоанимации не происходит.
  3. **Флаг одноразовый:** `bubbles.ts:4713` сбрасывает `updateGradient = undefined` сразу после применения; если прокрутки не было (мы не у низа ленты), сдвиг просто не случается.

  Работы: убрать 13 диспатчей `tg-send` из `useChatSend.ts` и слушателя из `ChatBackground.tsx`; завести флаг «нужен сдвиг» по приходу нового сообщения в открытый чат, гейт по `animation-level`/lite-mode, а применять его в скролл-к-низу из `Chat.tsx`, передавая `getProgress` анимации прокрутки. Тест: два «сообщения» подряд без прокрутки → `toNextPosition` не вызван ни разу; с прокруткой → вызван один раз и с `getProgress`.

- [ ] **Step 8: Удалить мёртвый модуль анимаций**

  После шагов 1 и 6 `components/animations/bubbleAnimations.tsx` (164 строки: `FadeIn`, `FadeOut`, `FadeInBackwards`, `FadeOutBackwards`, `Flash`, `BubbleHighlight`, `BubbleAppear`) не используется. Все эти эффекты уже есть в портированном CSS (`fade-in-opacity`, `fade-in-backwards-opacity`, `bubbleSelected`). Удалить файл и его `.module.scss`.

- [ ] **Step 9: Проверки**

  `npm run typecheck` && `npx vitest run` && `npx vite build`; DOM-diff по поверхности ленты (режим `classes`) — расхождений быть не должно; ручной смок: открытие чата (каскад снизу вверх), прыжок к сообщению (подсветка `bubbleSelected`), выделение/снятие, загрузка превью.

- [ ] **Step 10: Коммит**

  ```bash
  git add web-client/src/core/dom/ladder.ts web-client/src/core/dom/ladder.test.ts \
          web-client/src/components/messages web-client/src/components/animations
  git commit -m "feat(bubbles): анимации баблов 1:1 с tweb — zoom-fade-лестница, thumbnail fade-in, backwards-выделение"
  ```

**Вне объёма задачи (осознанно):** свайп-ответ (`_chatBubble.scss:146-189`, классы `is-gesturing-reply` / `.is-visible` / `.is-hiding`) — у нас отсутствует целиком. Это не анимация, а тач-жест с трекингом указателя; заводится отдельной задачей, иначе Task 7.4 разрастается за пределы «привести анимации к эталону».

### Task 7.5: Выпиливание framer-motion

**Замер на 2026-08-09:** 80 файлов, поверхность API узкая — `motion.div` ×182, `AnimatePresence` ×178, `motion.button` ×10, `useTransform` ×6, `motion.span` ×4, `MotionConfig` ×4. Пружин (`type: 'spring'`) — 6; в tweb пружин нет вообще, overshoot делается кривой Безье (`--btn-corner-transition: .2s cubic-bezier(.34,1.56,.64,1)`).

Почти всё идёт через три пресета из `web-client/src/motion.ts` — `slideInRight`, `fade`, `menuPop`, — и каждый имеет готовый CSS-аналог в уже портированных партиалах: `_slider.scss` (`.tabs-container[data-animation]`), `_transition.scss` (`.fade`), `_button.scss` (`.btn-menu.active`/`.was-open`). Поэтому задача — не переписывание анимаций, а замена движка на классы.

**Files:**
- Create: `web-client/src/core/hooks/useMountTransition.ts`, `web-client/src/core/hooks/useMountTransition.test.ts`
- Delete (в конце): `web-client/src/motion.ts`; из `web-client/package.json` — зависимость `framer-motion`
- Modify: 80 файлов волнами (список ниже)

**Interfaces:**
- Produces: `useMountTransition(open: boolean, className: string, duration: number): {mounted: boolean; cls: string}` — потребляется всеми волнами.
- Consumes: `useSetTransition(forwards, className, duration): string` (`core/hooks/useSetTransition.ts`, уже есть).

- [ ] **Step 1: Написать падающий тест на `useMountTransition`**

  Хук закрывает единственное, чего не умеет `useSetTransition`: держать узел в DOM, пока играет exit-анимация (это и есть роль `AnimatePresence`). Семантика — tweb `PopupElement`: при закрытии вешается `backwards animating`, узел снимается после `duration`.

  `core/hooks/useMountTransition.test.ts`:
  ```ts
  import {renderHook, act} from '@testing-library/react'
  import {useMountTransition} from './useMountTransition'

  it('держит узел смонтированным на время exit-анимации', () => {
    vi.useFakeTimers()
    const {result, rerender} = renderHook(
      ({open}) => useMountTransition(open, 'active', 200),
      {initialProps: {open: true}},
    )
    expect(result.current).toEqual({mounted: true, cls: 'active forwards'})

    rerender({open: false})
    expect(result.current).toEqual({mounted: true, cls: 'active backwards animating'})

    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toEqual({mounted: false, cls: ''})
    vi.useRealTimers()
  })
  ```

- [ ] **Step 2: Запустить, убедиться что падает**

  `npx vitest run src/core/hooks/useMountTransition.test.ts` → FAIL: `Failed to resolve import "./useMountTransition"`.

- [ ] **Step 3: Реализовать хук**

  ```ts
  // core/hooks/useMountTransition.ts
  // Роль AnimatePresence на классах tweb: узел живёт в DOM, пока играет
  // backwards-анимация. Классы — те же, что у useSetTransition
  // (порт components/singleTransition.ts).
  import {useEffect, useRef, useState} from 'react'

  export function useMountTransition(open: boolean, className: string, duration: number) {
    const [mounted, setMounted] = useState(open)
    const [cls, setCls] = useState(open ? `${className} forwards` : '')
    const first = useRef(true)

    useEffect(() => {
      if (first.current) { first.current = false; return }

      if (open) {
        setMounted(true)
        setCls(`${className} forwards animating`)
        const id = window.setTimeout(() => setCls(`${className} forwards`), duration)
        return () => window.clearTimeout(id)
      }

      setCls(`${className} backwards animating`)
      const id = window.setTimeout(() => { setMounted(false); setCls('') }, duration)
      return () => window.clearTimeout(id)
    }, [open, className, duration])

    return {mounted, cls}
  }
  ```

- [ ] **Step 4: Тест зелёный + коммит**

  `npx vitest run src/core/hooks/useMountTransition.test.ts` → PASS.
  ```bash
  git add web-client/src/core/hooks/useMountTransition.ts web-client/src/core/hooks/useMountTransition.test.ts
  git commit -m "feat(motion): useMountTransition — замена AnimatePresence на классы tweb"
  ```

- [ ] **Step 5: Волна 1 — `shared/ui` (5 файлов)**

  Наибольший рычаг: через эти примитивы анимируется большинство экранов.
  `shared/ui/Popup/Popup.tsx`, `shared/ui/ConfirmPopup/ConfirmPopup.tsx`, `shared/ui/Menu/Menu.tsx`, `shared/ui/Checkbox/Checkbox.tsx`, `shared/ui/Tabs/TabSlide.tsx`.

  Соответствия: `Popup`/`ConfirmPopup` → `.popup.active`/`.popup.hiding` из портированного `styles/tweb/popups/`; `Menu` → `.btn-menu.active.was-open` (`_button.scss`, `--btn-menu-transition: .2s cubic-bezier(.4,0,.2,1)`) — у `Menu.tsx` уже есть проп `onExitComplete`, он ложится на `mounted` из хука; `Checkbox` → `_checkbox.scss`; `TabSlide` → `_slider.scss`.

  Коммит после волны. Прогон: `npm run typecheck && npx vitest run`.

- [ ] **Step 6: Волна 2 — лента и разговор (7 файлов)**

  `components/messages/{ChatDialogs,EmptyChatGreeting,MediaLightbox,MessageRow,SendMediaPopup}.tsx`, `components/conversation/{ChatMsgActionPopups,PinnedMessagesScreen}.tsx`, плюс `components/animations/bubbleAnimations.tsx` (удаляется в Task 7.4).

  `MessageRow` и `EmptyChatGreeting` закрываются самой Task 7.4 — здесь остаётся хвост. `MediaLightbox` уже ведёт `backwards` вручную (`MediaLightbox.tsx:167-169`) — ему нужен только `useMountTransition` вместо `AnimatePresence`.

- [ ] **Step 7: Волна 3 — оболочка и хуки-порталы (7 файлов)**

  `App.tsx` (в т.ч. `MotionConfig` — после Task 7.1 Step 3 его роль берёт `body.animation-level-0`), `components/shell/{GlobalOverlays,ShellLayout}.tsx`, `core/hooks/{useChatPopups,useForumPanel,useSidebarFolders,useSidebarStories}.tsx`.

- [ ] **Step 8: Волна 4 — экраны настроек и групп (19 файлов)**

  `components/settings/*` (11), `components/group/GroupEditFlow.tsx` + `components/group/screens/*` (4), `components/stars/*` (3).
  Здесь доминирует `slideInRight` → заменяется на `data-animation="navigation"` + механику из Task 7.1 Step 4.

- [ ] **Step 9: Волна 5 — остальные экраны `components/` (35 файлов)**

  `AddContactView`, `AddStorySheet`, `CallScreen`, `CallsView`, `ChannelStats`, `Chat`, `CloseFriendsSheet`, `ComposeFab`, `ContactsView`, `EditContactView`, `EditStorySheet`, `EmojiStatusPicker`, `GroupCallScreen`, `LivestreamScreen`, `NewChannelFlow`, `NewGroupFlow`, `NewPrivateChat`, `NowPlayingBar`, `PinnedStoriesSection`, `PlayPauseGlyph`, `PostStats`, `PremiumCheckout`, `PremiumModal`, `QrModal`, `ScheduledView`, `SearchView`, `SettingsSubScreen`, `SettingsView`, `Sidebar`, `SidebarScreens`, `StoriesArchiveSheet`, `StoryReadOnlyPreview`, `StoryStats`, `SuggestedPostsView`, `UserInfoPanel`, плюс `components/{call/CallOverlay,folders/ChatFoldersSettings,mediaEditor/MediaEditor,userInfo/RightsEditor,webapp/WebAppModal}.tsx`.

  Шесть `type: 'spring'` встречаются здесь — заменять на `--btn-corner-transition` (`.2s cubic-bezier(.34,1.56,.64,1)`), это единственный overshoot, который признаёт tweb.

- [ ] **Step 10: Снести движок**

  ```bash
  rm web-client/src/motion.ts
  cd web-client && npm uninstall framer-motion
  grep -rn "framer-motion" src/   # должно быть пусто
  ```

- [ ] **Step 11: Проверки и коммит**

  `npm run typecheck && npx vitest run && npx vite build`. Замерить главный чанк до/после (framer-motion ≈ 60 КБ gzip) и записать дельту в тело PR. DOM-diff по всем поверхностям, где волны трогали разметку.

  ```bash
  git add -A web-client
  git commit -m "refactor(motion): выпилен framer-motion — переходы на классах tweb"
  ```

---

## Порядок и приёмка

1. Фазы идут **последовательно** (2 → 3 → 4 → 5 → 6 → 7); внутри фазы задачи по стилям параллелятся с харнесом, задачи по структуре — строго по очереди (общие файлы).

   **Внутри фазы 7 порядок жёсткий:** 7.1 → 7.4 → 7.5, затем 7.3. Причины: Task 7.4 Step 2 потребляет `dispatchHeavyAnimationEvent` из 7.1; Task 7.5 волна 2 доедает хвост того, что переписала 7.4 (иначе те же файлы правятся дважды); 7.5 волна 3 снимает `MotionConfig`, чью роль к тому моменту уже взял `body.animation-level-0` из 7.1 Step 3. Task 7.3 независима и может идти параллельно любой из них.

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
