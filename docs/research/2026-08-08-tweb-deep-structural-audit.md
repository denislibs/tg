# Глубокий структурный аудит web-client ↔ tweb (DOM / стили / анимации / поведение)

**Дата:** 2026-08-08
**Задача:** построчный аудит соответствия нашего клиента (`web-client/`) референсу tweb (Telegram Web K) на уровне **DOM-структуры (вплоть до дивок), классов, точных CSS-значений, таймингов анимаций и поведения**. Цель финала — веб-клиент, неотличимый от tweb по вёрстке, анимациям и функциональности.
**Метод:** 13 параллельных доменных разведок; для каждого блока читались обе кодовые базы (tweb: императивный DOM в `src/components/**` + SCSS в `src/scss/partials/**`; наш: React-компоненты + SCSS-модули), выписаны фактические DOM-деревья и значения.
**Парные документы (предыдущий уровень):**
- [функциональный паритет 2026-08-07](./2026-08-07-frontend-tweb-parity-audit.md)
- [стили и анимации 2026-08-07](./2026-08-07-frontend-tweb-styles-animations-audit.md)

**Базовые пути:**
- Наш фронт: `/Users/denisurevic/Documents/messenger-denis/web-client/src/`
- Референс tweb: `/Users/denisurevic/Documents/tweb/src/`

**Легенда серьёзности:**
- **P0** — критично, видно сразу (ломает восприятие «это Telegram»)
- **P1** — заметно при использовании (не тот размер/тайминг/структура)
- **P2** — мелочь / полировка

**Маркеры:** «ОТСУТСТВУЕТ» — блока у нас нет вовсе; «ОТСЕБЯТИНА» — у нас есть то, чего нет в tweb, или сделано принципиально иначе.

> `file:line` — снимок на дату аудита; строки сдвигаются, проверять по контексту.

---

## Ревизия 2026-08-09

С даты аудита влиты 8 PR (#154, #156–#162): 518 файлов, +50k/−13k строк. Сводка §14 перепроверена
по коду и размечена статусом: **§14.1** (таблица P0), **§14.2** (системные P1), **§14.3** (отсебятина),
**§14.4** (волны).

**Итог:** 33 из 35 P0 закрыты; **№3 (blockquote) открыт и по факту хуже, чем описано** — цитата
рендерится вообще без класса; **№31 (параллакс navigation) закрыт частично и с неверной премисой**.
Живой остаток документа — §14.3 (отсебятина почти вся на месте) и хвосты §14.2 (п. 5, п. 8).

**Границы этой ревизии — важно:**
- **Разделы §1–13 построчно НЕ переперепроверялись.** Внутри них наверняка есть закрытые находки
  без пометки: сверка шла по сводке §14, а не по каждому из сотен пунктов.
- Метод — поиск портированного кода по кодовой базе (наличие файлов, классов, ссылок на tweb),
  **а не покадровое визуальное сличение**. Расхождение вида «портировано, но не 1:1» такой проход
  не ловит: галочка означает «механика на месте», а не «пиксель в пиксель».
- Пункты, по которым грепом однозначного ответа нет, помечены «не проверено» — их не считать
  ни закрытыми, ни открытыми.

---

## Оглавление

1. [Фундамент дизайн-системы и примитивы](#1-фундамент-дизайн-системы-и-примитивы)
2. [Левый сайдбар и чат-лист](#2-левый-сайдбар-и-чат-лист)
3. [Каркас чата и топбар](#3-каркас-чата-и-топбар)
4. [Баблы сообщений — ядро](#4-баблы-сообщений--ядро)
5. [Медиа-баблы и документы](#5-медиа-баблы-и-документы)
6. [Voice/audio и плеер](#6-voiceaudio-и-плеер)
7. [Композер и панель ввода](#7-композер-и-панель-ввода)
8. [Попапы и меню](#8-попапы-и-меню)
9. [Правый сайдбар и настройки](#9-правый-сайдбар-и-настройки)
10. [Медиавьюер, видеоплеер, сториз](#10-медиавьюер-видеоплеер-сториз)
11. [Реакции, поллы, спец-контент](#11-реакции-поллы-спец-контент)
12. [Система анимаций и переходов (сквозная)](#12-система-анимаций-и-переходов-сквозная)
13. [Auth, поиск, сервисные экраны](#13-auth-поиск-сервисные-экраны)
14. [Сводка приоритетов](#14-сводка-приоритетов)

---

## 1. Фундамент дизайн-системы и примитивы

Общий вывод: цветовая тема-подсистема (4 пресета, производные light-/dark-/light-filled-, highlighting) портирована 1:1 и расхождений почти не имеет. Главные системные дыры: **не портирован блок `:root` из tweb `base.scss`** (transition-токены, line-height-шкала, font-токены, ripple-токены, `--scrollbar-color`, `--disabled-opacity` и ещё ~30 переменных), **не грузится шрифт Roboto**, **вес bold 600 вместо 500 по всему киту**, **скроллбары размазаны ad-hoc по компонентам** вместо единого `.scrollable`.

### 1.1 CSS-переменные и темы

- Референс tweb: `src/scss/variables.scss:1-45`, `src/scss/base.scss:10-225` (`:root`), `:227-284` (day), `:286-316` (`.night`), `:318-360` (`.chat`), `src/helpers/themeController.ts:44-198`
- Наш код: `web-client/src/styles/_variables.scss:1-59`, `styles/_tokens.scss:20-172`, `styles/index.scss:25-41`, `core/theme/themeController.ts:1-384`, `config/themePresets.ts:110-180`

Что совпадает 1:1: SCSS-константы (`_variables.scss` — точная копия), hex-карты 4 пресетов, формулы производных (`light-*`, `light-filled-*`, `dark-*`, rgb-каналы), `--menu-box-shadow`, `--section-box-shadow(-big)`, `--column-box-shadow`, `--message-*`-кластер времени/тика, `--backdrop-opacity` .85/.75, шкала `--font-size-10..24`, `--messages-text-size` и дериваты.

Отсутствующие в нашем `:root` токены tweb `base.scss` (проверено grep'ом — defs=0):

| Токен tweb | tweb (строка base.scss) | у нас | P |
|---|---|---|---|
| `--transition-standard-easing/-in/-out` (+времена .3s/.25s) | :39-43 | ОТСУТСТВУЮТ; тайминги хардкодятся по компонентам | P1 |
| `--pm/layer/tabs/btn-menu/input/popup/btn-corner/chatlist-badge-transition` | :57-78 | ОТСУТСТВУЮТ | P1 |
| `--line-height-11..24` (11px→15 … 24px→30) | :95-103 | ОТСУТСТВУЮТ; line-height задают ad-hoc | P1 |
| `--font-regular/--font-monospace/--font-rounded/--font-weight-bold/-normal` | :126-131 | ОТСУТСТВУЮТ (1 локальный def `--font-weight-bold` не в topике) | P1 |
| `--ripple-duration .7s / -start-scale 0 / -end-scale 2` + override ≤925px (.4s/.27) | :136-143 | не определены — работают только фолбэки в `Ripple.module.scss`, **мобильный вариант потерян** | P1 |
| `--scrollbar-color rgba(0,0,0,.2)/.night rgba(255,255,255,.2)` | :229, :288 | ОТСУТСТВУЕТ | P1 |
| `--disabled-opacity: .3` | :119 | ОТСУТСТВУЕТ (значение хардкодится) | P2 |
| `--hover-alpha`, `--z-below`, `--white`, `--selection-background-color/-color` | :31,30,134,132-133 | ОТСУТСТВУЮТ | P2 |
| `--badge-text-color: #fff` | :249,302 | ОТСУТСТВУЕТ, но **используется** в `components/DatePickerPopup.module.scss:153` → цвет падает в inherit (баг) | P1 |
| `--input-placeholder-color #9BA0A5`, `--input-message-placeholder-color` | :238-239 | ОТСУТСТВУЮТ | P2 |
| `--avatar-online-color: var(--primary-color)`, `--chatlist-pinned-color` | :244,248 | ОТСУТСТВУЮТ (точка online хардкод-зелёная, см. §1.10) | P1 |
| `--skeleton-color`, `--spoiler-background-color/-draft`, `--poll-circle-color`, `--monospace-text-color`, `--premium-gradient`, `--premium-color`, `--old-input-background-color #F1F3F5`, `--limit-line-empty-background`, `--warning-color` | :241-262, :305-313 | ОТСУТСТВУЮТ | P2 |
| `--peer-avatar-{red…archive}-top/bottom` (8 пар CSS-vars) | :168-176 | заменены TS-массивом `GRADIENTS` (`core/dialogToChat.ts:9-17`, значения 1:1, но archive-пары и `--avatar-color-story-*` нет) | P2 |
| `--ripple-color: var(--original-ripple-color)` = rgba(0,0,0,.08) / rgba(255,255,255,.08) | :250-251, :303-304 | **осознанная отсебятина**: 0.13 light / 0.18 dark (`_tokens.scss:124,149`) — риппл заметно темнее tweb | P1 |

ОТСЕБЯТИНА: семейство `--tg-*` (accentGradient, composeShadow, plateShadow, searchCard*, bannerBg, bgGrad0-3) — задокументирована в `_tokens.scss:98-172` как «бесхозные», но `--tg-accentGradient/composeShadow` подкрашивают FAB не-tweb-градиентом (см. §1.5).

Что делать: перенести недостающий `:root`-блок из `base.scss` в `_tokens.scss` одним заходом; `--ripple-color` вернуть к tweb-альфе .08; починить `--badge-text-color`.

### 1.2 Типографика и глобальный базис

- Референс tweb: `src/scss/base.scss:362-448` (html/body), `:488-511` (font-family), `src/scss/fonts/_roboto.scss` (@font-face 400/500, cyrillic+latin), `_robotoMono.scss`
- Наш код: `styles/index.scss:8-61`, `shared/ui/Text/Text.module.scss:4-11`

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Шрифт Roboto | бандлится @font-face (400/500, woff2) | **@font-face нет вообще** — `font-family: Roboto,…` (index.scss:52) срабатывает только при локально установленном Roboto; на большинстве машин весь UI рендерится Helvetica/Arial | **P0** |
| Стек font-family | `Roboto, -apple-system, apple color emoji, BlinkMacSystemFont, "Segoe UI", …` (base.scss:126) | `Roboto, 'Helvetica Neue', Arial, sans-serif` — без system-стека и emoji-шрифтов | P1 |
| Моноширинный | `'Roboto Mono', monospace` (base.scss:127) + `pre,code,kbd` глобально (base.scss:506-511) | `ui-monospace, SFMono-Regular, Menlo, Consolas` ad-hoc в 4 файлах (CodeBlock/Composer/RichText/InstantView) | P1 |
| Вес bold | `--font-weight-bold: 500`; h1-h6/b = 500 | **600** в Badge, Avatar, SidebarSection-name, Tabs, InlineKeyboard, Input-label, ScrollDownFab-badge | P1 |
| line-height дефолт | `--line-height: 1.3125` | `Text` примитив: **1.5** («MUI body1 parity», Text.module.scss:10) — весь текст через Text выше/рыхлее tweb | P1 |
| body user-select | `none` (base.scss:445) | не задан — весь хром выделяется мышью | P1 |
| html/body overflow | `overflow: hidden` (base.scss:368) | `min-height:100%`, `overscroll-behavior:none`, `scrollbar-gutter:stable` (ОТСЕБЯТИНА) | P2 |
| Фон подложки | `background-color: var(--body-background-color)` + `transition .2s` (base.scss:443-447) | `#181818` хардкод на html/body/#root (index.scss:13) — на светлой теме под скруглениями тёмная подложка | P1 |
| caret-color / -webkit-tap-highlight / ::placeholder глобально | base.scss:432, 497-504, 555-560; _input.scss:275-282 | нет глобально (tap-highlight точечно) | P2 |
| `-webkit-font-smoothing` | antialiased (base.scss:430) | antialiased + `text-rendering: optimizeLegibility` (ОТСЕБЯТИНА) | P2 |
| body.deactivated grayscale, `.toast`, `hr`, `.secondary/.danger/.primary` утилиты | base.scss:452-478, 592-644, 741-790 | ОТСУТСТВУЮТ | P2 |

Что делать: забандлить Roboto 400/500 + Roboto Mono, ввести `--font-*`-токены, глобально `--font-weight-bold:500`, `--line-height:1.3125` в Text, `user-select:none` на body, фон body от токена.

### 1.3 Скроллбары

- Референс tweb: `src/scss/partials/_scrollable.scss:3-46` (overlay-scroll), `:84-152` (.scrollable), `:163-184` (кастомный thumb), `src/components/scrollable.ts`
- Наш код: единого компонента НЕТ; ad-hoc: `components/ChatList.module.scss:3-24`, `Sidebar.module.scss:94-103`, `ConversationView.module.scss:101-109`, `UserInfoPanel.module.scss:94-102`, `TopicsPanel.module.scss:31-33`, `ChatThemesPicker.module.scss:8-16` и ещё ~10 мест

DOM tweb:
```
.scrollable.scrollable-y            ← webkit-scrollbar 6px (.375rem), thumb показывается на :hover
  (html.custom-scroll: + .scrollable-thumb-container > .scrollable-thumb)  ← JS-thumb 5px
```
DOM наш: каждый скролл-контейнер сам объявляет `::-webkit-scrollbar { width: 6px }` + hover-проявление.

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Цвет ползунка | `var(--scrollbar-color)` = rgba(0,0,0,.2) / rgba(255,255,255,.2) — полупрозрачный | `var(--secondary-text-color)` (#707579 / #aaa) — **непрозрачный, заметно темнее/ярче** | P1 |
| Радиус ползунка | `$border-radius-medium` 16px (overlay) / 12px (thumb) | 3px | P2 |
| min/max высота ползунка | min 5rem / max 12.5rem (_scrollable.scss:40-41) | нет | P2 |
| Проявление | opacity-переход .2s ease-in-out на hover контейнера | `transition: background .2s` — похоже, ок | — |
| `.no-scrollbar`, `.scrollable-x`, `scrollable-y-bordered` (границы при скролле) | :65-82, :128-143 | разбросано ad-hoc; bordered-варианта нет | P2 |
| Firefox `scrollbar-width: thin` + `scrollbar-color` | :115-122 | есть только в ChatList/ChatThemesPicker, в остальных местах Firefox получает системный скроллбар | P1 |

Что делать: завести общий scss-модуль/класс «scrollable» с токеном `--scrollbar-color` и переиспользовать во всех контейнерах.

### 1.4 Ripple

- Референс tweb: `src/scss/partials/_ripple.scss:28-76`, `src/components/ripple.ts:47-135, 219-245`, токены `base.scss:136-143`
- Наш код: `shared/ui/Ripple/Ripple.module.scss:5-38`, `shared/ui/Ripple/useRipple.tsx:13-83`

DOM tweb: `хост.rp > .c-ripple > .c-ripple__circle[.hiding]` (overflow:hidden только у `.rp-overflow`/спец-классов; Safari — mask-image). DOM наш: `хост > span.root(overflow:hidden) > span.circle[.hiding]`.

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Длительность/масштаб на узких экранах | ≤925px: `--ripple-duration:.4s`, start-scale .27 (base.scss:140-143) | токены не определены → всегда .7s/0 (фолбэки), JS-константа `DURATION=700` (useRipple.tsx:13) не читает CSS | P1 |
| Цвет | rgba(…,.08) | .13/.18 (см. §1.1) | P1 |
| Триггер | mousedown кнопки 0 **и 2** (ripple.ts:220), правый клик тоже риплит; гашение на mouseup **и contextmenu** | только левая кнопка (useRipple.tsx:40) | P2 |
| Клип | по умолчанию НЕ клипует (`c-ripple` без overflow), клип только `.rp-overflow`-случаи | всегда `overflow:hidden` | P2 |
| Появление круга | opacity:0 → reflow → '' (fade-in через transition) (ripple.ts:136-155) | круг появляется сразу с полной opacity | P2 |
| Тайминг гашения `_handler` | elapsed<duration → hiding в max(delay−d/2,0), remove в delay | 1:1 портировано | — |
| Покрытие | ripple на btn-icon, btn-menu-item, row, chatlist-ряды, btn-primary … | есть только в IconButton; **Button, MenuItem, строки настроек, ряды чатов — без риппла** | P1 |

Что делать: определить ripple-токены в `:root` (+медиа-запрос ≤925px), читать duration из computed style, повесить ripple на Button/MenuItem/Row.

### 1.5 Кнопки

- Референс tweb: `src/scss/partials/_button.scss:5-49` (btn/btn-icon), `:51-96` (btn-corner), `:98-460` (btn-menu/-item), `:1021-1074` (btn-primary), `:1077-1112` (btn-transparent), `:1181-1191` (btn-circle), миксины `src/scss/mixins/_hover.scss`
- Наш код: `shared/ui/IconButton/IconButton.module.scss:5-41`, `shared/ui/Button/Button.module.scss:2-36`, `shared/ui/Menu/Menu.module.scss:13-23` + `MenuItem.module.scss:5-60`, `components/ComposeFab.tsx:39-65`, `components/conversation/ScrollDownFab.module.scss`

**IconButton (btn-icon)** — близко к 1:1 (радиус 50%, padding .5rem, цвет secondary, hover `--light-secondary-text-color`, ripple):

| Свойство | tweb | у нас | P |
|---|---|---|---|
| :disabled | `opacity: var(--disabled-opacity)` = .3 | 0.5 | P2 |
| transition | `color .15s, opacity .15s` — фон НЕ анимируется | + `background-color .15s` | P2 |
| `.active`-состояние | color `--primary-color`; `.menu-open` → фон `--light-secondary-text-color` (:46-48, 1172-1178) | нет | P2 |
| `.small` (5px) | нет | ОТСЕБЯТИНА (MUI-parity) | P2 |

**Button (btn-primary)**:

| Свойство | tweb | у нас | P |
|---|---|---|---|
| hover | `background: var(--dark-primary-color)` (затемнение) (:1036-1039) | `filter: brightness(1.05)` (осветление) — противоположное направление | P1 |
| ripple | есть | НЕТ | P1 |
| text-transform | uppercase по умолчанию (:1034) | opt-in `.uppercase` | P2 |
| font-size / height | наследуемые 16px / ровно 3rem, line-height `--line-height` | 15px / min-height 48px | P2 |
| transition | `opacity/background-color/color var(--transition-standard-out)` (.25s cb(.4,0,.2,1)) | filter/opacity .25s (тайминг совпал) | P2 |
| Вариант `btn-primary-transparent` (текстовая, hover light-primary), `btn-transparent`, `btn-control`, `btn-circle`, `btn-large` | :1041-1057, 1077-1149, 1181-1191, 1306-1312 | ОТСУТСТВУЮТ (по месту заменяются ad-hoc стилями) | P1 |

**Menu / MenuItem (btn-menu / btn-menu-item)** — геометрия 1:1 (min-width 11.25rem, padding .25rem, radius 16, item 2rem/паддинги/margin/radius 12, scale .96 на :active, blur 50px, открытие scale .8→1 за .2s cb(.4,0,.2,1)):

| Свойство | tweb | у нас | P |
|---|---|---|---|
| danger-пункт | `color: var(--danger-color)` + hover `--light-danger-color` (btn-hoverable) | хардкод `#ff595a`, hover остаётся серым (MenuItem.module.scss:54-59) | P1 |
| ripple на пункте | есть (ButtonMenu → ripple) | нет | P2 |
| transition пункта | только `transform .1s var(--transition-standard-easing)` | + background-color .15s | P2 |
| подменю/badge/subtitle/header-пункты (:319-460) | есть | ОТСУТСТВУЮТ (пока не нужны) | P2 |
| backdrop-filter | `var(--menu-backdrop-filter)` с off-фолбэком `html.no-backdrop` | хардкод blur(50px) | P2 |

**btn-corner (ComposeFab)**:

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Размер/фон | 54px (46 handhelds), плоский `--primary-color`, hover `--dark-primary-color` (:51-96, 1181-1191) | 56px, градиент `--tg-accentGradient` — ОТСЕБЯТИНА | P1 |
| Анимация появления | `transform var(--btn-corner-transition)` = .2s cubic-bezier(.34,1.56,.64,1), translateY(54px+1.25rem) | framer spring(420/32) + y:96 + opacity | P2 |
| Отступ | 1.25rem (20px) | 20px ✓ | — |

**Scroll-down FAB**: tweb `.chat-secondary-button` (_chat.scss:1393-1403) — surface-фон, тень `$chat-input-box-shadow` (0 1px 8px 1px rgba(0,0,0,.12)); наш 48px + `--tg-plateShadow` (.16) — близко; появление у tweb через opacity/visibility `--layer-transition`, у нас framer. P2.

### 1.6 Инпуты

- Референс tweb: `src/scss/partials/_input.scss:11-264` (input-field: label :47-64, border-overlay :66-81, input :95-208, float-правило :195-203), `:275-282`, `:300-316` (shake), `_inputSearch.scss:3-184`
- Наш код: `shared/ui/Input/Input.module.scss:4-97` + `Input.tsx`, `shared/ui/InputSearch/InputSearch.module.scss:4-89`

DOM tweb (outlined):
```
.input-field > .input-field-input(1px border) + .input-field-border(отдельный div, 2px primary, opacity 0→1) + label(bg surface, transform translate+scale(.75))
```
DOM наш: `div.field > input(border 1→2px на :focus, паддинг-компенсация) + label(top/font-size анимация)`.

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Механика фокуса | рамка-оверлей `.input-field-border` (2px, opacity .2s) — текст не дёргается | смена border-width 1→2px + пересчёт паддинга (Input.module.scss:32-36) | P2 (риск сдвига) |
| Анимация лейбла | `transform: translate(…) scale(.75)` за `.2s transform` (GPU) (:195-203, 61-63) | анимируются top+font-size+color+font-weight .15s | P2 |
| Цвет лейбла в покое | `$placeholder-color` #9e9e9e | `--secondary-text-color` | P2 |
| Фон лейбла | всегда `--surface-color` | transparent до всплытия, notch `--input-bg` — осознанная адаптация | P2 |
| font-weight лейбла в фокусе | `--font-weight-bold` 500 | 600 | P2 |
| Фон инпута | `--surface-color` (+autofill box-shadow фикс :109-115) | transparent, autofill-фикса нет | P2 |
| error/valid состояния, shake (`input-shake` .2s), password-режим (крупный шрифт+глаз), phone-паттерн `:after` | :146-172, 300-316, 318-366, 368-379 | ОТСУТСТВУЮТ | P1 (для auth-флоу) |
| ::placeholder глобально | `--input-placeholder-color` | `--secondary-text-color` локально | P2 |

**InputSearch** (наш = tweb `.input-search.old-style`-роль):

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Фон | old-style: `--old-input-background-color` #F1F3F5 (серый) (_inputSearch.scss:65-68); обычный: `--input-search-background-color` | `--input-search-background-color` (#fff на day) — **белый вместо серого** | P1 |
| border | 1px; hover `--secondary-color` (#c4c9cc) | 1.5px; hover `--secondary-text-color` (#707579, темнее) | P2 |
| focus | `.with-focus-effect:focus` → фон transparent + рамка primary (:103-121) | рамка primary, фон остаётся | P2 |
| Иконка | `--icon-size` 1.5rem, offset 16px, opacity .6 → 1+primary на фокусе | 1:1 ✓ | — |
| grow/hide-анимация плейсхолдера (.25s), preloader в строке | :23-59, 163-174 | ОТСУТСТВУЮТ | P2 |

### 1.7 Checkbox / Radio / Toggle

- Референс tweb: `src/scss/partials/_checkbox.scss:3-127` (квадратный), `:139-187` (round), `:189-309` (radio), `:320-345` (checked-анимации), `:386-453` (toggle)
- Наш код: `shared/ui/Checkbox/Checkbox.{tsx,module.scss}`, `components/TgSwitch.{tsx,module.scss}`, radio — ad-hoc (`components/CreatePollPopup.module.scss:41-53`, `MutePopup.tsx:54` — глифы tgico `radioon/radiooff`!)

**TgSwitch** — почти 1:1 (трек 31×14, thumb 20 + 2px рамка, ход 17px, cubic-bezier(.22,.75,.7,1.3)):

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Длительность thumb | .1s (:422) | .14s | P2 |
| `<input type=checkbox>` внутри (a11y) | есть | нет (div+onClick) | P2 |
| restriction-вариант (danger) | :434-443 | нет | P2 |

**Checkbox**:

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Размер | round 1.5rem (24px), square 1.25rem (20px) | дефолт **18px** | P1 |
| Заливка | круг `inset:-15%` scale(0→1) .2s .05s — круговая «волна» из центра, клипуется боксом (:58-70) | скруглённый квадрат/круг scale — иная форма анимации | P2 |
| Галочка | stroke-dasharray 24.19 за .1s с задержкой .15s, stroke-width 3.75 (:72-93, 320-334) | pathLength .15s delay .15s, stroke-width 2 — тоньше | P2 |
| Рамка round | `var(--secondary-color)` (#c4c9cc) (:154) | `--secondary-text-color` (#707579) — темнее | P2 |
| Радиус square | .3125rem при 20px (25%) | 31% | P2 |
| caption/hover-effect/ripple-обёртка (`.checkbox-ripple` radius 16) | :96-137 | нет | P2 |

**Radio** — единого компонента НЕТ (P1): tweb `.radio-field` (:189-265) — 22px кольцо 2px `--secondary-text-color`, точка 12px scale(0→1) .1s ease, checked-рамка primary. У нас: CreatePollPopup — 20px + `radial-gradient`-точка без анимации; MutePopup — вообще иконки шрифтом. Что делать: завести shared/ui/Radio по tweb-размерам.

### 1.8 Row / Section

- Референс tweb: `src/scss/partials/_row.scss:6-455`, `src/scss/partials/_section.scss:3-107`
- Наш код: `shared/ui/SidebarSection/SidebarSection.module.scss`, `components/settings/kit.module.scss:34-64`, `components/SettingsView.module.scss:40-68`

**Section** — портирован близко (container padding-inline 1rem, карточка surface radius 24 + `--section-box-shadow`, name-строка primary, content-инсет .5rem):

| Свойство | tweb | у нас | P |
|---|---|---|---|
| name font-weight | `--font-weight-bold` 500 | 600 | P2 |
| caption (подпись под секцией) | `margin: -0.375rem 0 1rem; font 14/18; padding 0 1rem; color secondary` (:65-76) | `.footer: padding 6px 24px 0` без типографики | P2 |
| `--section-margin-inline` 0 на handhelds | base.scss:211-220 | фиксированные 0.5rem | P2 |

**Row** — САМОДЕЛЬНЫЙ (P1). tweb DOM:
```
.row.row-with-padding.row-clickable.rp > .c-ripple + .row-icon(abs, left 1rem, 1.5rem) + .row-title + .row-subtitle
```
Наш: `div.row (flex, gap 16px, padding 9px 12px)` + icon/body/value.

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Геометрия | min-height 3.5rem (56px) / 3rem no-subtitle; padding-block .4375rem; padding-inline 1rem; отступ контента при иконке 4.5rem (:6-21, 229-234) | padding 9px 12px, gap 16px, min-height нет → строки ниже и уже tweb | P1 |
| Радиус clickable | 16px (`$row-border-radius`), только not-handhelds (:271-278) | 12px всегда | P2 |
| Ripple | есть | нет (только hover) | P1 |
| Подзаголовок | 14px/18px `--secondary-text-color`, margin-top .1875rem (:393-402) | свой Text без этих значений | P2 |
| row-media размеры (36/32/42/48/54) | :404-444 | наш AVATAR_SIZE (32/40/42/48/54) — 36→40 расходится | P2 |
| grid-вариант, sortable, badge в title (:66-128, 193-206, 281-336) | есть | ОТСУТСТВУЮТ | P2 |

### 1.9 Badge

- Референс tweb: `src/scss/partials/_badge.scss:3-52`
- Наш код: `shared/ui/Badge/Badge.module.scss`

Геометрия 1:1 (size 1.375rem, padding .4375rem, radius size/2, font .875rem).

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Muted-цвет | `.badge-gray` → `--secondary-color` (#c4c9cc — светло-серый) | `--secondary-text-color` (#707579 — тёмно-серый) | P1 |
| font-weight | 500 | 600 | P2 |
| Размерные варианты 18/20/24 + `-icon` | :25-43 | нет | P2 |
| transition background-color .2s | :17-19 | нет | P2 |
| Цвет текста | `var(--badge-text-color)` | #fff хардкод (эквивалентно, но токена нет; см. баг DatePickerPopup в §1.1) | P2 |

### 1.10 Avatar / StackedAvatars

- Референс tweb: `src/scss/partials/_avatar.scss:1-12` (avatar-like), `:14-68` (градиенты), `:163-177` (is-online), `_stackedAvatars.scss:1-32`, палитра `base.scss:168-176`
- Наш код: `shared/ui/Avatar/Avatar.{tsx,module.scss}`, `components/UserAvatar.tsx`, `core/dialogToChat.ts:9-17`, `components/peerColor.ts:3-9`, `components/messages/StackedAvatars.module.scss:10-32`

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Точка online | 14px, border 2px surface, `--avatar-online-color` = **`--primary-color`**, позиция 2.4375rem (для 54px) (:163-177) | `#4dcd5e` хардкод-зелёный, размер 26% от size, позиция 6% | P1 |
| Инициалы | font-size 1.25rem/multiplier (20px при 54), font-weight 500, `wrapAbbreviation` — до 2 букв (имя+фамилия) | 0.42×size (22.7px при 54), 600, 1 буква | P1 |
| Палитра градиентов | 8 пар CSS-vars (+archive) по id | 7 пар TS 1:1 ✓; но `peerColor(name)` (плоские 7 цветов по хешу имени) — ОТСЕБЯТИНА-фолбэк | P2 |
| forum-радиус 37%, monoforum-маска, story-кольца (`avatar-stories-svg`) | :141-160, 187-200 | ОТСУТСТВУЮТ (у stories своя реализация) | P2 |
| fade-in фото .2s | :127-129 | нет | P2 |
| **StackedAvatars** | контейнер row-reverse; item = size+2×border, border 1px `--surface-color`, margin -0.3125rem, is-first без | 1:1 ✓, кроме дефолта border-color: transparent вместо surface | P2 |

### 1.11 Preloader / RadialProgress (+ Spinner)

- Референс tweb: `src/scss/partials/_preloader.scss:5-28` (старый спиннер), `:98-228` (preloader-container/новый), `:230-234`, `base.scss:655-668` (.preloader 50px, stroke primary)
- Наш код: `components/Preloader.{tsx,module.scss}`, `components/RadialProgress.{tsx,module.scss}`, `shared/ui/Spinner/*`

**Preloader**: дуга 75% + rotate 1s linear, stroke-linecap round, stroke-width 3 — 1:1 со старым tweb-спиннером. Отличия: дефолтный size 40 vs tweb 50 (base.scss:656), цвет currentColor vs tweb `--primary-color` для standalone `.preloader` — P2.

**RadialProgress**: rotate 2s ✓, totalLength 149.82 ✓, min-dash 5 ✓, диск rgba(0,0,0,.3) ✓, transition stroke-dasharray .2s ✓.

| Свойство | tweb | у нас | P |
|---|---|---|---|
| stroke-width | 2 (default), 2.5 только streamable, 3.5 bold (:114-122, 199-201, 223-227) | 2.5 всегда | P2 |
| Появление контейнера | opacity 0 + scale(0) → 1/1 за .2s ease-in-out (:43-56) | без входной анимации | P2 |
| Иконки download/close внутри с кросс-фейдом, manual-режим (stroke-width 0) | :153-192 | нет (крест рисуют потребители сами) | P2 |
| swing-режим (постоянные 75%) | :136-151 | покрыт нашим Preloader | — |

**Spinner** (`shared/ui/Spinner`) — ОТСЕБЯТИНА: border-based кольцо 0.7s (замена MUI CircularProgress); в tweb такого примитива нет — везде SVG-прелоадер. Направление: мигрировать потребителей на Preloader и удалить.

### 1.12 Пикер тем

- Референс tweb: `src/scss/partials/_themes.scss:39-143` (свотчи), `:146-222` (accent-picker)
- Наш код: `components/ChatThemesPicker.module.scss:3-87`

| Свойство | tweb | у нас | P |
|---|---|---|---|
| Плитка | 4.5rem×~96px, radius 16 | 78×96, radius 12 | P2 |
| Активная рамка | `::before` СНАРУЖИ (-4px), 2px primary, radius 20, анимация scale .86→1 + opacity `--transition-standard-in` (:67-95) | inset box-shadow 2px внутри, без анимации | P1 |
| Баблы-превью | 2.5rem×1.25rem (40×20), radius 1.75rem; out top .5rem right .375rem цвет `--light-filled-message-out-primary-color`; in top 32px left 6px `--message-background-color` (:124-143) | 42×16, radius 9, свои позиции/цвета | P2 |
| Accent-picker (кружки 2rem, кольцо/inner-диск, section-edge-extension) | :146-222 | ОТСУТСТВУЕТ | P2 |

### 1.13 Итог домена

- **P0**: Roboto не бандлится — фактический шрифт приложения не tweb'овский.
- **P1 (системные)**: не портирован `:root`-блок base.scss (транзишены/line-height/шрифты/ripple/скроллбар-токены); bold 600 vs 500; `Text` line-height 1.5 vs 1.3125; риппл-цвет и отсутствие риппла на Button/MenuItem/Row; скроллбары непрозрачным `--secondary-text-color` вместо `--scrollbar-color`; hover btn-primary осветляет вместо `--dark-primary-color`; online-точка зелёная вместо primary; Row без tweb-геометрии (56px/паддинги); поиск на белом фоне вместо `--old-input-background-color`; badge-gray тёмный; radio без единого компонента; body без `user-select:none`; ComposeFab-градиент; сломанный `var(--badge-text-color)` в DatePickerPopup; рамка активной темы в пикере.
- **ОТСЕБЯТИНА к ревизии**: `--tg-accentGradient/composeShadow` на FAB, Spinner, `IconButton.small`, `text-rendering/scrollbar-gutter` на body, `peerColor(name)`, риппл-альфы .13/.18.

---

## 2. Левый сайдбар и чат-лист

Референс: `tweb/index.html:89-102`, `tweb/src/lib/appDialogsManager.ts`, `sidebarLeft/index.ts`, `_leftSidebar.scss`, `_chatlist.scss`, `_foldersSidebar.scss`, `stories/list.tsx`.
Наш код: `Sidebar.tsx`, `ChatList.tsx`, `ChatListItem.tsx`, `FolderTabs.tsx`, `folders/*`, `StoriesRow.tsx`, `ArchiveRow.tsx`, `ComposeFab.tsx`, `MainMenu.tsx`, `DialogSkeleton.tsx`.

### 2.1 Каркас левой колонки (#column-left)

Референс: `index.html:89-102`, `_leftSidebar.scss:7-27, 328-405, 440-497`, `_sidebar.scss:105-113`, `appDialogsManager.ts:577-727`, `sidebarLeft/index.ts:147-234`.
Наш код: `Sidebar.tsx:121-271`, `Sidebar.module.scss:7-141`.

DOM tweb:
```
#column-left.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column
└─ .sidebar-slider.tabs-container                       ← слайдер экранов (настройки/контакты въезжают табами)
   └─ .tabs-tab.sidebar-slider-item.item-main.active
      ├─ .sidebar-header.main-search-sidebar-header
      │  ├─ .sidebar-header__btn-container.left-sidebar-burger
      │  │  ├─ .animated-menu-icon                      (CSS-морф бургер↔стрелка)
      │  │  ├─ .btn-icon.btn-menu-toggle.sidebar-tools-button (+ .badge.badge-20 нотификаций)
      │  │  └─ .btn-icon.sidebar-back-button
      │  ├─ .input-search (+ emoji-status, lock-button)
      ├─ .stories-list                                  (сразу после шапки)
      └─ .sidebar-content.transition.zoom-fade
         ├─ #chatlist-container.transition-item.active
         │  ├─ canvas.dialogs-placeholder-canvas        (скелетон)
         │  └─ .connection-status-bottom
         │     ├─ .chatlist-overlay                     (табы папок + градиент)
         │     └─ #folders-container.tabs-container
         │        └─ (на каждую папку) .tabs-tab.chatlist-parts.folders-scrollable
         │           └─ .chatlist-top > ul.chatlist
         ├─ #search-container.transition-item.sidebar-search
         ├─ #new-menu.btn-corner (FAB)
         └─ .btn-update.btn-corner
```
DOM у нас: `#chatlist-column > [FoldersSidebar] + .header(SidebarMenuButton + InputSearch + lock) + [StoriesRow] + .body(ChatList/TabSlide + [ArchiveRow] + TabsBar + searchOverlay) + [forumPanel] + ComposeFab + оверлеи`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Ширина/радиус/тень/margin колонки | `--left-column-visual-width` и пр. | 1:1 ✓ | — |
| Per-folder scrollable | у каждой папки свой `.folders-scrollable` — позиция скролла живёт per-folder (`appDialogsManager.ts:1261-1287`) | один общий `.scroll`, контент подменяется — позиция скролла общая на все папки | P1 |
| `.connection-status-bottom` + `--stories-scrolled` | есть | ОТСУТСТВУЕТ — сториз-fold не подключён (см. §2.8) | P1 |
| Переход список↔поиск | zoom-fade: fade-out .15s / fade-in + scale .95→1 .15s; backwards .1s | framer opacity+scale .96+y −6, 0.22s; уходящий слой не анимируется | P1 |
| Resize-handle колонки (5px, col-resize) | `_leftSidebar.scss:1292-1376` | ОТСУТСТВУЕТ | P1 |
| Collapsed-режим 80px (`is-collapsed`) | полный | только частный случай форума | P2 |
| Кнопка обновления `.btn-update` | есть | ОТСУТСТВУЕТ | P2 |
| Архив как экран | слайдер-таб `#chats-archived-container` со stories-list | самодельный `.archiveOverlay` с framer `x:80` — ни разметка, ни анимация не tweb | P1 |

### 2.2 Топбар: бургер (animated-menu-icon)

Референс: `_animatedIcon.scss:58-114`, `_leftSidebar.scss:527-612`, `sidebarLeft/index.ts:156-164, 393-418`.
Наш код: `SidebarMenuButton.tsx:34-68`.

tweb: `.animated-menu-icon[.state-back]` — 3 полоски 18×2px r2, transition transform .25s; state-back: rotate(180°) + плечи rotate(±45°) scaleX(.75); плюс бейдж непрочитанных `badge-20 primary` на кнопке.
У нас: AnimatePresence, кросс-фейд/поворот двух готовых иконок .18s.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Анимация бургер↔стрелка | CSS-морф полосок | свап целой иконки | P1 |
| Бейдж непрочитанных на бургере | есть | ОТСУТСТВУЕТ | P1 |

### 2.3 Топбар: поиск (input-search)

Референс: `_inputSearch.scss:3-184`, `sidebarLeft/index.ts:151-154`. Наш: `shared/ui/InputSearch/*`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота/радиус 44/22, иконка 16px offset opacity .6 | ✓ | ✓ | — |
| border-width | 1px | 1.5px | P2 |
| Focus | фон становится **transparent**, border primary | фон остаётся заполненным | P1 |
| Hover | `border-color: var(--secondary-color)` | `--secondary-text-color` | P2 |
| Анимации grow-input/hide-input .25s, прелоадер на месте иконки | есть | ОТСУТСТВУЮТ | P2 |
| emoji-status кнопка (premium) | есть | ОТСУТСТВУЕТ (lock есть ✓) | P2 |

### 2.4 Главное меню (createToolsMenu ↔ MainMenu)

Референс: `sidebarLeft/index.ts:639-731`, `_leftSidebar.scss:614-653`. Наш: `MainMenu.tsx:133-210`.

Состав tweb: Add Account → Saved Messages (sep) → **Archived Chats + серый бейдж** → My Stories → Contacts → Settings (sep) → More (Dark Mode / Animations / Features / Report Bug / Install / A-версия).
У нас: аккаунты → Add Account → Saved → My Stories → Contacts → **Calls / Close Friends / Wallet / Premium** → Settings → More → **Log Out**.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Пункт «Архив» с бейджем `archived-count` | есть (главная точка входа) | ОТСУТСТВУЕТ | P1 |
| Calls/Close Friends/Wallet/Premium/Log Out в бургере | нет | ОТСЕБЯТИНА (свои фичи) | P2 |
| Порядок пунктов и разделители | по tweb | другой | P2 |

### 2.5 Строка диалога (chatlist-chat)

Референс: `appDialogsManager.ts:230-400`, `row.ts:100-214, 297-357`, `_row.scss:6-21, 130-152…`, `base.scss:1637-1695`, `_chatlist.scss:69-135, 211-359, 478-675`.
Наш код: `ChatListItem.tsx:131-278`, `ChatListItem.module.scss:8-130`.

DOM tweb (avatarSize='bigger'):
```
a.row.no-wrap.row-clickable.hover-effect.rp.row-with-padding.row-big.chatlist-chat.chatlist-chat-bigger [href="#peerId"]
├─ .c-ripple
├─ .avatar.dialog-avatar.row-media-bigger        (54px, position:absolute, inset-start .5625rem)
├─ .row-row.row-title-row.dialog-title           (height 22px)
│  ├─ .row-title.user-title > .peer-title[.with-icons] (bold 500, 16/22; verified/premium ВНУТРИ)
│  │  └─ [.dialog-muted-icon]                    (nosound 18px, сразу после имени)
│  └─ .row-title-right.dialog-title-details (font 12) > span.message-status + span.message-time
├─ .row-row.row-subtitle-row                     (margin-top .125rem)
│  ├─ .row-subtitle (lastMessageSpan 16; медиа-тумба 20×20 r4)
│  └─ .dialog-subtitle-badge.badge-22.…-{reaction|mention|unread|pinned|pollvote}  (CSS order 1..5)
└─ [.avatar-badge]                               (unread на аватаре при collapsed/forum)
```
У нас: `div.row > ripple + Avatar(54, в потоке flex gap 12) + .body(.titleRow + .subtitleRow) + [.cornerBadge]`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота строки | **72px** (min-height 4.5rem, padding-block .5625rem) | 68px (.4375rem) | P1 |
| Горизонтальная геометрия | текст от 4.5rem (72px); аватар absolute на 9px | текст от 78px, аватар на 12px | P2 |
| Элемент | `<a href="#peerId">` | `<div>` | P2 |
| Иконка mute | `nosound` 18px, `--chatlist-pinned-color`, **в титле сразу после имени** | `muted` 17px, **в правом кластере у времени** | P1 |
| Галочки отправки | 20px, цвет `--chatlist-status-color` = **зелёный** в дневной теме (base.scss:247), primary в ночной | 18px, всегда primary | P1 |
| Unread badge muted-цвет | `--secondary-color` (светло-серый) | `--secondary-text-color` (темнее) | P2 |
| Порядок бейджей | reaction(1) → mention(2) → unread(3) → pinned(4) → pollvote(5) через CSS order | mention → reaction → unread | P2 |
| Пин-бейдж | всегда при закрепе; при unread прячется под ним (`has-multiple-badges`) | только когда нет unread | P2 |
| Mention-логика | единственное упоминание → сам unread-бейдж становится «@» (`appDialogsManager.ts:2427-2434`) | всегда отдельный «@» | P2 |
| Анимации бейджей | scale 0↔1, `--chatlist-badge-transition` .25s overshoot-bezier | без анимаций | P1 |
| Медиа-тумба превью | 20×20 r4, play-иконка, is-round | 18×18, без play | P2 |
| Hover | `--light-filled-secondary-text-color` | `--light-secondary-text-color` | P2 |
| Active | `--primary-color` **solid** + полный набор переопределений | `--tg-accentGradient` + частичный набор | P2 |
| `.menu-open` фон при контекст-меню | есть | ОТСУТСТВУЕТ | P2 |
| Typing в subtitle | серый `--secondary-text-color` | accent (синий) | P2 |
| Draft «danger» | `--danger-color` | хардкод `#ff595a` | P2 |
| Онлайн-точка | 14×14, border 2px, left/top 2.4375rem | производная 14px, right/bottom 6% | P2 |
| Секретные чаты (lock + зелёное имя) | нет фичи | наша фича — допустимо | — |
| Слайсинг списка (SortedDialogList) | есть | рендер всех строк | P2 (perf) |

Фикс: паддинг .5625rem (72px), mute-иконка в титул после имени, зелёные галочки 20px через токен, порядок/анимации бейджей.

### 2.6 Folder tabs (горизонтальные)

Референс: `foldersTabs.tsx:11-61`, `tabs.tsx:22-69`, `_slider.scss:3-121`, `_leftSidebar.scss:278-326`, `appDialogsManager.ts:729-822`, `stores/folders.ts:19-30`.
Наш код: `FolderTabs.tsx`, `shared/ui/Tabs/*`, `TabSlide.tsx`.

Структура и «переезд» фона активного таба портированы верно ✓.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Badge таба | badge-20 (20px, .875rem); **primary**, gray только если весь unread замьючен (`folders.ts:27-29`) | 18px, 12px; **всегда серый**, primary на активном | P1 |
| Счётчик «Все чаты» | unreadUnmutedCount | `folderUnread[ALL]` — семантика не сверена | P2 |
| Фон активного | `--light-filled-primary-color` | color-mix 12% | P2 |
| Слайд контента | `--tabs-transition` .2s ease-in-out + swipe на touch | framer .3s; swipe ОТСУТСТВУЕТ | P1 |
| Отступ списка под оверлеем | живой `--chatlist-overlay-height` (ResizeObserver) | хардкод 64px | P2 |
| «Все чаты» short/long по ширине | есть | статичное «All» | P2 |

### 2.7 Вертикальная колонка папок (folders sidebar)

Референс: `_foldersSidebar.scss:3-271`, `foldersSidebarContent/index.tsx:134-242`, `folderItem.tsx:57-104`, `updateColumnWidths.ts:79-81`.
Наш код: `folders/FoldersSidebar.tsx:92-158`, `FoldersSidebar.module.scss:3-102`.

Состав и размеры (72px/offset 80, item, badge-18 белый) совпадают ✓.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Фон | canvas-зеркало градиента чата + тинт; blur(40px) — только фолбэк | всегда blur(40px) — фолбэк-ветка | P2 |
| Бейдж нотификаций на бургере (is-first) | есть | ОТСУТСТВУЕТ | P1 |
| Кастомные иконки папок (iconDocId/emoji, animated) | есть | emoji из названия + иконка по типу | P2 |
| «+ Add chats» у пустой папки | есть | ОТСУТСТВУЕТ | P2 |
| Ripple на пунктах | есть | ОТСУТСТВУЕТ | P2 |
| Позиционирование | absolute в #main-columns | fixed | P2 |

### 2.8 Stories ряд

Референс: `stories/list.tsx:27-32, 121-243, 304-329`, `list.module.scss:4-169`, `appDialogsManager.ts:824-845` (foldInto = input поиска), `_leftSidebar.scss:396-399`.
Наш код: `StoriesRow.tsx:89-225`, `StoriesRow.module.scss:5-102`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| **Fold в поисковую строку при скролле** | ядро фичи: progress → аватары летят к правому краю input, стек 3 шт, `--stories-scrolled` двигает список | НЕ ПОДКЛЮЧЕНО: `--stories-fold` никто не выставляет, ряд всегда развёрнут; `StoriesStack` — мёртвый код | **P0** |
| Кольцо сториз | SVG-сегменты по числу сториз (read/unread цвета) | один сплошной градиентный круг | P1 |
| Высота/размеры | контейнер 92, item 74×82, avatar 54 | ✓ | — |
| Контекст-меню на аватаре (mute/stealth/archive…) | есть (`list.tsx:331-438`) | ОТСУТСТВУЕТ | P1 |
| Hover item фон | есть | нет | P2 |
| space-evenly при малом числе | есть | нет | P2 |
| «+» бейдж на своём аватаре | нет | ОТСЕБЯТИНА | P2 |
| Скрытие при поиске | opacity transition .15s | unmount без анимации | P2 |

### 2.9 Ряд «Архив»

Референс: `archiveDialog.tsx:40-94, 406-441`, `archiveDialog.module.scss:1-57`. Наш: `ArchiveRow.tsx:12-46`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Геометрия ряда | как chatlist-chat-bigger: 72px, те же паддинги, ripple | свои паддинги, r 12, без ripple | P1 |
| Иконка | `archive_filled` (градиент #5CAFFA→#408ACF) | `archive` контурная, градиент ✓ | P2 |
| Кольцо архивных сториз + клик → viewer | есть | ОТСУТСТВУЕТ | P1 |
| Непрочитанные имена bold + темнее | есть | нет | P2 |
| Бейдж gray (`--secondary-color`) | есть | muted (`--secondary-text-color`) | P2 |

### 2.10 FAB «новая переписка»

Референс: `_button.scss:51-95, 1181-1191`, `_animatedIcon.scss:159-171`, `sidebarLeft/index.ts:1027-1077`. Наш: `ComposeFab.tsx`, `ComposeMenu.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер | 54px | 56px | P2 |
| Фон | `--primary-color`, hover dark | `--tg-accentGradient` | P2 (см. §1.5) |
| Показ/скрытие | translate3d(0,74px)↔0, `.2s cb(.34,1.56,.64,1)` | framer spring 420/32 | P2 |
| Смена иконки при открытии меню | два абсолюта, grow-icon/hide-icon `.4s` | rotate 90° + свап .2s | P1 |
| Меню | btn-menu top-left: Channel/Group/Private | + Secret (наша фича) ✓ | — |

### 2.11 Скелетон и пустые состояния

Референс: `dialogsPlaceholder.ts:12-120` (canvas + shimmer, 72px строки), `_leftSidebar.scss:1120-1174` (`empty-placeholder-dialogs`).
Наш: `DialogSkeleton.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Механизм | canvas + shimmer, fade-out поверх реального списка | DOM-строки с CSS-шиммером — допустимая замена, но без кросс-фейда | P2 |
| Пустая папка (утка-стикер 128px, «No chats», кнопка) | есть | ОТСУТСТВУЕТ — пустота | P1 |
| Затухание по строкам | нет | opacity 1−i*0.06 — ОТСЕБЯТИНА | P2 |

### 2.12 Итог домена

- **P0**: сториз-fold в поисковую строку не подключён (+мёртвый StoriesStack).
- **P1**: высота строки 68≠72; mute-иконка не в титуле; зелёные галочки статуса; анимации бейджей; zoom-fade перехода поиск↔список; архив как оверлей + ряд не на chatlist-метриках; бейдж нотификаций на бургере (оба места); морф animated-menu-icon; пункт «Архив» в меню; badge папок (20px, primary/gray); слайд .2s + swipe; per-folder скролл; resize-handle; SVG-кольца сториз; контекст-меню сториз; empty-state папки; FAB grow/hide-icon.
- **P2**: токены (`--secondary-color`, `--old-input-background-color`, `--danger-color`), solid-primary active, порядок бейджей, `<a href>`, медиа-тумба 20px и пр.

---

## 3. Каркас чата и топбар

Референс: `tweb/src/components/chat/{chat.ts,topbar.ts,bubbles.ts,pinnedMessage.tsx}`, `tweb/src/scss/partials/{_chat.scss,_chatTopbar.scss,_chatPinned.scss,_chatBubble.scss,_peerTyping.scss}`.
Наш код: `web-client/src/components/ConversationView.tsx`, `conversation/{ChatHeader,PinnedBar,ScrollDownFab,SelectionBar,TypingIndicator}.tsx`, `ChatBackground.tsx`.

### 3.1 Общий каркас чата

Референс: `tweb/src/components/chat/chat.ts:249-250, 640-643`, `bubbles.ts:1439-1457, 4174-4187`, `_chat.scss:409-537, 1097-1354`, `updateColumnWidths.ts:87-92, 314`.
Наш код: `ConversationView.tsx:877-1017`, `ConversationView.module.scss:6-154`.

DOM tweb:
```
#column-center (inset: var(--page-chats-padding); 16px desktop / 8px handheld)
└─ .chats-container.tabs-container
   └─ div.chat.tabs-tab            ← --chat-topbar-height:3rem; --chat-padding-top/bottom
      ├─ div.sidebar-header.topbar
      ├─ div.bubbles.scrolled-down          (absolute, inset-block −page-padding, edge-to-edge)
      │  ├─ div.bubbles-remover-container > div.bubbles-remover.bubbles-inner
      │  ├─ div.scrollable.bubbles-scrollable   ← mask-image (фейды верх/низ)
      │  │  ├─ div.bubbles-padding.bubbles-padding-top
      │  │  ├─ div.bubbles-inner              ← max-width: chat-width − 2×bubbles-padding
      │  │  └─ div.bubbles-padding.bubbles-padding-bottom
      │  └─ div.bubbles-floating-separators-container
      ├─ div.bubbles-viewport
      └─ div.chat-input (композер; внутри inputContainer — corner-кнопки)
```

DOM у нас:
```
div.root > div.column (height:100dvh, overflow:hidden)
├─ div.nowPlaying (плейт плеера НАД шапкой)
├─ ChatHeader | .threadHeaderBar (absolute, top:16+playerOffset)
├─ PinnedBar (absolute, top: (8|16)+48+8+playerOffset)
├─ div.scroll (absolute inset:0; mask-image инлайном)
│  └─ div.content (max-width:696, padding 0 4px; секции по дням)
└─ .footer (absolute bottom:16) → SelectionBar | Composer | mute-бар; внутри — ScrollDownFab
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Плавающие плейты поверх edge-to-edge скролла | да (`_chat.scss:1105-1121`) | да — концепт совпадает | — |
| Маска фейда скролла | `mask-image` на `.bubbles-scrollable`, floor `rgba(255,255,255,.24)`, cubic-bezier-сэмплы 8.6/33.4/66.6/91.4%, верх = `--chat-padding-top`+0.5rem, низ = 3.5rem+padding (`_chat.scss:1143-1177`) | та же формула (`ConversationView.tsx:96-100`), но константы 100/108 верх, 64/72 низ | P2 |
| Верхняя маска растёт с плейтами | да — `--bubbles-scrollable-fade-top-add: var(--pinned-floating-height)` | НЕТ: fadeTop фиксирован, пин-бар/плеер не расширяют фейд | P1 |
| padding контента растёт с плейтами | `--chat-padding-top = topbar + page-padding + --pinned-floating-height` (`_chat.scss:486`) | paddingTop = 76/84 + playerOffset; пин-бар НЕ учитывается — первый бабл при пине перекрыт плашкой | **P0** |
| `--chat-width` | 696px cap (`updateColumnWidths.ts:99` CHAT_WIDTH_MAX=696), плейты `max-width: var(--chat-width)` | плейты 688, контент 696 — плейты на 8px уже контента (в tweb одинаково 696) | P1 |
| `bubbles-padding` top/bottom элементы (JS-высоты, transition height) | есть | ОТСУТСТВУЕТ (padding CSS-ом) — допустимая замена | P2 |
| `bubbles-remover` / `floating-separators-container` | есть | ОТСУТСТВУЕТ | P2 |
| `is-search-active` → +3.75rem прострел сверху (`_chat.scss:527-536`) | есть | поиск заменяет шапку карточкой, пин-бар прячется; доп. отступ ленты не появляется | P2 |

Направление фикса: пробросить суммарную высоту плавающих плейтов (аналог `--pinned-floating-height`, ср. `topbar.ts:1539-1576 setFloating`) в paddingTop контента и в верхнюю точку маски; выровнять ширины 688↔696.

### 3.2 Топбар чата

Референс: `topbar.ts:127-302` (construct), `254-281` (клик), `1539-1576` (setFloating), `1611-1740` (status); `_chatTopbar.scss:25-243`.
Наш код: `conversation/ChatHeader.tsx:57-147`, `ChatHeader.module.scss:3-26, 225-253`.

DOM tweb:
```
div.sidebar-header.topbar[data-floating=N]   ← h:3rem, radius 24px ($border-radius-big),
│                                              bg surface, box-shadow 0 1px 5px -1px rgba(0,0,0,.21),
│                                              padding-inline .25rem, max-width var(--chat-width),
│                                              transform: translate3d(0, call+audio floating height, 0)
├─ div.chat-info-container
│  ├─ button.btn-icon.sidebar-close-button (left; + span.badge.badge-20.back-unread-badge)
│  ├─ div.chat-info (flex:1, padding-inline-start:49px)
│  │  └─ div.person (h:100%)
│  │     ├─ avatar.person-avatar (size 40, withStories, withVideoAvatar, auto-delete-бейдж)
│  │     └─ div.content (padding-inline-start:1rem)
│  │        ├─ div.top > div.user-title (font 1rem/1.5rem, weight 500)
│  │        └─ div.bottom (font .875rem, secondary; .online → primary) > div.info
│  └─ div.chat-utils: [phone][videochat][videochat-menu][search][filter][btn-menu-toggle ⋮]
└─ div.topbar-floating-plates (top: calc(3rem + .5rem); колонка плейтов, gap 1px,
   bg var(--border-color), radius 24, общий box-shadow, overflow hidden)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота / радиус / фон | 3rem / 24px / surface | 48px / 24px / surface ✓ | — |
| Тень | `0px 1px 5px -1px rgba(0,0,0,.21)` (`_chatTopbar.scss:29`) | `--tg-plateShadow: 0 1px 8px rgba(0,0,0,.16)` (dark: .45) | P1 |
| padding | `.25rem` inline | `padding:4px` со всех сторон + gap 12px | P2 |
| Заголовок | 1rem/1.5rem, weight 500 | 16px weight 500 ✓; иконки verified/premium/emoji-status есть | — |
| Сабтайтл | .875rem (14px), онлайн → primary | 13.5px | P2 |
| Клик по топбару (вне кнопок) → открыть правую колонку профиля; клик по аватару со сторис → сторис; medium+левая колонка → back (`topbar.ts:254-281`) | есть | клик только по `.peer`; остальная область шапки инертна; сторис-ветка ОТСУТСТВУЕТ | P1 |
| Back-кнопка с бейджем непрочитанных папки ALL (`topbar.ts:140-143, 987-996`) | есть | back без бейджа | P1 |
| Кнопки справа | phone, videochat (+RTMP-меню), search, filter, ⋮ — с verify-гейтингом; join/mute уехали в input-плейт | phone/videocamera (private only), search, ⋮. Группового videochat нет — вместо него `groupCallBanner` (ОТСЕБЯТИНА-структура, tweb это `pinned-call` плейт, `_chatPinned.scss:792-1002`) | P1 |
| `topbar-floating-plates` — единая колонка плейтов с 1px разделителями | есть | ОТСУТСТВУЕТ: PinnedBar — отдельная плашка; requests/actions/translation/sponsored/removeFee/live плейты ОТСУТСТВУЮТ | P1 |
| Плейт аудиоплеера | `pinned-audio` в топбар-зоне, топбар сдвигается `translate3d` на `--topbar-floating-audio-height` (3rem+gap) | `nowPlaying` НАД шапкой, шапка сдвигается инлайн `top:+playerOffset` — поведенчески похоже, структурно иначе | P2 |
| Поиск в чате | `topbarSearch` монтируется В топбар (`chat.ts:816`), `.chat.is-search-active` | шапка целиком заменяется search-карточкой (AnimatePresence) | P1 |
| handhelds: прятать кнопки кроме ⋮ (`_chatTopbar.scss:156-160`) | есть | есть (`.desktopOnly`) | — |

### 3.3 Pinned message bar

Референс: `pinnedMessage.tsx:39-68, 122-242, 529-589, 736-749`, `pinnedMessageBorder.ts:3-13`, `_chatPinned.scss:3-104, 106-183, 249-348, 350-490`.
Наш код: `conversation/PinnedBar.tsx:46-93`, `PinnedBar.module.scss:4-107`, `PinnedBorder.tsx:11-99`, `core/hooks/usePinnedBar.ts:30-55`.

DOM tweb:
```
div.pinned-container.pinned-message[.is-media .is-many][data-mid]  ← h:3rem, bg surface, padding .25rem
├─ button.btn-menu-toggle.pinned-message-menu (иконка pin) → меню: pinlist / unpin / hide
├─ div.pinned-container-wrapper.pinned-message-wrapper.hover-primary-effect  ← h:2.75rem, radius .5rem, ripple
│  ├─ pinned-message-border: -wrapper-1 (1 пин, 40×3, radius 3) | -mask(40px окно, фейды 6px) > -wrapper(clipPath-сегменты: 2→19px, 3→12px, 4+→10px, gap 2) > -mark
│  └─ div.pinned-container-content.pinned-message-content
│     ├─ pinned-message-media-container (40×40, AnimatedSuper, transform-анимация)
│     ├─ .pinned-container-title: «PinnedMessage» + .animated-counter «#N»
│     └─ .pinned-container-subtitle: AnimatedSuper-строки (translateY 20px, --pm-transition .2s ease-in-out)
└─ div.pinned-message-action > button.pinned-message-unpin (close) [+ inline-кнопка, cross-fade 200ms]
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Индикатор-сегменты | pinnedMessageBorder.ts (19/12/10, gap 2, clipPath, mask-фейды) | PinnedBorder.tsx — порт 1:1, включая mask-top/bottom ✓ | — |
| Анимация смены пина | AnimatedSuper: строка/медиа въезжают по translateY(±20px/±40px) .2s ease-in-out; animated-counter цифрами | НЕТ анимации: текст просто заменяется | **P0** |
| Медиа-превью в плашке | 32-40px квадрат/круг слева от текста (`_chatPinned.scss:390-404`) | ОТСУТСТВУЕТ | P1 |
| Левая иконка pin | кнопка-меню (pinlist/unpin/hide) | статичная иконка (меню нет) | P1 |
| Ripple/hover на wrapper | `hover-primary-effect` + ripple `--light-primary-color` | нет | P1 |
| Выбор показываемого пина | скролл-трекинг: пин ≤ нижнего видимого бабла (`testMid`, `setCorrectIndex` по bubbleByPoint('bottom')), throttle 100ms, debounce 100ms | клик-переключение по кругу (`usePinnedBar.follow`), скролл не влияет | **P0** |
| Клик по плашке | `followPinnedMessage`: прыжок + после прыжка testMid(mid−1) → следующий старее | прыжок + `nextPinIndex` циклически — близко | P2 |
| Заголовок «Pinned message #N» | counter скрыт для новейшего (is-last scale .68 → opacity 0) | badge=null для новейшего — так же ✓ | — |
| Появление вместе с баблами (prepareInitial/revealPrepared) | плейт и лента красятся одним кадром | плашка появляется независимо (AnimatePresence y:−8) | P2 |
| Геометрия | плейт h:48 в общем стеке `topbar-floating-plates` (зазор .5rem, 1px разделители) | отдельная плашка h:48, top = header+8 — на десктопе совпадает; на narrow header top=16, а плашка считает от 8 → зазор 0px (расхождение внутри нашего же кода: `ChatHeader.tsx:55` vs `PinnedBar.tsx:57`) | P1 |
| `hide-pinned`/скрытие пользователем (`peer_pinned_hidden`) | есть | ОТСУТСТВУЕТ | P2 |

### 3.4 Фон чата

Референс: `chat/bubbles/chatBackground.tsx:207-297, 374-545`, `chatBackground.module.scss:1-77`, `gradientRenderer.ts`, `patternRenderer.ts`.
Наш код: `ChatBackground.tsx:30-193`, `ChatBackgroundLazy.tsx`.

tweb-слои:
```
div.Layer (absolute inset 0, singleton на body)
├─ div.Slot[.IsPattern → bg #000][.IsTinted → bg body-bg]
│  ├─ canvas.CanvasCommon.GradientCanvas (height:150%; top:-25%)
│  └─ canvas.CanvasCommon[.Blend soft-light][.DarkPatternInvert invert(1)] (pattern)
└─ div.Slot (staging)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Градиент-рендерер + toNextPosition при отправке | есть | есть (порт tweb, событие `tg-send`) ✓ | — |
| Стратегии mask (night) / overlay soft-light / tinted invert, intensity −38 | есть | есть 1:1 (modeFor) ✓ | — |
| Средний цвет → highlighting color | `computeHighlightingHsla` c canvas/image | усреднение hex-цветов темы (не пикселей canvas) — для градиентов эквивалентно, для кастомного фото пропускается | P2 |
| GradientCanvas `height:150%; top:-25%` | есть (`chatBackground.module.scss:63-66`) | ОТСУТСТВУЕТ — canvas ровно inset:0 | P1 |
| Двойная буферизация слотов + cross-fade (fade .2s / crossfade in .3s / out .25s), deferReveal синхронно с маунтом баблов | есть | ОТСУТСТВУЕТ: один слой, перерисовка на месте (смена темы/чата без кросс-фейда) | P1 |
| Per-peer wallpaper (`resolveFromPeer`) | есть | тема чата → `themeColors` проп (градиент), file-wallpaper per-peer нет | P2 |

### 3.5 Кнопки goto-down / goto-mention

Референс: `input.ts:614-622 (goDown), 1032-1034 (badge), 824-880 (mention/reaction/pollVote)`, `_chat.scss:1217-1245, 1356-1391, 1393-1428, 1430-1455`, `_button.scss:51-80, 1181-1191`, `_badge.scss:3-51`, `bubbles.ts:4907-4911`.
Наш код: `conversation/ScrollDownFab.tsx:15-39`, `ScrollDownFab.module.scss:2-33`, `ConversationView.tsx:742-744`.

tweb DOM:
```
button.btn-circle.btn-corner.z-depth-1.bubbles-corner-button.chat-secondary-button.bubbles-go-down
└─ span.badge.badge-24.badge-primary[.badge-gray если mute]
button.…bubbles-go-mention.bubbles-go-reaction ×3 (mention / reactions / poll) + badge-24
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер | 54px (46 на handhelds) | 48px | P1 |
| Позиция | inset-inline-end:0, bottom: calc(--chat-input-height + .5rem); сдвиг при росте композера | right:0, top:−64px от футера (двигается с ростом композера — ок) | P2 |
| Появление | ТОЛЬКО opacity+visibility, `--layer-transition` .2s cubic-bezier(.4,0,.2,1); transform закреплён (`_chat.scss:1356-1362, 1430-1439`) | слайд y:60→0 + fade, cubic-bezier(.34,1.56,.64,1) — этот bezier в tweb только у `--btn-corner-transition` (не для go-down) | P1 |
| Условие показа | `!scrolledDown && !search-results-active` | showScrollDown из useChatScroll — эквивалент ✓ | — |
| Фон/цвет/тень | surface / secondary-text / `0px 1px 8px 1px rgba(0,0,0,.12)` + hover-затемнение `:after` light-secondary | surface / secondary-text / `0 1px 8px rgba(0,0,0,.16)`, hover нет | P2 |
| Бейдж | badge-24: 24px, top −.25rem, inset-inline-end −.25rem, weight 500, `badge-gray` при mute | 22px, top −6px, **без right**, weight 600, белое кольцо `0 0 0 2px surface` (ОТСЕБЯТИНА), mute-серости нет | P1 |
| goto-mention / goto-reaction / goto-poll-votes + стек с подъёмом, контекст-меню «прочитать все» | есть | ОТСУТСТВУЕТ полностью | **P0** |

### 3.6 Floating date (sticky date)

Референс: `_chatBubble.scss:479-530`, `bubbles.ts:1383-1407`, `_chat.scss:1343-1353`.
Наш код: `messages/ChatFeed.tsx:69-80, 172-199`, `ChatFeed.module.scss:16-50`.

tweb: `.bubble.service.is-date` — `position:sticky; top: calc(--chat-padding-top + 3px); z-index:2; transition: opacity .3s ease`. Стоящая (stuck) дата получает `.is-sticky` → `opacity:.00001`; при скролле `.bubbles-inner.is-scrolling .is-sticky {opacity:.99999}` — **плавающая дата видна только во время скролла и фейдится за 0.3s после остановки**. Клик открывает date-picker.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Sticky-механика | sticky сам сервис-бабл; is-fake копия для отрыва | sticky `<header>` внутри day-`<section>` — вытеснение секцией, ок | P2 |
| Скрытие после остановки скролла | да (opacity .00001 ↔ .99999, .3s ease) | НЕТ — дата-пилюля прилипшая видна всегда | **P0** |
| top | `--chat-padding-top` + 3px (реагирует на плейты автоматически) | `dateStickyTop` = playerOffset + (пины?122:66) − (narrow?8) — вручную, transition top .22s (в tweb transition top нет) | P1 |
| Вид пилюли | `.service-msg`: padding .28125rem .625rem, radius .875rem, `--message-highlighting-color`, #fff | 1:1 ✓ | — |
| Клик → date picker | есть | есть ✓ | — |
| Смещение при поиске (+3.75rem) | есть | нет | P2 |

### 3.7 Unread divider

Референс: `_chatBubble.scss:238-259, 3323-3325`, `bubbles.ts:571-572, 11573-11603`.
Наш код: `ChatFeed.tsx:187-194`, `ChatFeed.module.scss:143-157`, `ConversationView.tsx:376-387`.

tweb: НЕ отдельный элемент — `::before` на первом непрочитанном бабле `.bubble.is-first-unread`: `content: var(--unread-messages-text); height:30px; margin-bottom:3px; margin-left/right:-50%; width:200vw; line-height:2.1; font-size:15px; font-weight:500; color:primary; background:surface; z-index:2`. Фиксация — `attachedUnreadBubble` один раз.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Механика фиксации на маунте | да | да (`openReadRef`/`unreadDividerRef`) ✓ | — |
| Элемент | ::before на бабле, width 200vw | отдельный div width:100vw + translateX(-50%) — визуально то же | P2 |
| font-weight | 500 | 700 | P2 |
| Остальные метрики (30px, lh 2.1, 15px, primary/surface, mb 3px) | — | 1:1 ✓ | — |

### 3.8 Typing indicator

Референс: `_peerTyping.scss:4-271`. Наш: `conversation/TypingIndicator.tsx`, `TypingIndicator.module.scss`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| text: 3 точки 6px, .6s linear infinite, dotFirst/Middle/Last | — | порт 1:1 ✓ | — |
| record: точка + recordBlink 1.25s | — | 1:1 ✓ | — |
| upload-вариант (полоска 13×5, анимация 1s) | `_peerTyping.scss:55-80` | ОТСУТСТВУЕТ | P1 |
| choosing-sticker (глаза, eye/eye-move 1.8s) | `_peerTyping.scss:96-129` | ОТСУТСТВУЕТ | P1 |
| Виды действий | typing/upload/record/sticker/игры и т.д. | `TypingKind = 'text' | 'record'` (`useTypingLabel.ts:33`) | P1 |

### 3.9 Селекшн-режим (каркасная часть)

Референс: `selection.ts:1040-1135`, `_chat.scss:582-668, 1181-1213`, `_chatBubble.scss:306-341`.
Наш код: `conversation/SelectionBar.tsx:20-43`, `SelectionBar.module.scss:2-30`, `core/hooks/useChatSelection.ts:26-68`, `MessageRow.module.scss:53-97`.

tweb нижний плейт: `[delete danger] [кнопка-счётчик «N messages» (клик = отмена)] [forward | send2 для scheduled]`; появление — opacity через `$input-half-transition-time` (.1s) синхронно с анимацией композера.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Раскладка плейта | delete (слева, danger) · счётчик-кнопка по центру · forward (справа) | close · текст «Selected: N» (не кнопка) · forward · delete | P1 |
| Клик по счётчику = отмена выделения | есть | нет | P2 |
| Анимация появления | cross-fade с композером (.1s тайминги) | мгновенная замена композера | P1 |
| Сдвиг входящих баблов | `translateX(2.5rem)` (40px) + avatar scale3d(.76) | `translateX(34px)`; масштаб группового аватара не меняется | P1 |
| Чекбокс | absolute, inset-inline-start:0, bottom:.3125rem, box-shadow 0 0 3px rgba(0,0,0,.4) | left:4px, bottom:5px, drop-shadow — близко | P2 |
| Esc → отмена | навигация-стек | pushEsc — эквивалент ✓ | — |
| Drag-select | tweb: touch-drag (handhelds) | useDragSelect (mouse) — расширение | P2 |
| Scheduled: forward → send-now | есть | нет | P2 |

### 3.10 CommentsBar / TopicsPanel

**CommentsBar.** Референс: `_chatBubble.scss:2160-2225` (`.replies-footer`), `chat/replies.ts`. Наш: `CommentsBar.tsx`, `CommentsBar.module.scss`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота 3.0625rem, border-top 1px, min-width 15rem, текст bold .9375rem, chevron absolute, hover light-primary | — | 1:1 ✓ | — |
| Аватары комментаторов | реальные stacked-avatars последних комментаторов | ХАРДКОД: 3 декоративных градиентных кружка (`CommentsBar.tsx:9-14`) — ОТСЕБЯТИНА (фейковые данные) | **P0** |
| `.is-unread` точка после текста | есть (`:after` 8px primary) | ОТСУТСТВУЕТ | P2 |
| `replies-beside` (кнопка сбоку у медиа-постов) | есть | ОТСУТСТВУЕТ | P1 |

**TopicsPanel**: в tweb панель топиков — форум-таб в ЛЕВОМ сайдбаре; у нас так же ✓. Иконка топика: unicode-emoji/буква с градиентом vs custom-emoji tweb (ОТСЕБЯТИНА-упрощение, помечено в коде).

### 3.11 Переходы между чатами

Референс: `_chat.scss:489-506` (`.chat` = tabs-tab: `transition: transform var(--tabs-transition) (.2s ease-in-out), opacity`; неактивный — `opacity:0; translate3d(∓200px)`), `appImManager.ts:2237-2270` (до 4 живых чат-табов, heavy-animation 250+150ms).
Наш код: `App.tsx:105-118`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Стек чатов (несколько `.chat.tabs-tab`, слайд ±200px + fade .2s ease-in-out) | есть | ОТСУТСТВУЕТ: `<ConversationView key={selectedId}>` — жёсткий ремаунт без анимации перехода | **P0** |
| Возврат назад (navigation stack, `chat.pop()`) | есть | onBack закрывает колонку (мобайл), стека чатов нет | P1 |
| Кросс-фейд фона в такт слайду | есть | нет (см. §3.4) | P1 |

### 3.12 Итог домена

**P0:** paddingTop ленты не учитывает пин-бар (первый бабл перекрыт); pinned bar без скролл-трекинга и без анимации смены; нет corner-кнопок goto-mention/reaction/poll; плавающая дата не скрывается после остановки скролла; CommentsBar с фейковыми аватарами; нет анимации перехода между чатами.

**P1:** тень плейтов; ширина плейтов 688 vs 696; клик по топбару → профиль/сторис; бейдж на back; отсутствует стек `topbar-floating-plates` и все плейты кроме пина; go-down 48 vs 54px и слайд вместо fade; сегмент-зазор пин-бара на narrow; upload/choosing-sticker тайпинг; selection-плейт (порядок кнопок, 34 vs 40px, нет cross-fade); фон без double-buffer и 150%-канваса.

---

## 4. Баблы сообщений — ядро

Референс: `tweb/src/components/chat/bubbles.ts` (главный строитель), `bubbleGroups.ts`, `messageRender.ts`, `tweb/src/scss/partials/{_chatBubble.scss,_quote.scss,_markup.scss,_spoiler.scss}`.
Наш код: `web-client/src/components/messages/{ChatFeed,MessageRow,MessageContent}.tsx`, `bubbleParts/{primitives,richBubbles,Time}.tsx`, `MessageBubbles.module.scss`, `MessageRow.module.scss`, `RichText.tsx`, `CodeBlock.tsx`.

### 4.1 Полная DOM-структура ленты и бабла

**tweb** (`bubbles.ts:1441-1453, 4801-4836, 6618-6629, 9669`, `bubbleGroups.ts:74, 136-163, 217-238, 653-654`):

```
.bubbles(.is-selecting|.scrolled-down)
└─ .bubbles-scrollable (scrollable, mask-фейды)
   └─ .bubbles-inner(.is-chat|.with-message-avatars|.is-broadcast|.is-scrolling|.zoom-fading)
      ├─ .bubbles-padding.bubbles-padding-top / -bottom
      └─ .bubbles-date-group                      ← контейнер ОДНОГО дня
         ├─ .bubble.service.is-date(.is-sticky|.is-fake)   ← дата-разделитель = сервисный бабл
         │  └─ .bubble-content-wrapper > .bubble-content > .service-msg
         └─ .bubbles-group(.bubbles-group-first|.bubbles-group-last)  ← серия одного автора
            ├─ .bubbles-group-avatar-container              (absolute, inset:0, column-reverse)
            │  └─ .bubbles-group-avatar.user-avatar         (position: sticky!, size 40)
            └─ .bubble …модификаторы…  [data-mid, data-peer-id]
               ├─ ::before  — плашка «Unread» (только .is-first-unread)
               ├─ ::after   — полоса highlight/selection (100vw, z-index:-1)
               ├─ .bubble-select-checkbox          (режим выделения)
               └─ .bubble-content-wrapper(.can-zoom-fade|.zoom-fade)
                  ├─ .bubble-content
                  │  ├─ .name(.colored-name|.floating-part)[data-peer-id]   (всегда в DOM; скрыт CSS)
                  │  │  └─ .peer-title / .bubble-name-forwarded / .is-via / .bubble-name-rank
                  │  ├─ .reply.quote-like.quote-like-hoverable.quote-like-border
                  │  │  └─ .reply-content > .reply-media? + .reply-title + .reply-subtitle
                  │  ├─ .message.spoilers-container(.mt-shorter|.mb-shorter)
                  │  │  └─ …rich text…, .webpage?, span.time > …части… + div.time-inner
                  │  ├─ .attachment (медиа)
                  │  ├─ .replies-footer / .bubble-beside-button / reactions-element
                  │  └─ svg.bubble-tail (append последним, generateTail())
                  └─ .reply-markup                (inline-клавиатура — СИБЛИНГ bubble-content)
```

**Модификаторы `.bubble`** (все найденные): `is-in / is-out`, `is-group-first / is-group-last`, `can-have-tail`, `is-forced-rounded`, `has-plain-media-tail` (мёртв — `USE_MEDIA_TAILS=false`, bubbles.ts:262), `hide-name / must-have-name / forwarded / hidden-profile`, `is-reply`, `service / has-fake-service / is-date`, `is-message-empty`, `just-media`, `emoji-big`, `sticker`, `round`, `photo/video/audio-message/voice-message/document-message/contact-message/call-message/poll-message`, `is-album`, `is-first-unread`, `is-highlighted`, `is-selected`, `is-sending/is-outgoing/is-error`, `with-replies / with-beside-replies`, `with-beside-button`, `channel-post`, `with-reply-markup`, `has-floating-time`, `has-webpage / invert-media`, `no-forwards`, `is-thread-starter`, `is-sponsored`, `min-content`.

**У нас** (`ChatFeed.tsx:276-284, 84-105`, `MessageRow.tsx:95-156`, `MessageContent.tsx:437-511`):

```
<section class=.section>                       ← день
  <header .dayPill sticky> <button .pill>…     ← дата
  [.group > .groupAvatarCol > .groupAvatar + .groupBody]   ← серия входящих в группе
    <motion.div .row [data-out][data-last][data-selecting][data-mid][data-seq]>
      [.band]  [.check]
      <div .zone>
        <div .bubbleWrap>                       ← только текстовый тип!
          <div .textBubble style={borderRadius: inline}>
            [BubbleTail svg] [.name] [.forward] [.reply]
            <div .message> RichText + [.webpage/.factCheck] + Time(+clearfix)/reactions
          [.footerText]
        [InlineKeyboard]
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Уровень `.bubble-content-wrapper` у всех типов | есть всегда (анимации/сдвиги вешаются на него) | `.bubbleWrap` есть **только** у text-бабла; медиа/voice/poll — плоские | P1 |
| `.bubbles-date-group` (день) | есть | `.section` — аналог есть ✓ | — |
| Модификаторы — классы на одном узле | ~35 классов | 3 data-атрибута + инлайн-стили; состояния размазаны по props/inline | P1 |
| Имя/reply/forward в **любом** типе бабла (в т.ч. медиа, floating-плашка над just-media: `_chatBubble.scss:1059-1125`) | есть | имя — только text/poll/checklist; reply/forward — **только text**. Для фото/альбома/voice/документа ОТСУТСТВУЕТ | **P0** |
| `.bubble.is-out` = `flex-direction: row-reverse` + `margin-left:auto` (`:3438-3462`) | — | `.zone { justify-content:flex-end }` — визуальный эквивалент ✓ | — |

### 4.2 Геометрия: ширины, радиусы, отступы

Референс: `_chatVariables.scss:12-24`, `_chatBubble.scss:90-144, 357-372, 3354-3395, 3456-3517`, `_chat.scss:1282-1341`. Наш: `styles/_variables.scss:10-18`, `MessageRow.module.scss:169-205`, `bubbleParts/primitives.tsx:22-31`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Кап ширины бабла | `--max-width: 85%` И `--max-width: 30rem` (480px) в не-broadcast чате (`_chat.scss:1337-1341`; wrapper: `min(var(--max-content-width,100%), var(--max-width))` `_chatBubble.scss:3229`) | только `max-width: 85%` (от колонки 688px ≈ 585px) — **кап 30rem ОТСУТСТВУЕТ**, длинные баблы шире оригинала | **P1** |
| min-width контента | 56px (`:359`) | 56px (textBubble) — но только у текстового | P2 |
| Радиусы | 15/5 через 4 CSS-переменные `--border-*-radius`; in: SS=5,SE=15,EE=15,ES=5; group-first → SS=15; group-last+tail → ES=0 (`:3354-3395`) | `bubbleRadius()` — та же математика 15/5/0, но инлайн-строкой ✓ | — |
| `with-reply-markup` → нижние радиусы бабла = 5px (`:2282-2285`) | есть | ОТСУТСТВУЕТ | P2 |
| Отступ между баблами | `$bubble-margin: .125rem` (2px), конец группы `$bubble-margin-big: .375rem` (6px) | `--row-mb` 2px/6px ✓ | — |
| box-shadow | `0 1px 2px 0 rgba(16,35,47,.15)` (`:365`) | `var(--bubble-box-shadow)` — токен (сверить значение) | P2 |
| Паддинги | у `.bubble-content` паддинга НЕТ; отступы = margin детей (`.message: 4px 8px 5px`) | текст/медиа — margin-модель ✓; `fileBubble`/`contactBubble` — ещё `padding` (признано в комментарии `MessageBubbles.module.scss:24-27`) | P1 |
| `.name` + `.message` слитно | `.next-is-message { margin-bottom: -4px }` (`:1167-1169`) → зазор 0 | зазор 4px | P2 |
| `mt-shorter/mb-shorter` (−2px при медиа над/под текстом, `:1150-1156`) | есть | `.mediaCaption` захардкожен — частично | P2 |
| Отступ входящих в группе под аватар | `margin-inline-start: 2.875rem` (46px) на wrapper (`_chat.scss:1311-1316`) | `.groupAvatarCol` 40px + gap 10px = 50px | P2 |

### 4.3 Хвост (tail)

tweb: `generateTail()` — `svg viewBox="0 0 11 20" > use[href=#message-tail-filled]` (`chat/utils.ts:43-62`), append последним ребёнком `.bubble-content`; CSS `_chatBubble.scss:2089-2106, 3372-3390, 3494-3512`: скрыт по умолчанию, показывается только `.can-have-tail.is-group-last`; `width:11 height:20; z-index:-2; fill: var(--message-background-color); transform: translateY(1px) scaleX(var(--reflect))`; in: `margin-inline-start:-8.4px`; out: `inset-inline-end:-8.4px` + зеркало.

У нас: `bubbleParts/primitives.tsx:38-59` — тот же path/размеры/−8.4px/translateY(1px), но path инлайном (не `<use>`), z-index:0 (`MessageBubbles.module.scss:8-16`), цвет пропом.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Условие показа | `can-have-tail && is-group-last`; canHaveTail=false у sticker (`bubbles.ts:9029`), emoji-big (`:7533`) и пр. | рисуем при `lastInGroup` у text/media/voice/poll/gift; у sticker/bigEmoji/round — не рисуем. Совпадает по сути ✓ | — |
| z-index | `-2` (под контентом бабла) | `0` + контент выше — работает, но у медиа хвост в НЕ клипающем внешнем диве (компромисс, эквивалент) | P2 |
| Тейл — часть `.bubble-content` (наследует fill при hover replies-footer `:2175-2177`) | есть | цвет захардкожен пропом `var(--b-bg)` — hover-связки нет | P2 |

### 4.4 Время + статус (Time.tsx)

tweb: `messageRender.ts:209-393` (структура: `span.time > [части ×1 скрытые] + div.time-inner > [клоны]`), CSS `_chatBubble.scss:1713-1860`. Наш: `bubbleParts/Time.tsx`, `Time.module.scss`.

Совпадает: двойной рендер (распорка + `.inner` absolute), `visibility:hidden`, `float:right`, `height/font-size = --messages-time-text-size`, `bottom:-1px`, `.status { order:5; font-size: calc(text+3px); color: --message-status-color }`, `is-floating` пилюля (высота fs+6px, radius .75rem, bottom/right .1875rem, `--message-time-background`), `sticker/emoji-big → bottom:0;right:0`, `.audio bottom:-3px`, `.poll right:8px bottom:5px`, `plain → order:100; margin-top:.125rem` при реакциях, `clearfix { display:table }`, `has-webpage → float:none`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| `margin-inline-start: 5px` | у **`.bubble.is-in .time`** (`:3411-3413`); base = .1875rem | у нас наоборот: `.out { margin-inline-start: 5px }` (`Time.module.scss:196-202`) — сторона перепутана | P2 |
| `title` (полная дата + Edited/Original) на `.time-inner` (`messageRender.ts:257-260, 351`) | есть | проп `title` есть, но **никогда не передаётся** из `MessageContent.tsx:170-185` → тултипа нет | P1 |
| Состав частей | pinned-иконка, edited, views(+иконка), post-author, effect (стикер 12×12), repeat, dice-stake, replies-счётчик (`time-replies`, order:-1) | edited, views, **forwards-счётчик — ОТСЕБЯТИНА** (tweb показывает shares только в тултипе, `:281-283`), TTL-таймер секреток (своя фича), effect — эмодзи-`<button>` вместо стикера. Нет: pinned, post-author, time-replies | P1 |
| Порядок edited перед views | `:297-299` | совпадает ✓ | — |
| `.time-inner { padding: inherit }` | есть (`:1779`) | есть ✓ | — |
| edited скрывается при `editedPrimary` | `:246-255` | ОТСУТСТВУЕТ | P2 |
| `is-block` для RTL (`bubbles.ts:7634-7636`) | есть | mode `block` есть, триггер только по pre/blockquote, RTL-детекта нет | P2 |
| `with-replies … .time.is-floating { bottom: 53px }` (`:1870-1872`) | есть | ОТСУТСТВУЕТ | P2 |

### 4.5 Имя автора, peer-color, rank

tweb: `.name` — `margin: 4px 8px 0; font-weight:bold!important; color: rgb(var(--peer-color-rgb,…))` (`_chatBubble.scss:1991-2006`). Имя **всегда в DOM**, скрывается CSS (`:663-671`). Цвет — peer-палитра: `setPeerColorToElement` (`peerColors.ts:7-63`) пишет `--peer-color-rgb` и `--peer-border-background` **на сам `.bubble`** (`bubbles.ts:9313-9321`). Rank: `.bubble-name-rank` (`bubbles.ts:9600-9633`).

У нас: `MessageContent.tsx:443-452` — `<Text size=secondary weight={600} color={m.senderColor ?? peerColor(m.sender)}>`, рендер только при `!out && firstInGroup`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Система CSS-переменных `--peer-N-color-rgb` / `--peer-border-background` на бабле (тянет цвет в reply-полосу, monospace, view-кнопки) | есть | ОТСУТСТВУЕТ — точечные inline-цвета из JS-хэша | P1 |
| Имя у forwarded в каждом бабле группы | есть | forward-блок на каждом сообщении — совпадает ✓ | — |
| `font-weight: bold` у имени | bold (700 у tweb здесь `!important` bold) | 600 | P2 |
| Rank («админ», boosts), scam/fake бейджи | есть | ОТСУТСТВУЕТ | P2 |
| via bot (`.is-via`, `:9520-9532`) | есть | ОТСУТСТВУЕТ | P2 |

### 4.6 Аватар серии (группы)

tweb: `.bubbles-group-avatar-container` absolute inset:0 column-reverse; аватар size 40 (`bubbleGroups.ts:142`), `position: sticky; top: 0; bottom: calc(var(--chat-padding-bottom) + 3px + .25rem)` (`_chatBubble.scss:45-88`) — липнет к низу вьюпорта над инпутом, transition bottom.

У нас: `ChatFeed.module.scss:119-133` — колонка 40px, `position: sticky; bottom: 72px` (хардкод «над композером»).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Механика sticky | top:0 **и** bottom одновременно, контейнер column-reverse absolute | только bottom, обычная колонка — работает, но bottom захардкожен (не следит за высотой инпута `--chat-padding-bottom`) | P1 |
| Анимация аватара в selection (scale .76 + сдвиг 2.5rem, `_chat.scss:1201-1203`) | есть | ОТСУТСТВУЕТ | P2 |
| Клик по аватару → peer | есть | есть ✓ | — |

### 4.7 Reply внутри бабла

tweb DOM (`wrappers/reply.ts:30-45`, `chat/replyContainer.ts`): `.reply.quote-like.quote-like-hoverable.quote-like-border[.quote-like-icon]` > `.reply-content > [.reply-media 32×32 float] + .reply-title + .reply-subtitle`. CSS: `_quote.scss:3-56` (фон `rgba(peer,.1)`, radius .25rem, полоса-`:before` .1875rem фоном `--peer-border-background`, hover `.2` + **ripple**, иконка цитаты absolute справа сверху), `_chatPinned.scss:105-241` (font 14, min-height `calc(fs*2+.875rem)`), `_chatBubble.scss:1039-1043` (в бабле `margin: 0 8px .5rem`), `:2074-2081` (`hide-name`/не-group-first → `margin-top: 8px`).

У нас: `MessageContent.tsx:461-484` + `MessageRow.module.scss:219-237` — `margin: 0 8px .5rem` ✓, но `padding 4px 8px; border-radius 6px; border-left 3px; фон withAlpha(...,0.12); flex-row gap 6px; thumb 34px`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Радиус | .25rem (4px) | 6px | P2 |
| Полоса | `:before` c `--peer-border-background` (градиенты collectible) | `border-left` inline-цветом | P2 |
| Альфа фона | .1 (hover .2) | .12, **hover нет, ripple нет** | P1 |
| Иконка цитаты | absolute top-right (`_quote.scss:40-55`) | inline после имени | P2 |
| `margin-top: 8px` когда нет имени над reply | есть (`:2074-2081`) | ОТСУТСТВУЕТ — reply прилипает к верху бабла | P1 |
| thumb 32×32, radius .125rem, float | есть | 34×34, 4px, flex | P2 |
| Reply у медиа-баблов / floating-плашка `.name-with-reply` над just-media (`:1094-1124`) | есть | ОТСУТСТВУЕТ | **P0** (см. §4.1) |

### 4.8 Forwarded / via

tweb (`bubbles.ts:9410-9496`): i18n-строка `ForwardedFrom` в `.name` → `.bubble-name-forwarded` (normal weight, вложенный `.peer-title` bold) + **аватар 20px** (`:9440-9450`) + `<br class=hide-ol>`; двойной заголовок `name-first-line`; `colored-name` вариант.

У нас (`MessageContent.tsx:453-460`): два `<Text>` («Forwarded from» 13px + имя 14px/600), `margin: 0 8px 2px`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Аватар 20px рядом с именем | есть | ОТСУТСТВУЕТ | P1 |
| Расположение — внутри `.name` (margin 4px 8px 0) | есть | отдельный див `margin: 0 8px 2px` — сверху нет 4px | P2 |
| via bot | есть | ОТСУТСТВУЕТ | P2 |

### 4.9 Сервисные сообщения и дата-разделители

tweb: `.bubble.service > .bubble-content-wrapper > .bubble-content > .service-msg` (`bubbles.ts:6723-6728`); CSS `_chatBubble.scss:3232-3307`: `.service-msg { color:#fff; background: var(--message-highlighting-color); font-size: 15px; padding: .28125rem .625rem; line-height: fs+5 }`, ссылки/`peer-title` внутри — bold, hover underline.

У нас (`ChatFeed.tsx:69-80, 202-215`, `ChatFeed.module.scss:16-110`): `.dayPill` sticky + `.pill` — padding/radius/размеры 1:1, клик в пикер есть.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Sticky-дата скрывается после остановки скролла | есть (см. §3.6) | ОТСУТСТВУЕТ | P1 |
| `service-msg` hover | нет hover на фоне (только ссылки) | `serviceMsg:hover` затемняет фон — **ОТСЕБЯТИНА** (`ChatFeed.module.scss:85-90`) | P2 |
| bold-ссылки/peer-title внутри сервисного текста | есть | plain-текст | P2 |
| Плашка Unread (`.is-first-unread::before`, `:238-266`) | height 30, lh 2.1, bold 15, bg surface, width 200vw, mb 3px | `unreadDivider` — 1:1 кроме width 100vw ✓ | — |

### 4.10 Иконки статуса (галочки)

tweb `sendingStatus.ts:24-56` — `sending / check / checks / sendingerror`, класс `sending-status-icon`; смена read-статуса **анимируется** (transition-item). У нас `Time.tsx:134-139` — те же 4 иконки, но смена sent→read без анимации (P2).

### 4.11 Highlight, selection, ripple, hover-реакция

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Highlight при переходе | `::after` (100vw, z-index:-1) цветом `--message-highlighting-color`, `@keyframes bubbleSelected` 0→1(25%)→0, 2s linear (`_chatBubble.scss:6-18, 193-236`; рестарт через reflow `bubbles.ts:4765-4778`) | `.band` (100vw) цветом `primary 30%`, framer opacity [0,.5,.5,0] times [0,.12,.5,1] 2s — цвет и кривая другие | P1 |
| Selection-полоса | тот же `::after`, `fade-in-opacity .2s` | `.band` fade .2s ✓ | — |
| Чекбокс | absolute `inset-inline-start:0; bottom:.3125rem` (`:306-337`) | left:4px bottom:5px — близко | P2 |
| Сдвиг входящих | `translateX(2.5rem)` = 40px, transition `--bubble-transition-in/out` на `.bubble-content-wrapper` | `translateX(34px)`, та же кривая, на `.zone` | P2 |
| Отключение pointer-events у медиа/ссылок в selecting (`:339-355`) | есть | частично | P2 |
| Ripple | на reply (quote-like-hoverable), replies-footer, reply-markup кнопках | ОТСУТСТВУЕТ везде | P1 |
| Ховер-quick-reaction `.bubble-hover-reaction` (кружок 1.875rem у края бабла, scale .8→1, `:414-450`) | есть | ОТСУТСТВУЕТ | P1 |
| Beside-кнопки (`forward`/`goto-original`, 2.375rem, за баблом, `:533-579`) | есть | ОТСУТСТВУЕТ | P2 |

### 4.12 Анимация появления (ladder / новое сообщение)

tweb: `.can-zoom-fade { transition: var(--bubble-transition-in) } .zoom-fade { scale3d(.8,.8,1); opacity:0 }` (`_chatBubble.scss:3210-3224`), `transform-origin: var(--transform-origin-left/right-center)`; ladder — задержки `idx*40ms` (10ms при дозагрузке) через `transition-delay` на **`.bubble-content-wrapper`** + отдельный аватар (`bubbles.ts:10360-10460`); **новое живое сообщение тоже проходит `animateAsLadder`** (`bubbles.ts:10908-10912`).

У нас: `BubbleAppear` (`animations/bubbleAnimations.tsx:102-137`) — scale .8→1 + opacity, .3s, кривая совпадает ✓; шаг 0.03s (`ChatFeed.tsx:224`), origin `bottom left/right`, анимируется весь row.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Живое новое сообщение анимируется | да | **нет** — `ladderActive=false` для live-append → бабл появляется рывком | **P1** |
| Шаг каскада | 40ms (10ms дозагрузка) | 30ms, кэп 12 элементов (кэп — отсебятина, но разумный) | P2 |
| transform-origin | left/right **center** | bottom left/right | P2 |
| Объект анимации | content-wrapper (полоса highlight/чекбокс не скейлится) | весь row | P2 |

### 4.13 Rich text: entities

tweb: `_markup.scss`, `wrapRichText.ts:267-330, 794-818`, `.code` (`base.scss:1979-2041`), `.quote` (`_quote.scss:124-146`), `.spoiler` (`_spoiler.scss`), `.monospace-text` (`_markup.scss:59-66`; цвет `rgb(var(--peer-color-rgb))` у in / `--message-time-color` у out, `_chatBubble.scss:3433-3435, 3670-3672`), `.bubble .anchor-url { text-decoration: underline }` (`:1970-1972`).

У нас: `RichText.tsx` / `RichText.module.scss`, `CodeBlock.tsx/.module.scss`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| **blockquote** | `.quote.quote-block.quote-like.quote-like-border.quote-like-icon`: фон `rgba(peer,.1)`, radius 4px, полоса 3px peer-цветом, иконка цитаты в углу, padding `1px .5625rem 1px 1.125rem`, font secondary; **сворачивание до 3 строк** + стрелка-экспандер (`_quote.scss:57-106`) | `border-left: 3px solid currentColor; opacity:.92; padding-left:8px` — нет фона, нет иконки, нет коллапса, цвет не peer | **P0** |
| **pre (код)** | контейнер `.quote-like.quote-like-border.code`: фон peer .1 + полоса, `.code-header` (фон `rgba(primary,.2)`, имя языка bold, круглая кнопка копирования) + `.code-code` padding .25rem .625rem, line-height fs+5; ночью фон rgba(0,0,0,.8) | свой `CodeBlock`: radius 10px, серый фон, header с border-bottom, шрифт .92em — вся стилистика другая | P1 |
| **inline code** | `.monospace-text` — только моноширинный + **акцентный цвет**, без фона; клик = копировать | серый фон-подложка `rgba(127,127,127,.16)`, radius 4, padding — **ОТСЕБЯТИНА** | P1 |
| **spoiler** | фон `--spoiler-background-color`, текст `opacity:0`, раскрытие transition .4s + canvas-«пыль» (`createMessageSpoilerOverlay`) | `filter: blur(5px)` + `background: currentColor` — другой визуал | P1 |
| **links** | в бабле подчёркнуты ВСЕГДА | underline только на hover (`RichText.module.scss:6-21`) | P1 |
| bold | `font-weight: bold` (700) | 600 | P2 |
| custom emoji | размер `--messages-custom-emoji-size` = text+4px | 1.2×fontSize (≈19 против 20) — близко | P2 |
| Автолинки @/#/URL | `anchor-url`/`mention` — реальные обработчики | span-подсветка без действия — клика нет | P2 |

### 4.14 Реакции + время (связка)

Портирована верно: `appendBubbleTime` → время переезжает в reactions-элемент (`bubbles.ts:9855` ↔ `MessageContent.tsx:189-230`), `plain`-режим (`:2261-2269`) ✓, `is-message-empty` → реакции наружу с `margin-inline-start:auto` (`:3549-3573`) — `.emptyMediaCol` ✓. Инверсия chosen-чипа у out-empty есть ✓.

### 4.15 Группировка сообщений

tweb `bubbleGroups.ts:360, 583-598`: тот же автор + тот же день + **Δt ≤ 121s** + одинаковый in/out. У нас `ChatFeed.tsx:108-123`: 1:1 ✓. Альбомная агрегация — есть ✓.

### 4.16 Итог домена

- **P0**: (1) reply/имя/forwarded не рендерятся ни в одном не-текстовом бабле (медиа/voice/документ/альбом) — в tweb это универсальные части `.bubble-content` + floating-плашки над just-media; (2) blockquote — полностью другой визуал (нет фона/иконки/коллапса).
- **P1**: кап ширины 30rem; отсутствие анимации появления живого сообщения; отсутствие hover-quick-reaction и ripple; peer-color система переменных; ссылки без постоянного underline; spoiler-блюр вместо tweb-модели; inline-code с фоном; reply без hover и без `margin-top:8px`; тултип полной даты у времени; forwards-счётчик в time — отсебятина; аватар серии не привязан к высоте инпута; highlight-цвет/кривая.
- **P2**: сторона `margin-inline-start:5px` у времени; `next-is-message` −4px; сдвиг selection 34 vs 40px; radius reply 6 vs 4; bold 600 vs 700; шаг каскада и transform-origin; `with-reply-markup` радиусы; via bot/rank/pinned/post-author; hover сервис-пилюли (отсебятина); анимация sent→read.

Направление фикса: перевести все типы баблов на единый каркас `bubbleWrap(.bubble-content-wrapper) > bubbleContent`, куда `name/forward/reply/tail/время` вставляются одинаково (как `nameContainer` в `bubbles.ts:9337-9598`), ввести peer-color переменные на row (`--peer-color-rgb`), и добить quote/pre/spoiler по `_quote.scss`/`base.scss .code`/`_spoiler.scss`.

---

## 5. Медиа-баблы и документы

**Резюме:** алгоритм раскладки альбома портирован 1:1 (проверено diff-ом по числовым константам), документ-иконка и floating-время близки к оригиналу. Главные системные расхождения: (1) неверный медиабокс 320×420 вместо tweb 420×400/340×340 и полное отсутствие min-size-логики `setAttachmentSize` (200/320/120/368), (2) видео в бабле вообще не воспроизводится инлайн (tweb автоплеит ≤50 МБ), (3) бейдж `.video-time` не в том углу и не тех размеров, (4) нет media-spoiler, стриминг-прелоадера, aspecter-слоя, invoice.

### 5.1 Расчёт размеров фото/видео (медиабокс)

Референс: `tweb/src/helpers/mediaSizes.ts:64-101`, `setAttachmentSize.ts:9-12,64-94`, `calcImageInBox.ts:11-35`.
Наш код: `messages/RealMediaBubble.tsx:29-30,115`, `core/dom/calcImageInBox.ts` (порт 1:1 ✓), `SecretMediaBubble.tsx:20-21`.

tweb: `size.aspect(box, noZoom)` → затем **три** min-коррекции (`setAttachmentSize.ts:69-94`):
1. обе стороны < 200 (`MIN_SIDE_SIZE`) → `aspectCovered(200×200)`;
2. есть текст/reply/webpage → ширина ≥ 320 (`EXPAND_TEXT_WIDTH`), ставится `isFit=false`;
3. ширина < 120 (`MIN_IMAGE_WIDTH`) / для видео с плеером < 368 (`MIN_VIDEO_SIDE_SIZE`) → расширение, `isFit=false`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Бокс desktop | `regular` **420×400** (`mediaSizes.ts:84`) | **320×420** (`BOX_W/BOX_H`) — и ширина, и высота не те, высота больше ширины | **P0** |
| Бокс mobile (≤600px) | 340×340 (`mediaSizes.ts:66`) | нет брейкпоинтов вовсе | P1 |
| Мин. сторона 200 (aspectCovered) | есть | ОТСУТСТВУЕТ — маленькое фото рендерится в натуральную величину | P1 |
| Расширение до 320 при подписи/reply | есть (`EXPAND_TEXT_WIDTH`) | ОТСУТСТВУЕТ — узкое фото с длинной подписью даёт узкий бабл | P1 |
| Мин. ширина 120 / видео 368 | есть | ОТСУТСТВУЕТ | P1 |
| `calcImageInBox` | — | порт 1:1 ✓ (+наш fallback `boxW×3/4` — допустимая отсебятина) | — |
| CSS-клампы `.attachment` | `max-width: min(420px,100%); max-height: min(400px,100%); width: max-content` (`_chatBubble.scss:888-895`) | `.media { max-width: min(420px,100%) }` — max-height нет | P2 |

Фикс: завести аналог `mediaSizes` (420×400 desktop / 340×340 handhelds) и портировать `setAttachmentSize` целиком; BOX_W/BOX_H убрать.

### 5.2 Структура wrapPhoto: aspecter / thumbnail / blur-подложка

Референс: `wrappers/photo.ts:102,134-180,189-203,283-290`; `_chatBubble.scss:864-882`.

```
tweb (isFit=false, фото уже бабла):
.attachment.media-container.media-container-fitted   ← ширина 320+
├─ img.media-photo.thumbnail (blur(url,10,2,48) — «матовое стекло» на всю ширину, opacity .8)
└─ .media-container-aspecter (точный размер фото, margin 0 auto, z-index 1)
   ├─ img.media-photo (stripped-thumb с blur)
   └─ img.media-photo (полное фото, fade-in)
```

```
у нас (RealMediaBubble.tsx:156-224):
div.media (inline width/height из calcImageInBox, background-image: lqip)
├─ div.shimmerWrap > div.shimmer      ← пока не загрузилось
└─ img.img (absolute inset 0, object-fit cover)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Слой aspecter + размытая боковая подложка | есть | ОТСУТСТВУЕТ (следствие отсутствия EXPAND_TEXT_WIDTH) | P1 |
| Blur-превью | stripped-thumb как `<img>/<canvas>` в DOM | CSS `background-image` base64 — приемлемый аналог | P2 |
| Fade-in полного изображения | `renderMediaWithFadeIn` | нет фейда; вместо него **shimmer-градиент** — ОТСЕБЯТИНА (в tweb шиммера нет) | P2 |
| Фон attachment | `#000` для фото/видео вне альбома (`:2070-2072`) | `rgba(127,127,127,.16)` | P2 |
| Рамка 1px цвета бабла | `border: 1px solid var(--message-background-color)` (`:2108-2113`) | `.framed { padding: 1px }` + фон `--b-bg` — визуальный эквивалент ✓ | — |

### 5.3 Видео: инлайн-воспроизведение, nosound, остаток времени

Референс: `wrappers/video.ts:50,129-176,406-408,550-579`.

tweb: видео ≤ 50 МБ (`MAX_VIDEO_AUTOPLAY_SIZE`) **автоплеится в бабле** — `<video muted loop autoplay>` внутри aspecter; в бейдже иконка `nosound`; на `timeupdate` бейдж показывает **остаток** `duration - currentTime`; play-кнопка только когда автоплей нельзя.

У нас (`RealMediaBubble.tsx:210-221`): видео = статичный `<img>` (thumb) + play-диск, воспроизведение только в лайтбоксе. `<video>` инлайн — только для GIF-like.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Автоплей muted-loop ≤50 МБ | есть | ОТСУТСТВУЕТ | **P0** |
| Иконка nosound в бейдже | есть | ОТСУТСТВУЕТ | P1 |
| Остаток времени на бейдже при игре | есть | нет (статичная длительность) | P1 |
| Стриминг-прелоадер (некликабельный, гаснет на canplay) | `preloader-streamable` (`video.ts:524-529,602-610`) | ОТСУТСТВУЕТ | P1 |
| GIF-путь | автоплей + бейдж (`video.ts:120-123,164-171,708-713`) | автоплей `<video>` + бейдж ✓; blur+download при `autoDownload.video===0` ✓ | — |

### 5.4 Бейдж длительности / GIF (`.video-time`)

Референс: `_chatBubble.scss:1883-1928`. Наш: `RealMediaBubble.module.scss:80-88` (`.badgeTL`), `AlbumGrid.module.scss:62-69` (`.durBadge`).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Позиция | **top: 3px; left: 3px** | 8px/8px (одиночное), 4px/4px (альбом) | P1 |
| Высота/паддинг | `height: calc(var(--messages-time-text-size) + .375rem)`; `padding: 0 6px` | `padding: 2px 6px` / `1px 6px` | P2 |
| Радиус | `border-radius: var(--height)` (полная пилюля) | 10px / 9px | P2 |
| Фон | `var(--message-time-background)` | `rgba(0,0,0,.45)` хардкод | P2 |
| Шрифт | `var(--messages-time-text-size)` | 12 / 11.5 / 11 (GIF ещё и letter-spacing — отсебятина) | P2 |
| `&.other-side` (правый верх) | есть (`:1924-1927`) | нет | P2 |

Фикс: единый компонент «video-time» с tweb-метриками для RealMediaBubble и AlbumGrid.

### 5.5 Кнопка play

Референс: `video.ts:173-176` (btn-circle 54px, icon largeplay), `_button.scss:1181-1184`, `_chatBubble.scss:1974-1983` (bg `--message-time-background`, font-size 2.125rem).

У нас: `.playDisc` 54px, иконка 34px ✓, фон `rgba(0,0,0,.45)` хардкод (P2). В альбоме диск 44px (tweb не уменьшает — 54) — P2.
**Поведение:** tweb прячет play при видимом прелоадере (`_chatBubble.scss:838-842`); у нас при аплоаде видео рендерятся **оба** оверлея — кольцо и play-диск одновременно (`RealMediaBubble.tsx:194-216`) — P1.

### 5.6 Прогресс загрузки/аплоада (ProgressivePreloader ↔ RadialProgress)

Референс: `preloader.ts:96-97,296-310`, `_preloader.scss:30-56,98-133,153-192`. Наш: `RadialProgress.tsx`, `RadialProgress.module.scss`.

tweb SVG: `viewBox="27 27 54 54"`, `r=24`, stroke **2**, dasharray `max(5, %) , 149.82`; контейнер 54×54, диск `rgba(0,0,0,.3)`, `rotate 2s linear infinite`, появление `opacity+scale(0→1) .2s`; внутри крест `preloader-close` (56%) / стрелка `preloader-download` для manual-режима.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Геометрия svg | r=24, stroke 2 | r=23.85, stroke **2.5** | P2 |
| dasharray max(5,…) / rotate 2s / transition .2s | есть | есть ✓ | — |
| Появление scale(0)→scale(1) | есть | ОТСУТСТВУЕТ | P2 |
| Manual-режим (стрелка download) | есть | play-диск с иконкой download — приемлемый аналог, DOM другой | P2 |
| Крест отмены внутри кольца | 56% контейнера | `TgIcon close` 24px поверх | P2 |
| Прелоадер только для фото ≥150px (`canAttachPreloader`) | есть | нет гейта | P2 |
| streamable-вариант (r=19, stroke 2.5, квадрат-стоп) | есть | ОТСУТСТВУЕТ | P1 |

### 5.7 Альбомы

Референс: `groupedLayout.ts` (весь), `prepareAlbum.ts:13-70`, `wrappers/album.ts:53-61,122-148`, `_chatBubble.scss:908-975`.
Наш: `core/dom/groupedLayout.ts` (**порт 1:1, числа совпадают** ✓), `AlbumGrid.tsx`, `AlbumGrid.module.scss`.

```
tweb: .attachment (width/height px)            у нас: div.grid (width/height px) ✓
├─ .album-item.grouped-item (abs, %, углы:     ├─ div.item (abs, % ✓; углы не задаются,
│    calc(var(--border-*-radius) - spacing))   │    клип контейнером overflow:hidden)
│  └─ .album-item-media                        │  └─ img.img (без обёртки-media)
│     └─ img/video.media-photo + .video-time   │  + .durBadge/.play/.check
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Алгоритм Layouter/ComplexLayouter | tdesktop-порт | 1:1 ✓ | — |
| maxWidth | `mediaSizes.active.album.width` = **420**/340 (`album.ts:56`) | **320** (`AlbumGrid.tsx:19`) | **P0** (вместе с §5.1) |
| maxHeight | не передаётся → = maxWidth (420) | 420 при maxWidth 320 — соотношение бокса не tweb-овское | P1 |
| spacing | **1** (`album.ts:58`) | **2** (`AlbumGrid.tsx:22`) | P1 |
| minWidth | 100 | 100 ✓ | — |
| Клам ширины CSS | `.is-album .attachment { max-width: min(451px,100%) }` | ✓ (но layout всё равно 320) | — |
| Углы угловых элементов | per-item `calc(radius - spacing)` (`prepareAlbum.ts:43-57`) | только клип контейнера | P2 |
| Фон элемента | `--message-highlighting-color` (`:917`) | нет (только lqip) | P2 |
| Спойлер на элементе альбома | `wrapMediaSpoiler` (`album.ts:122-148`) | ОТСУТСТВУЕТ | P1 |
| GIF в альбоме | автоплеится | всегда статичный `<img>` | P2 |
| Чекбокс выделения | top/right .5rem (`:939-944`) | top/right 6px + drop-shadow (отсебятина-тень) | P2 |

### 5.8 Круглые видео (round)

Референс: `video.ts:220-256,282-303`, `base.scss:120,215,1334-1369`, `_chatBubble.scss:797-811`, `progressRing.tsx:32-34`.
Наш: `bubbleParts/mediaBubbles.tsx:116-223`, `MessageBubbles.module.scss:286-343`. (Детальный разбор — §6.4.)

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер | **280** desktop / 240 mobile (`--round-video-size`) | 240 всегда | P1 |
| Кольцо | всегда в DOM, stroke 3.5, фон-дуга opacity .3, r=size/2−7 | только при `progress>0`, stroke 2, без подложки | P1 |
| Бейдж | `.video-time` top 3 left 3, bg `--message-highlighting-color` | top 10 left 14, bg rgba(0,0,0,.35) | P2 |
| Unread-точка `.5rem` | есть | 8px ✓ | — |
| nosound при паузе / остаток при игре | есть | есть ✓ | — |
| canvas-отрисовка кадров | есть (круглая маска) | `border-radius: 50%` — допустимый аналог | — |

### 5.9 Документы / файлы

Референс: `wrappers/document.ts:154-271,311-338`, `_document.scss`. Наш: `RealMediaBubble.tsx:258-355`, `RealMediaBubble.module.scss:107-245`, `SecretMediaBubble.tsx:104-131`.

```
tweb: .document.ext-pdf[.document-with-thumb][.downloading|.downloaded]  (height 70px; padding-left = 54+14)
├─ .document-ico (54×54 abs; :after — загнутый уголок; span.document-ico-text = ext)
│    └─ (with-thumb: img.document-thumb 54×54)
├─ .document-download (слой поверх иконки; preloader 40×40 stroke 2.5)
├─ .document-name (middle-ellipsis, font 16, weight 500)
└─ .document-size ("X / Y" при downloading; joiner ' · ' c датой)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Иконка 54×54, radius .375rem, уголок :after 1.125rem | есть | есть ✓ (border-width 9px ✓, цвета ✓) | — |
| Цвета ext (pdf/zip/apk) | `#DF3F40/#FB8C00/#43A047` | 1:1 ✓ | — |
| Превью-иконка для pdf/изображений (`document-with-thumb`) | есть (`document.ts:178-207`) | ОТСУТСТВУЕТ — всегда цветная страница с ext | **P1** |
| Hover: уголок разворачивается, ext→стрелка | только у `:not(.downloaded)` (`_document.scss:70-84`) | всегда, даже после скачивания | P2 |
| Прогресс-кольцо | 40×40, stroke 2.5, на слое `.document-download` | 44px, замещает ext | P2 |
| Байт-прогресс «скачано / всего» | есть | есть ✓ | — |
| Имя: middle-ellipsis | `MiddleEllipsisElement` (обрезка в середине) | ellipsis в конце | P2 |
| Вес имени | 500 | 700 | P2 |
| Отступ иконка↔текст | `--icon-margin: .875rem`, высота строки 70px | gap 10px, padding 8px 10px | P2 |
| Автоскачивание по размеру | есть (`document.ts:419-421`) | нет порога | P2 |

### 5.10 Стикеры в баблах

Референс: `wrappers/sticker.ts:123-127`, `mediaSizes.ts:70-71,88-89` (**200×200** desktop, 180×180 handhelds; emojiSticker 112), `_chatBubble.scss:789-795`.
Наш: `MessageContent.tsx:110-130` (`STICKER_BOX=200` ✓), `:68` (`ANIMATED_EMOJI_SIZE=112` ✓).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Бокс 200×200 aspectFitted / emoji 112 | есть | есть ✓ | — |
| Мобильный бокс 180×180 | есть | нет | P2 |
| DOM: `.attachment` absolute + z-index 1 | есть | inline-block контейнер — упрощение, допустимо | — |
| Видео-стикеры webm | есть | есть ✓ | — |

### 5.11 Спойлер на медиа

Референс: `wrappers/mediaSpoiler.ts`, `base.scss:1706-1746` (`.media-spoiler-container`, DotRenderer-канвас с «частицами», reveal 250ms), альбом — `album.ts:122-148`.

**ОТСУТСТВУЕТ полностью** (спойлер есть только для текста). Медиа с флагом spoiler показывается открытым. — **P1**. Направление: контейнер поверх медиа (blur-канвас/thumb + анимированные точки), клик = reveal с fade.

### 5.12 Caption под медиа и время

Референс: `_chatBubble.scss:1134,1150-1156, 1866-1868, 759-773`, floating-время `:1818-1855`.
Наш: `MessageRow.module.scss:121-130`, `bubbleParts/Time.module.scss:115-183`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Отступы подписи | `margin: (4−2)px 8px 5px` | 1:1 ✓ | — |
| Floating-пилюля поверх медиа | bottom/right .1875rem, height time+.375rem, radius .75rem | 1:1 ✓ | — |
| `--message-time-background` для just-media | `--message-highlighting-color` | продублировано ✓ | — |
| Радиус бабла у медиа | `$bubble-border-radius-big` = **15px** | BUBBLE_R_BIG=15 ✓, но в `MessageContent.tsx:276,321,343` захардкожено **'14px 14px 0 0'/'14px'** — рассинхрон внутри собственного кода | P1 |

### 5.13 Веб-превью ссылок (webpage)

Референс: `wrappers/webPage.tsx:103-151`, `_chatBubble.scss:2695-2948`. Наш: `bubbleParts/richBubbles.tsx:23-82`, `MessageBubbles.module.scss:119-221`.

```
tweb: a.webpage.quote-like[.has-square-photo]
└─ .webpage-quote.quote-like-border
   └─ .webpage-content (padding .25rem .375rem) [.min-content → min-width 15rem]
      ├─ [media position=top] .webpage-preview-resizer > .webpage-preview (max 420×380, radius var(--border-radius))
      ├─ .webpage-name (цвет --primary-color)
      ├─ .webpage-title
      ├─ .webpage-text
      ├─ [media position=bottom] …; square-фото: resizer 3rem×3rem float inline-end
      └─ .webpage-footer (.is-button: высота 2.25rem, bold, БЕЗ рамки; .is-link → arrow_next -45°)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Большое фото: max 420×380, radius var(--border-radius), resizer | есть | `max-height: 180px`, radius 10px, всегда сверху | P1 |
| Маленькое квадратное фото 3rem float inline-end | есть | ОТСУТСТВУЕТ — любое фото на всю ширину | P1 |
| Позиция фото top/bottom (`invert-media`) | есть | нет | P2 |
| Футер-кнопка Instant View | `.is-button` — текст без рамки, height 2.25rem | `.ivButton` — рамка 1px, radius 8, height 32, «⚡» — ОТСЕБЯТИНА | P2 |
| Градиент-плейсхолдер с эмодзи | нет такого | ОТСЕБЯТИНА (осознанный fallback) | P2 |
| `.webpage + .time { float: unset }` | есть | есть ✓ | — |

### 5.14 Геолокация, контакт, invoice

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Гео-размер | `.geo-container` **372×262** desktop / 277×195 handhelds (`_chatBubble.scss:2960-2982`) | 277×195 всегда (мобильный размер на десктопе) | P1 |
| Live-пин | аватар отправителя + heading-сектор | иконка `livelocation` + красный бейдж «LIVE» — ОТСЕБЯТИНА | P2 |
| Карта | MTProto webfile | OSM-тайлы — вынужденный аналог ✓ | — |
| Контакт | `.contact` avatar 54 + details | ContactBubble avatar 54 ✓; паддинг-модель не через `.message` | P2 |
| Invoice (`bubbles.ts:8939-8985`, 320×320 / 420×400) | есть | ОТСУТСТВУЕТ как тип; наш paidMedia locked-оверлей — ОТСЕБЯТИНА по оформлению | P2 |

### 5.15 Итог домена

1. **P0** — медиабокс: портировать `mediaSizes` (420×400/340×340; album 420/340) + `setAttachmentSize` (200/320/120/368, aspecter с blur-подложкой); альбому maxWidth 420, spacing 1.
2. **P0/P1** — инлайн-автоплей видео ≤50 МБ (muted+loop+nosound, остаток в бейдже) + streamable-прелоадер.
3. **P1** — `.video-time` 3px/3px + единый компонент; спрятать play при активном прелоадере; media-spoiler; document-with-thumb; радиус 15px вместо '14px'-хардкодов; geo 372×262.
4. **P2** — stroke 2/r24 RadialProgress, scale-появление, фон attachment #000, hover документа, middle-ellipsis, spacing/углы альбома.

---

## 6. Voice/audio и плеер

Референс: `tweb/src/components/audio.ts`, `tweb/src/scss/partials/_audio.scss`, `_document.scss:191-264`, `_chatPinned.scss:492-660` (топбар-плеер), `appMediaPlaybackController.ts`, `rangeSelector.ts`/`mediaProgressLine.ts`.
Наш код: `messages/VoiceMessage.tsx` + `.module.scss`, `bubbleParts/mediaBubbles.tsx` (AudioBubble, RoundVideoRealBubble), `NowPlayingBar.tsx`, `core/audio/*`.

Что уже 1:1 (текущая ветка style/voice-bubble-parity поработала): геометрия и генерация waveform, clip-path play-иконка с размерами, `.audio-time` (7px/−1px/14px, `cur / total`), время бабла absolute bottom −3px, кнопка транскрибации с loader-обводкой, unread-точка (кроме цвета в out), высота плашки 48px, набор скоростей.

### 6.1 Voice message в бабле

Референс: `audio.ts:149-340` (wrapVoiceMessage), `:540-639` (render), `_audio.scss:3-659`, `_chatBubble.scss:1185-1249, 1630-1651`.
Наш код: `VoiceMessage.tsx`, `VoiceMessage.module.scss`, `core/audio/waveform.ts`.

DOM tweb:
```
<audio-element class="audio audio-48 is-voice [is-out] [is-unread] [can-transcribe] [downloading]">
  <div class="audio-toggle audio-ico">                ← 3rem (48px), absolute в left-колонке
    <div class="audio-play-icon">                     ← rotate(-119deg) ↔ -90deg
      <div class="part one"/> <div class="part two"/> ← 112px, clip-path морф
  <div class="audio-download"/>                       ← круговой прелоадер download/upload
  <div class="audio-waveform-container">              ← height 23px, margin-top 1px
    <div class="audio-waveform audio-waveform-background"><svg width=availW height=23>…<rect rx=1/>…</svg></div>
    <div class="audio-waveform audio-waveform-fake">  ← absolute, width = progress%, overflow hidden
  <div class="audio-time">0:07</div>                  ← idle: длительность; играет: «0:03 / 0:07»
  <div class="audio-to-text-button">…</div>           ← 2rem×1.5rem
  <span class="time"><div class="time-inner">…</div></span> ← absolute right:0 bottom:-3px
```

У нас (`VoiceMessage.tsx:152-190`): `.wrap > .voice(.playBtn + .body(.waveContainer + .time) + {time} + .transcribe) + {reactions} + TranscribedText` — структурно эквивалентно.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Кнопка play 3rem, absolute, `--message-primary-color` | ✓ | ✓ | — |
| Части play-иконки 112px | `_audio.scss:444-447` | `--play-part-size` = 112px ✓ | — |
| Waveform: bar 2px + gap 2px, h 4..23, availW = clamp(dur/60·256, 190, 256) (`audio.ts:83-147`) | ✓ | порт 1:1 (`waveform.ts:23-67`) ✓ | — |
| **Прогресс закраски** | rAF-цикл `animateSingle` на `play` + `throttleWithRaf` (`audio.ts:252-274`) → каждый кадр | ширина из `audioStore.currentTime` (пишется на `timeupdate`, ~4 Гц) → закраска **рывками** | **P1** |
| **Scrub по волне** | drag: mousedown → pause + scrub, mousemove → scrub, mouseup → play; click — только когда играет (`audio.ts:275-324`) | только click; drag ОТСУТСТВУЕТ; клик по волне idle-сообщения запускает воспроизведение (ОТСЕБЯТИНА) | **P1** |
| Hover по фоновым барам (`opacity:.3 → 1`, `_audio.scss:380-388`) | есть | ОТСУТСТВУЕТ | P2 |
| Прелоадер download/upload (`audio-download` + corner-download) | есть (`audio.ts:568-579, 667-791`) | ОТСУТСТВУЕТ полностью | P2 |
| Пустая waveform → фолбэк `MediaProgressLine` (min-width 11.25rem) | есть (`audio.ts:242-247`) | плоские PLACEHOLDER_PEAKS — ОТСЕБЯТИНА, визуально близко | P2 |
| Ширина бабла | `--max-content-width: 364px` (`_chatBubble.scss:1239-1240`) | `max-width: min(340px, 82%)` | P2 |
| `.audio-time` метрики | .875rem, lh 1, mt 7px, ml −1px; играет → `cur / total` | 1:1 ✓ | — |
| Цвет времени | в бабле `--message-status-color` | in: глобальный secondary; out: `--message-out-primary-color` | P2 |

### 6.2 Непрослушанная точка (unread)

Референс: `_audio.scss:594-609` + `audio.ts:47-54`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Точка после времени: .5rem, ml .375rem | ✓ | 1:1 ✓, но цвет — глобальный `--primary-color`, а не `--v-accent` → в out-бабле точка не в цвет | P2 |
| **Яркая волна у непрослушанного**: `.is-unread:not(.is-out) … .audio-waveform-bar { opacity: 1 }` (`_audio.scss:606-608`) | есть | ОТСУТСТВУЕТ — фон всегда 0.3 | **P1** |
| Снятие по media_read | есть | есть (`markMediaPlayed`) ✓ | — |

### 6.3 Music/audio-файл

Референс: `audio.ts:342-444` (wrapAudio), `mediaProgressLine.ts`, `_audio.scss:515-557, 612-658`, обложка `audio.ts:641-659`.
Наш код: `bubbleParts/mediaBubbles.tsx:46-78` (AudioBubble), `MessageBubbles.module.scss:19-71`.

DOM tweb:
```
<audio-element class="audio audio-48 [audio-with-thumb] [audio-show-progress]">
  <div class="audio-toggle audio-ico"> …play-icon… [img.audio-thumb 48×48] </div>
  <div class="audio-download"/>
  <div class="audio-details">
    <div class="audio-title"><middle-ellipsis-element>Title</middle-ellipsis-element></div>  ← bold, 1rem
    <div class="audio-subtitle">
      <div class="audio-time">3:45</div>
      <div class="audio-description"> • Performer • 4.2 MB</div>
      ← на play заменяется на .progress-line (audio-show-progress)
```
`.audio .progress-line`: `--height: 2px; --border-radius: 4px; --thumb-size: .75rem; margin: 0 6px 0 5px`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| **Воспроизведение музыки** | play/pause через appMediaPlaybackController, очередь музыки чата | **ОТСУТСТВУЕТ**: AudioBubble — статичный бабл, onClick не подключён вообще | **P0** |
| Кнопка | 48px круг с clip-path play-иконкой | 46px круг со статичной иконкой `music` | P1 |
| Прогресс-бар при игре (MediaProgressLine, thumb .75rem) | есть | ОТСУТСТВУЕТ | P0 (часть первого) |
| Обложка (`audio-with-thumb`: 48×48 + затемнение) | есть | ОТСУТСТВУЕТ | P2 |
| Title bold + MiddleEllipsis | есть | weight 500, CSS-ellipsis | P2 |
| Subtitle `время • исполнитель • размер` одной строкой | есть | title/artist/duration тремя строками — ОТСЕБЯТИНА | P1 |
| Ширина `.audio-message .audio { width: 335px }` | есть | `max-width: min(320px, 82%)` | P2 |
| Раскладка: padding-left под absolute-кнопку | есть | flex row c gap — другая модель | P1 |

Направление: переиспользовать VoiceMessage-инфраструктуру (playBtn/AudioPlayIcon + audioStore) + порт MediaProgressLine; очередь музыки — отдельная от voice (tweb `findMediaTargets`: музыка и voice/round не смешиваются).

### 6.4 Видео-кружок (round)

Референс: `wrappers/video.ts:220-408`, `progressRing.tsx`, `base.scss:120,215,1334-1369`, `_chatBubble.scss:1888-1928`.
Наш код: `bubbleParts/mediaBubbles.tsx:116-223`, `MessageBubbles.module.scss:286-343`.

DOM tweb:
```
<div class="media-round z-depth-1 [is-unread] [is-paused]">
  <canvas class="video-round-canvas"/>     ← кадры drawImage каждый кадр
  <span class="video-time">0:08 [icon nosound] [:before dot]</span>  ← top:3px left:3px
  <svg class="progress-ring" width=280 rotate(-90)>
    <circle stroke=white stroke-opacity=.3 stroke-width=3.5 r=(280/2−7)/>
  <video class="media-video [hide]"/>
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер | 280×280 desktop, 240 при низкой высоте | 240×240 всегда | P2 |
| Кольцо прогресса | stroke 3.5, r=size/2−7, opacity .3-подложка, обновление **каждый кадр**, живёт и на паузе | stroke 2 (≈4.8px в viewBox 100), opacity 1, только при progress>0, ~4 Гц → рывки | **P1** |
| Бейдж | top 3 left 3, bg `--message-highlighting-color`, показывает остаток; nosound 1.125rem при паузе | top 10 left 14, bg rgba(0,0,0,.35); остаток ✓, nosound 16px ✓ | P2 |
| Unread dot `.5rem` белая | есть | есть ✓ | — |
| Регистрация в глобальном плеере | через appMediaPlaybackController → топбар-плашка + очередь с voice | `playExternal` — плашка есть, очередь одиночная | P2 |
| **Общая очередь voice+round** | `findMediaTargets` selectors `.audio.is-voice, .media-round` (`audio.ts:466-469`) — voice перетекает в round и наоборот | очередь только `type === 'voice'` (`useVoiceQueue.ts:35-36`) | **P1** |
| Поведение ended | вернуть превью, время = длительность, `is-paused` | muted-loop превью — эквивалент ✓ | — |

### 6.5 Глобальный топбар-плеер

Референс: `chat/audio.tsx` (createChatAudio), `_chatPinned.scss:492-660`, `--topbar-audio-height: 3rem`, `playbackRateButton.ts`, volumeSelector.
Наш код: `NowPlayingBar.tsx`, `NowPlayingBar.module.scss`.

DOM tweb (плоская докованная плашка):
```
<div class="pinned-container pinned-audio [is-visible]">
  <div class="pinned-container-body">
    btn-icon fast_rewind | btn-icon play/pause | btn-icon fast_forward
    <div class="pinned-container-content hover-effect">   ← клик = переход к сообщению
      title (bold 14) / subtitle: "00:07 • date|performer"
    <div class="pinned-audio-wrapper-utils">
      volume-btn (hover → вертикальный progress-line, до 200% для voice)
      playbackRate-btn (иконка playback_05/1x/15/2x + btn-menu)
      repeat-btn (round → loop → off; скрыт для voice/round)
      close-btn
  <div class="pinned-audio-progress-wrapper"> .progress-line (height .25rem, по всей ширине низа,
    translateY(.125rem) → 0 на hover, thumb скрыт, drag-scrub, буфер-слой) </div>
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Форма плашки | плоская на всю ширину чата, radius `$border-radius-big`, бордер снизу, слайд SetTransition 250ms | плавающая пилюля radius 24 + box-shadow, framer slide, offset 56px хардкодом | **P1** (визуальная отсебятина) |
| Кнопка play/pause | простая замена глифа | `PlayPauseGlyph` — framer cross-fade + rotate — ОТСЕБЯТИНА | P2 |
| Клик по title → переход к сообщению (`audio.tsx:151-181`) | есть | ОТСУТСТВУЕТ | **P1** |
| Rate-кнопка | иконка + меню; `active` при rate ≠ 1 | текст «1X» + Menu; active только при открытом меню | P2 |
| Repeat (round/loop) | есть для музыки | ОТСУТСТВУЕТ | P2 |
| Progress line | RangeSelector: drag, rAF-плавность, буферный слой `__loaded` | div 3px, только click-seek, без drag/буфера, 4 Гц | **P1** |
| Громкость | вертикальный слайдер, для voice/round до **200%** (WebAudio gain) | 0..100%, буста нет | P2 |
| Subtitle-время | «00:07» (ведущий ноль) | `0:07` | P2 |
| Скрытие по окончании очереди | `onEnded` → stop → плашка прячется | трек остаётся, плашка висит (`mediaPlaybackController.ts:179-181`) | **P1** |

### 6.6 Поведение воспроизведения

Референс: `appMediaPlaybackController.ts:830-849, 1006-1026, 152-156`, персист `appDialogsManager.ts:691-698` → `appSettings.playbackParams`.
Наш код: `core/audio/mediaPlaybackController.ts`, `stores/audioStore.ts`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Автопереход | к следующему voice **или** round в чате; музыка — отдельная очередь | очередь только voice из окна сообщений | **P1** |
| Скорости [0.5, 1, 1.5, 2] | ✓ | ✓ | — |
| **Хранение rate** | по типам `{voice, video, audio}` + персист в настройках | один `rate` in-memory на всё | **P1** |
| Volume/muted персист | да | нет | P2 |
| prev: `currentTime > 5` → restart | есть | порог 3s | P2 |
| MediaSession (кнопки ОС) | полный набор handlers (`:180-199`) | ОТСУТСТВУЕТ | P2 |

### 6.7 MediaProgressLine / RangeSelector

tweb: `rangeSelector.ts` (`.progress-line` + `__filled` + `input.__seek`), `mediaProgressLine.ts` (rAF-цикл, буфер `__loaded`, seek `duration − 0.1`), стили `_ckin.scss:270-407` (`--height 5px`, thumb `:after`, `is-focused` scale 1.125).
У нас: переиспользуемого компонента **НЕТ** — три независимые реализации (NowPlayingBar, волна VoiceMessage, ничего для музыки). Drag-scrub, thumb, буфер, focus-увеличение — ОТСУТСТВУЮТ везде. **P1**: завести один порт RangeSelector/MediaProgressLine.

### 6.8 PlayPauseGlyph

tweb: морф — два белых «парта» с анимируемым `clip-path` (полигоны) + доворот контейнера −119°→−90°, transition .25s ease-in-out (`_audio.scss:38-370`); в топбаре — мгновенная замена глифа.
У нас: `messages/AudioPlayIcon.tsx` — порт 1:1 ✓ (используется в voice-бабле). `components/PlayPauseGlyph.tsx` (framer cross-fade+rotate) — **ОТСЕБЯТИНА**, framer-motion и так на удаление. P2.

### 6.9 Итог домена

- **P0** — музыкальный бабл вообще не играет (нет onClick, прогресса, обложки).
- **P1** — рывковый прогресс voice-закраски и кольца кружка (нужен rAF-цикл); нет drag-scrub нигде; яркая волна непрослушанного; общая очередь voice+round; per-type + персист playbackRate; плашка не скрывается по окончании; клик по плашке → к сообщению; вид плашки (пилюля vs докованная); единый RangeSelector/MediaProgressLine.
- **P2** — hover баров, прелоадер загрузки voice, размеры (364/335/280 vs 340/320/240), позиция/фон бейджа кружка, цвет unread-точки в out, MediaSession, буст громкости 200%, ведущий ноль, PlayPauseGlyph, repeat, порог prev.

---

## 7. Композер и панель ввода

Референс: `tweb/src/components/chat/input.ts` + `_chat.scss` (секция chat-input) и хелпер-partials. Наш код: `Composer.tsx` + `Composer.module.scss` + `components/composer/*`, `components/emoji/*`, хелперы, `MarkupTooltip`, `AttachMenu`.

> Функциональные расхождения (что умеет/не умеет) — в аудите 2026-08-07, здесь DOM/вёрстка/размеры/анимации.
> Замечание по референсу: чекаут tweb — модифицированная сборка (voice-пилюля, `chat-input-plate`, нет slide-to-cancel, send-пилюля 48×40 вместо круга 54px ванильного tweb) — аудит выполнен против него как заявленного эталона.

### 7.1 Каркас chat-input: DOM-дерево и контейнер

Референс: `input.ts:462-491,566-568,1012-1013,1273-1297,1372` + `_chat.scss:6-30,539-559` + `base.scss:156-160`.
Наш код: `Composer.tsx:588-914`, `Composer.module.scss:5-19,60-66,319-329`, `ConversationView.module.scss:135-158`.

tweb (полное дерево):
```
.chat-input.chat-input-main
└── .chat-input-container
    ├── .rows-wrapper-wrapper
    │   └── .rows-wrapper.chat-input-wrapper.chat-rows-wrapper
    │       ├── .reply-wrapper.rows-wrapper-row            (ОДНА плашка на reply/edit/forward/webpage)
    │       │   └── .reply-wrapper-content
    │       │       ├── button.btn-icon.<type>.reply-icon
    │       │       ├── .reply (wrapReply)
    │       │       └── button.btn-icon.close.reply-cancel
    │       ├── <StickersHelper/EmojiHelper/CommandsHelper/MentionsHelper/InlineHelper>  (absolute над панелью)
    │       └── .new-message-wrapper.rows-wrapper-row
    │           ├── .new-message-bot-commands            (тоггл бот-команд, scale 0↔1)
    │           ├── .attach-file (AttachMenuButton, btn-menu внутри)
    │           ├── .input-message-container
    │           │   └── .input-field-input.input-message-input[contenteditable]
    │           │       (+ .input-field-input-fake, + .input-field-placeholder)
    │           ├── button.btn-icon.scheduled.btn-scheduled.float
    │           ├── button.btn-icon.botcom.toggle-reply-markup.float
    │           ├── button.btn-icon.auto_delete_circle_clock
    │           ├── button.btn-icon.gift / suggested
    │           ├── button.btn-icon.smile.toggle-emoticons
    │           ├── input[type=file][hidden]
    │           ├── .voice-recording-panel                (absolute поверх строки)
    │           └── .btn-send-container
    │               ├── button.btn-circle.btn-send.animated-button-icon  (6 иконок внутри)
    │               ├── .btn-send-stars-badge / SelectedEffect / SendMenu
    ├── .fake-wrapper.fake-rows-wrapper                    (невидимый измеритель высоты)
    ├── .fake-wrapper.fake-selection-wrapper
    └── .chat-input-control.chat-input-wrapper             (плейт выделения, кроссфейд)
```
У нас: `div.footer.footerCompose (688px) > div.composerBox > [хелперы] + div.container (surface, r24, shadow) > [.paidBar?] + ТРИ НЕЗАВИСИМЫХ AnimatePresence-бара (reply/edit/forward) + div.inputRow (attach/ttl/scheduled слева, editor, counter, smile, sendBtn)`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота 48px / радиус 24px / тень `0 1px 8px 1px rgba(0,0,0,.12)` / паддинг-гэп .25rem | ✓ | ✓ (тень тёмной темы .35 — отсебятина) | — |
| max-height панели 30rem | есть | нет (растёт от инпута max 30vh) | P2 |
| max-width | `--chat-input-max-width: var(--chat-width)` (JS) | хардкод 688px | P2 |
| fake-wrappers (измерители для анимации высоты) | есть | ОТСУТСТВУЕТ | P2 |
| `.chat-input-control` + selection-плейт кроссфейдом внутри панели (тайминги .1s) | `_chat.scss:561-668` | SelectionBar подменяет весь футер без кроссфейда | P1 |
| paid-плашка | плейсхолдер инпута со звёздами + бейдж на btn-send (`input.ts:2779-2781`) | отдельный бар `paidBar` — ОТСЕБЯТИНА | P2 |

### 7.2 Порядок кнопок в строке

Референс: `input.ts:1273-1284, 1372` — **scheduled и auto-delete (TTL) стоят СПРАВА от инпута**, слева только бот-меню и скрепка.
Наш код: `Composer.tsx:750-850` — sendAs, menuBtn, **attach, ttl, scheduled, editor**, counter, smile, send.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| btnScheduled | справа от инпута, `.float` — появляется через `grow-icon .4s` только при пустом инпуте | слева, без анимации, виден всегда | P1 |
| Секретный TTL | `btnAutoDeletePeriod` справа | слева, с текстовым бейджем — ОТСЕБЯТИНА | P1 |
| Индикатор «есть запланированные» | точка 8px в углу иконки (`_chat.scss:69-80`) | кнопка красится в primary | P2 |
| send-as | absolute, scale(0)→(1) + анимированный сдвиг attach/инпута (`has-offset`, .3s) | статическая вставка в flex | P2 |
| bot commands toggle | синяя пилюля (h 2.5rem, radius 1.25rem, scale 0↔1 + width) (`_chat.scss:876-924`) | светлая пилюля с текстом — ОТСЕБЯТИНА по вёрстке | P1 |
| Счётчик символов у инпута | нет такого | `Text.counter` — ОТСЕБЯТИНА | P2 |

### 7.3 Инпут: контейнер, плейсхолдер, автогроу

Референс: `_chat.scss:1043-1089`, `_input.scss:230-254`, `input.ts:2880-2915`.
Наш код: `Composer.tsx:202-216,805-830`, `Composer.module.scss:117-193`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Контейнер min-height 40px | ✓ | ✓ | — |
| padding инпута | `.5rem 0` | `4px 0` + line-height 21px | P2 |
| Анимация роста | `transition: height .1s`; высота меряется fake-инпутом; база 37px | `.12s ease`, замер `height='auto'` + rAF | P2 |
| max-height | JS: **440px** десктоп / 160px мобайл (`input.ts:2880-2895`) | `innerHeight * 0.3` | P1 |
| Плейсхолдер | отдельный элемент, **анимированный** — fade + translateX(1rem) `.15s ease-out` при вводе (`_input.scss:230-254`) | условный рендер — исчезает мгновенно | P1 |
| Плейсхолдер цвет | `--input-message-placeholder-color` | `--secondary-text-color` | P2 |

### 7.4 Кнопка отправки: морфинг send/record/edit

Референс: `input.ts:1301-1318, 3983-4018`, `_chat.scss:147-195`, `base.scss:1082-1108` (grow-icon/hide-icon), `_animatedIcon.scss:158-170`.
Наш код: `Composer.tsx:854-911`, `Composer.module.scss:206-236`.

tweb: в кнопке **одновременно живут 6 иконок** (send/schedule/check/microphone/recordround/forward), каждая absolute; неактивная играет `hide-icon .4s` (scale 1→.5), активная — `grow-icon .4s` (scale .5→1.1→1). Морфинг **параллельный**.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Геометрия: пилюля 48×40, radius 20 | ✓ | ✓ | — |
| Фон | `--primary-color` flat, hover `--dark-primary-color` | `var(--tg-accentGradient)`, hover нет — ОТСЕБЯТИНА | P1 |
| Морфинг иконок | параллельные keyframes .4s | `AnimatePresence mode="wait"` — последовательно (~0.8s суммарно) | P1 |
| Состояния | 6: send/record/record-video/edit/schedule/forward | 3: send/mic(round)/slowmode; **edit-галочки `check` нет** | P1 |
| Иконка send: `margin-inline-start:-3px` компенсация | есть | нет | P2 |
| whileTap scale 0.92 | нет (ripple) | есть — ОТСЕБЯТИНА | P2 |
| Слоумод-таймер текстом в кнопке | нет | есть — ОТСЕБЯТИНА | P2 |
| Бейдж эффекта | кружок 22px на surface, fade | голый эмодзи 13px | P2 |
| SendMenu | в btn-send-container, `bottom: calc(100% + .5rem)` | портал с хардкодом right:24/bottom:72 | P2 |

### 7.5 Запись голоса (voice-recording-panel)

Референс: `voiceRecording/voiceRecordingPanel.ts:61-100`, `_voiceRecordingPanel.scss:5-186`, `_chat.scss:227-240,395-407`.
Наш код: `Composer.tsx:711-749`, `Composer.module.scss:69-114`.

tweb DOM:
```
.voice-recording-panel            (absolute overlay: inset 0, inset-inline-end: calc(48px + .5rem))
├── button.btn-icon.voice-recording-cancel.danger  (40px, delete)
├── .voice-recording-pill         (--light-primary-color, radius 24, gap 10px)
│   ├── .voice-recording-lead > .voice-recording-dot (10px, danger, blink 1.25s) | button.play (24px, --paused)
│   ├── canvas.voice-recording-waveform (h 1.75rem, flex 1)
│   └── span.voice-recording-timer (.875rem, tabular, min-width 3rem, СПРАВА от волны, формат 0:00,0)
└── button.btn-icon.voice-recording-pause-toggle (pause ↔ microphone)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Появление | absolute-overlay поверх строки, fade .15s; инпут остаётся под ней | контент строки ЗАМЕНЯЕТСЯ, без фейда | P1 |
| Порядок в пилюле | dot/play → **волна** → **таймер справа** | dot → **таймер слева** → волна | P1 |
| Таймер | 14px, min-width 3rem, `0:00,0` (децисекунды) | 16px, слева, без децисекунд | P1 |
| Пауза | `--paused`: play-кнопка 24px (прослушивание записи) | play-прослушивания нет; mic/pause свап есть | P1 |
| Пилюля | `--light-primary-color`, radius 24 | color-mix 16%, radius 18 | P2 |
| Волна | canvas LiveWaveform | div-бары — ОТСЕБЯТИНА по реализации | P2 |
| Цвета dot/cancel | `--danger-color` | `#ff3b30`/`#ff5a5a` хардкоды | P2 |

### 7.6 Запись видео-кружка

Референс: `_videoRecordingPanel.scss:10-63`, `recording/videoRecordingPanel.tsx`. Наш: `composer/RoundRecordPreview.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Каркас | `.video-recording-stage` fixed, fade .2s; классы --recording/--paused/--playing | fixed, без fade | P2 |
| Круг | max 90vw/70vh, тень `0 8px 40px .6` + ring | `min(360px, 78vw)`, тень .4 | P2 |
| Зеркалирование | scaleX(-1), снимается в `--playing` (прослушивание) | scaleX(-1); playback-режима нет | P1 |
| Прогресс-кольцо | SVG absolute | есть ✓ | — |

### 7.7 Reply/edit/forward-плашка

Референс: `input.ts:624-632, 4831-4914` (setTopInfo), `_chat.scss:758-833`, `$chat-helper-size: 3rem`.
Наш код: `Composer.tsx:617-707`, `Composer.module.scss:24-57`.

tweb: **одна** плашка на все типы — `setTopInfo` заменяет иконку и содержимое `.reply`; анимация **height 0 → 3rem** `.25s standard-out`, overflow hidden.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Число плашек | одна переиспользуемая | три AnimatePresence-блока — при смене reply→edit играют ДВЕ анимации | P1 |
| Анимация | height 0→48px фикс, .25s | height 0→'auto', 0.25s — тайминг ✓ | P2 |
| DOM | btn-icon 40px + `.reply` (wrapReply, общий с баблами, radius .5rem) + btn-icon close | голый TgIcon 22 + самодельный barBody (скругление только справа, полоса box-shadow) — ОТСЕБЯТИНА | P1 |
| Цвет иконки/крестика | `rgb(var(--peer-color-rgb))` + hover-подложка | иконка цветом автора, hover нет | P2 |

### 7.8 Attach menu

Референс: `input.ts:1195-1256` (btn-menu внутри кнопки, direction top-right), `_chat.scss:735-744`.
Наш код: `AttachMenu.tsx:36-46`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Подсветка кнопки при открытом меню (`.menu-open` → primary + light-primary фон) | есть | ОТСУТСТВУЕТ | P1 |
| Состав | Photo/Video, Document, [Edit This Photo], gift, poll, «Checklist» (checkround) | image, document, **location, contact** — ОТСЕБЯТИНА, poll, check | P1 |
| Запрет медиа | `.btn-disabled` opacity .3 | кнопка не диммится, тост | P2 |

### 7.9 Emoji dropdown

Референс: `_emojiDropdown.scss:12-533`, `dropdownHover.ts`, `input.ts:1380-1394,1944`.
Наш код: `emoji/EmojiDropdown.tsx`, `EmojiDropdown.module.scss`, `emoji/useDropdownHover.ts`.

Совпадает 1:1: размер 23.875×26.25rem, позиция, анимация scale(.85)→1 .2s origin 100% 100%, hover-intent 200/200ms, меню категорий, поиск со сдвигом −49px, нижние табы, blur.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Иконка кнопки при открытии | `smile ↔ keyboard` (`input.ts:1944`) | ОТСУТСТВУЕТ — только primary-цвет | P1 |
| `.is-under` (мобайл/низкое окно): панель ПОД инпут | есть | ОТСУТСТВУЕТ | P1 |
| Сворачиваемая группа в меню категорий (width 1.875↔8.5rem) | есть | ОТСУТСТВУЕТ | P2 |
| mask-fade чипов поиска при скролле | есть | нет | P2 |

### 7.10 Автокомплиты над инпутом

Референс: `_autocompleteHelper.scss`, `_autocompletePeerHelper.scss`, `_chatEmojiHelper.scss`, `_chatStickersHelper.scss`, `_chatInlineHelper.scss`, `_chatBotCommands.scss`; база `autocompleteHelper.ts:51`.
Наш код: `MentionsHelper/EmojiHelper/StickersHelper/InlineResultsHelper` + модули.

База (bottom +8px, radius 16, fade .2s) совпадает ✓. Inline-helper (list) — метрики 1:1 ✓. Emoji-helper 1:1 ✓.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Фон | `--surface-color` | хардкод `#fff`/`#212121` по data-theme — мимо токенов | P1 |
| Ширина peer-хелперов | `width: auto` по контенту | всегда `100%; max-width 24rem` | P2 |
| Stickers-helper | scrollable max-height 13.75rem, **сетка с переносом** | одна горизонтальная строка со скроллом | P1 |
| Bot commands panel (`/`) | выезд translateY + fade, max-height 207, radius 24 24 0 0 | ОТСУТСТВУЕТ | P1 |
| Inline gallery-режим | grid | ОТСУТСТВУЕТ (только список) | P2 |

### 7.11 Markup tooltip

Референс: `chat/markupTooltip.ts:56-174`, `_chatMarkupTooltip.scss:3-131`.
Наш код: `MarkupTooltip.tsx`, `MarkupTooltip.module.scss`.

tweb: fixed, h 44, **w 312** (link-режим 420, width анимируется), radius 16, transition `--layer-transition` .2s; внутри `.markup-tooltip-wrapper` — **слайд translateX(-312px)** к link-редактору (back + delimiter + input + apply).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота 44 ✓ / radius | 16 | 10 | P2 |
| Ширина | фикс 312/420, анимируется | по контенту; link — conditional render | P2 |
| Link-режим | слайд wrapper + back-кнопка + delimiters, apply fade при `.is-valid` | мгновенная подмена; back/delimiter нет; apply всегда | P1 |
| Кнопки | 30×30, radius .625rem; 9 шт (вкл. date/calendar) | 32×32, radius 8; 8 шт — date нет | P2 |
| Фон | `--surface-color` | хардкод #fff/#2b2b2b | P1 |
| Позиция при смене выделения | transform-переезд с transition | телепорт без transition | P2 |

### 7.12 Reply keyboard (бот-клавиатура)

Референс: `_replyKeyboard.scss:3-93`. Наш: `ConversationView.tsx:1087-1099`, `ConversationView.module.scss:161-190`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Каркас | панель 26.25rem справа, `bottom: calc(100% + .625rem)`, radius 16, тень | во всю ширину футера, без тени-панели | P1 |
| Анимация | scale(0)→1 + fade, `--esg-transition`, origin bottom right | ОТСУТСТВУЕТ | P1 |
| Кнопка | h 3rem, border 2px primary, текст primary, hover — заливка primary + белый | h 40, surface, без бордера, hover серый | P1 |
| Тоггл-кнопка в строке (`toggle-reply-markup`) | есть | ОТСУТСТВУЕТ — клавиатура всегда развёрнута | P1 |

### 7.13 Драг-н-дроп файлов в чат

Референс: `_chatDrop.scss:3-125`, `_chat.scss:508-525`. Наш: только `Composer.tsx:417-424` (onDrop на contenteditable).

**ОТСУТСТВУЕТ** полноэкранная зона дропа: tweb `.drops-container` (absolute над чатом, fade .2s) с плашкой surface radius 24, SVG-рамкой `stroke-dasharray 13.5,11` и бегущим пунктиром `drop-outline-move .5s linear infinite` при dragover; `body.is-dragging` отключает pointer-events. У нас файл можно бросить только точно в contenteditable, без визуального отклика. **P1**.

### 7.14 Итог домена

- **P1**: параллельный морфинг иконок send + edit-состояние; flat primary-фон send; scheduled/TTL справа; синяя пилюля бот-команд; анимированный плейсхолдер; max-height 440px; overlay-появление voice-панели + таймер-после-волны + play-preview на паузе; единая reply-плашка с wrapReply; подсветка attach + состав пунктов; smile↔keyboard и `.is-under`; фон хелперов/тултипа токеном; сетка stickers-helper; bot-commands панель; слайд link-режима; reply keyboard целиком; drop-зоны; кроссфейд selection-плейта.
- **P2**: fake-wrappers, max-height 30rem, точка btn-scheduled, анимация send-as, метрики тултипа, децисекунды таймера.
- **ОТСЕБЯТИНА**: градиент+whileTap на send, счётчик символов, slowmode-текст, paidBar, Location/Contact в attach-меню, текстовый TTL-бейдж, хардкод-цвета (#fff/#212121/#ff5a5a/#ff3b30).

---

## 8. Попапы и меню

Референс: `tweb/src/components/popups/index.ts` (базовый класс), `popups/*.ts`, `tweb/src/scss/partials/popups/*.scss`, `_button.scss` (btn-menu), `helpers/positionMenu.ts`, `contextMenuController.ts`.
Наш код: `shared/ui/Popup/*`, `shared/ui/Menu/*`, `PopupHost.tsx` и ~12 модалок.

### 8.1 Базовый попап

Референс: `popups/_popup.scss:5-338`, `popups/index.ts:119-245, 330-449`, `base.scss:70-73` (`--popup-transition-time: .15s`, cb(.4,0,.2,1)).
Наш код: `shared/ui/Popup/Popup.tsx:38-82`, `Popup.module.scss:2-71`, `PopupHost.tsx`.

DOM tweb:
```
.popup (fixed inset:0, скрим rgba(0,0,0,.3), padding 1.875rem, z:4)
└─ .popup-container.z-depth-1 (border-radius 2.5rem, БЕЗ собственного padding)
   ├─ .popup-header (height 3.5rem, padding 0 1rem)
   │  ├─ .btn-icon.popup-close (2.5rem, margin-inline-end 1rem, цвет = primary-text)
   │  ├─ .popup-title (font-size 20px, weight 500, flex:1)
   │  └─ [button.btn-primary]         ← withConfirm — кнопка В ХЕДЕРЕ
   ├─ .popup-body (flex:1, overflow hidden) / .scrollable
   ├─ [.popup-footer] (padding 1rem, кнопка 48px)
   └─ [.popup-buttons] (row-reverse, height 3rem)  ← конфирмы
```
Наш DOM: `.overlay (rgba(0,0,0,.3), padding 30px, z:4090) > .card (radius 2.5rem, padding 12px 16px 16px, shadow --menu-box-shadow) > .header (4px 0 10px) + .body + footer + .action (48px)`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Анимация открытия | скрим fade .15s + translateY 3rem→0 .15s cb(.4,0,.2,1) | то же ✓ | — |
| **Анимация закрытия** | `.hiding`: карточка **остаётся на месте**, уходит только opacity (`_popup.scss:65-69`); DOM удаляется через 250мс | exit `y: 48` — карточка **уезжает вниз** + fade | **P1** |
| Padding карточки | у `.popup-container` нет; отступы дают header/body/footer | `padding: 12px 16px 16px` на карточке | P1 |
| Header | height **3.5rem**, padding 0 1rem; close 2.5rem c margin-inline-end 1rem | без фикс. высоты (4px 0 10px), gap 12, close «small» | P1 |
| Цвет close-иконки | `--secondary-text-color: var(--primary-text-color)` → тёмная (`_popup.scss:129-131`) | серая | P2 |
| Заголовок | 20px, weight 500 | 19px / 600 | P2 |
| Тень карточки | `.z-depth-1` (3-слойная material) | `--menu-box-shadow` (тень от меню) | P2 |
| max-height | `min(100%, --popup-max-height)` (100vh−60px) | `min(86vh, 720px)` — отсебятина | P2 |
| Enter = confirm | index.ts:375-387 | ОТСУТСТВУЕТ | P1 |
| `overlayClosable` опционален + `isConfirmationNeededOnClose` | есть | клик по скриму закрывает **всегда** (риск потери ввода) | P1 |
| `.popup-buttons` (ряд текстовых кнопок, row-reverse, вертикально при ≥3) | есть | ОТСУТСТВУЕТ в ките | P1 |
| Footer-caption, floating footer, header `is-floating` | есть (`_popup.scss:150-190, 235-273`) | ОТСУТСТВУЕТ | P2 |
| `old`-вариант (surface-фон) | есть (datePicker и др.) | ОТСУТСТВУЕТ | P2 |

Направление: убрать padding с карточки, ввести структурные header(3.5rem)/body/footer/buttons; exit — fade на месте; Enter-confirm и `overlayClosable`-флаг.

### 8.2 Confirmation-попап (PopupPeer)

Референс: `popups/peer.ts:36-120`, `popups/index.ts:247-320`, `_peer.scss:4-75`, `_confirmation.scss:1-5`.
Наш код: `messages/ChatDialogs.tsx:33-62` (delete), `379-411` (discard voice), `ChatDialogs.module.scss:4-58`.

tweb (компактный конфирм):
```
.popup.popup-peer (min-width 19.5rem, max-width 25rem)
└─ .popup-container (padding .75rem .5rem, width min-content, radius 2.5rem)
   ├─ .popup-header (height 2.5rem) → [avatar 32] + .popup-title (1.25rem/500)
   ├─ p.popup-description (padding .625rem 1rem .5rem)
   ├─ [.checkbox-field ×N] (min-height 3rem, ripple)
   └─ .popup-buttons (height 3rem, row-reverse, padding 0 .5rem)
      └─ button.popup-button.btn.danger|primary (2.5rem, UPPERCASE, weight 500, ripple, radius 16)
```
У нас — собственная карточка: `.overlay (rgba(0,0,0,.45), z 2100) > .card.confirm (width 320, radius 12, padding 20, background --menu-background-color!) > Text + .confirmActions (колонка full-width строк, нижний регистр)`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Каркас | тот же `.popup` (скрим .3, translateY 3rem, .15s) | своя карточка: скрим .45, `scale .92→1` fade 0.2s | **P0** |
| Кнопки | текстовые, **горизонтально row-reverse** (confirm справа), UPPERCASE, ripple; вертикально только при ≥3 | всегда вертикальная колонка, обычный регистр, без ripple | **P0** |
| Cancel автодобавляется (`addCancelButton`) | есть | вручную | P2 |
| Радиус карточки | 2.5rem | 12px | P1 |
| Фон карточки | `--popup-background-color` | `--menu-background-color` (полупрозрачный токен меню) — ОТСЕБЯТИНА | P1 |
| danger-цвет | `--danger-color` + hover `--light-danger-color` | хардкод `#ff595a`, hover серый | P1 |
| Заголовок | 1.25rem/500, опц. аватар пира | 17px/600, аватара нет | P1 |
| ESC/Back/Enter | навигация-стек + Enter | нет | P1 |

Направление: собрать `ConfirmPopup` поверх общего Popup (порт PopupPeer), мигрировать `ChatDialogs.tsx` и `MutePopup`.

### 8.3 Delete popup (галочка «также для X»)

Референс: `popups/deleteMessages.ts:84-160` — PopupPeer c чекбоксом `«Also delete for <имя>»` / «Delete for all», одна danger-кнопка Delete + Cancel; заголовок «Delete N messages»; описание зависит от типа чата.
Наш код: `ChatDialogs.tsx:33-62` — две danger-кнопки «Delete for everyone» / «Delete for me» + Cancel, чекбокса нет.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Механика revoke | чекбокс + одна кнопка Delete | две отдельные кнопки | **P0** |
| Имя собеседника в чекбоксе (wrapPeerTitle onlyFirstName) | есть | ОТСУТСТВУЕТ | P0 |
| «Delete N messages» в заголовке | есть | всегда «Delete message» | P1 |
| Аватар пира в хедере | есть | нет | P2 |

### 8.4 Контекстное меню (btn-menu)

Референс: `_button.scss:98-345`, `base.scss:61` (`--btn-menu-transition .2s cb(.4,0,.2,1)`), `:631-638` (.contextmenu fixed), `positionMenu.ts:189-313`, `contextMenuController.ts:40-151`, `buttonMenu.ts:67-120`.
Наш код: `shared/ui/Menu/Menu.tsx`, `Menu.module.scss`, `MenuItem.module.scss`, позиционирование `core/hooks/useMessageActions.tsx:129-133`, `conversation/MessageContextMenu.tsx:55-61`.

Метрики панели и пункта совпадают 1:1 ✓ (min-width 11.25rem, padding .25rem 0, radius 16, item 32px/14/18/500, icon 20+20, scale .96 active, blur, shadow, transition .2s тот же bezier).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Позиционирование от точки клика | `positionMenu` **меряет реальные** scrollWidth/Height, паддинг 8px до краёв, fallback `center` | эвристика с константами `MW=256, MH=440` (`useMessageActions.tsx:130`) — реальный размер не меряется, длинное меню может уйти за край; клампа 8px нет | **P1** |
| transform-origin | классами `bottom-left`/… (RTL-aware) | инлайн `"${originY} ${originX}"` — эквивалент для LTR | P2 |
| Автозакрытие по mousemove (мышь дальше 100px / 40px от сабменю) | contextMenuController.ts:40-71 | ОТСУТСТВУЕТ | P2 |
| Подсветка триггера `.menu-open` («⋮» подсвечена пока меню открыто) | есть (controller:141-142) | ОТСУТСТВУЕТ | P2 |
| danger-пункт | `--danger-color`, hover `--light-danger-color` | хардкод `#ff595a`, hover серый | P1 |
| Сабменю (`btn-menu-submenu`) | есть | ОТСУТСТВУЕТ | P2 |
| Мобильный вариант (item 3rem, font 16, radius 0, surface без blur, ripple) | `_button.scss:161-201` | ОТСУТСТВУЕТ | P2 |
| Разделители, `-header`, `-subtitle`, бейджи | есть | ОТСУТСТВУЕТ | P2 |

### 8.5 Полоска реакций над меню

Референс: `_button.scss:649-905`. Наш: `MessageContextMenu.module.scss:10-63`.

Порт точный: высота 40, radius 40, offset −48, ячейки 36×28, шеврон 32, фон/blur/тень 1:1 ✓.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Горизонтальная привязка | `inset-inline-end: -2.5rem` (сдвиг К баблу) | `left:0`/`right:0` по углу меню | P2 |
| Хвостик-«пузырь» (`-bubble-big`) | есть | ОТСУТСТВУЕТ | P2 |
| Скролл полоски (scrollable-x) | есть | нет (7 фикс. эмодзи) | P2 |

### 8.6 Отправка медиа (popupNewMedia ↔ SendMediaPopup)

Референс: `popups/newMedia.ts:160-165, 300-380`, `_mediaAttacher.scss:4-325`.
Наш код: `messages/SendMediaPopup.tsx:91-229`, `SendMediaPopup.module.scss`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Ширина 420 | ✓ | ✓ | — |
| Меню «⋮» | spoiler on/off, **caption above/below**, make paid | send as media/file, make paid — spoiler/caption-position ОТСУТСТВУЮТ | P1 |
| Подпись | `InputFieldMessage`: rich-text (entities/markdown), лимит из api, эмодзи, перенос драфта из композера (newMedia.ts:344-356) | голый `<input>`: без rich-text/лимита/переноса | **P1** |
| Album-раскладка превью | настоящая альбомная сетка + video-time + spoiler-туллбар | вертикальный список превью | P1 |
| Удаление отдельного вложения (hover ×) | есть | ОТСУТСТВУЕТ | P1 |
| Заголовок | i18n `Send N Photos/Videos/Files` | русский хардкод мимо i18n | P1 (ОТСЕБЯТИНА) |
| Enter → отправка | есть | есть ✓ | — |

### 8.7 Forward popup

Референс: `_forward.scss:5-130` (420px × 80%), forward.tsx (selector: поиск, top-peers, folder-tabs sticky, футер с simple-message-input + send + menu-send).
Наш код: `ChatDialogs.tsx:109-207` (ForwardPicker).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер | 420 × 80% высоты | width 460, высота auto | P2 |
| Поиск / недавние / табы / мультивыбор | есть | есть ✓ | — |
| **Футер: поле комментария + круглая send-кнопка + меню send-опций (silent/schedule)** | есть | ОТСУТСТВУЕТ — только кнопка «Forward (N)» | **P1** |
| Кнопка отправки с тенью-подложкой `0 -6px 12px` | есть | нет | P2 |

### 8.8 Date picker и SchedulePopup

Референс: `_datePicker.scss:3-341`, `popups/datePicker.tsx`, `scheduleSendingPopup.tsx:50-70`.
Наш код: `DatePickerPopup.tsx` — **добротный порт** (виртуализация, геометрия 40/40/40/4, круг ::before, медиа-превью дней, weekend-danger — 1:1 ✓), `SchedulePopup.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Каркас | `old`-попап (surface), footer-кнопка | общий Popup + action | P2 |
| **Мультивыбор диапазона** (in-range bar, «N days selected», Clear History) | datePicker.tsx:104-122, 173-184 | ОТСУТСТВУЕТ | P1 |
| Время (`withTime`: два InputField 80px + `:`, живой лейбл «Send Today at HH:MM») | datePicker.tsx:214-256, 518-600 | ОТСУТСТВУЕТ | **P0** |
| **SchedulePopup** | = календарный datePicker c withTime + Repeat + «Send when online» | **нативные** `<input type=date>` + `<input type=time>` — ОТСЕБЯТИНА | **P0** |

Направление: SchedulePopup = DatePickerPopup с withTime (порт time-инпутов и confirm-лейбла).

### 8.9 Mute popup

Референс: `popups/mute.ts:29-52` — PopupPeer (`popup-mute`, min-width 16rem): компактный конфирм, RadioForm с ripple, текстовые кнопки Mute/Cancel row-reverse.
Наш код: `MutePopup.tsx` — большой Popup (360) с крестиком, свои радио, широкая 48px кнопка «MUTE».

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Каркас | компактный peer-конфирм без ×, кнопки текстом | большая карточка с × и футер-кнопкой | **P1** |
| Набор интервалов и дефолт Forever | 1h/4h/8h/1d/3d/Forever | 1:1 ✓ | — |
| Радио | RadioForm (ripple, 48px) | иконки tgico radioon/radiooff | P2 |

### 8.10 Тосты

Референс: `base.scss:741-786`, `toast.ts:20-56`, `_chatToast.scss:5-62`.
Наш код: `useGlobalToast.ts`, `GlobalOverlays.tsx:56-66`, `App.module.scss:43-58`.

tweb `.toast`: `.toasts-container` (fixed inset:0, **центр экрана**, z:5) > `.toast` (padding .5rem 1rem; bg rgba(0,0,0,.66); radius 16; blur 25; fade .3s cb(.4,0,.2,1); авто-скрытие 3000мс).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Позиция | **центр экрана** | top:16px по центру ширины | **P1** |
| Фон/радиус/паддинг | rgba(0,0,0,.66) / 16 / 8×16, blur 25 | rgba(0,0,0,.78) / 14 / 10×20, blur 8 + box-shadow (ОТСЕБЯТИНА) | P1 |
| Анимация | только fade .3s | fade + слайд y:−12, .24s | P1 |
| Длительность | 3000мс | 4000мс | P2 |
| Закрытие кликом вне | есть | нет | P2 |
| **Чат-тост под топбаром** (`chat-toast`, max 400px) | есть | ОТСУТСТВУЕТ | P1 |

### 8.11 Прочие модалки

- **PremiumModal**: свой оверлей rgba(0,0,0,.6) z:1300, **spring** (stiffness 320) — ОТСЕБЯТИНА; tweb `popup-premium` — обычный `.popup` (fade+translateY .15s), контейнер radius 16 / height 660 (`_premium.scss:6-16`). P1.
- **QrModal**: паттерн Popup (y:48, .15s ✓), но свой оверлей .45 и z:3200. P2.
- **BoostPopup, ReportPopup, CreatePollPopup, CreateChecklistPopup, NewContactPopup и пр.** — на общем Popup → наследуют расхождения §8.1 (чинится в одном месте).

### 8.12 Системное: z-index-зоопарк (ОТСЕБЯТИНА)

tweb: единая шкала — `.popup` z:4, `.btn-menu` z:4 (сабменю 5), тосты z:5; порядок — стек `PopupElement.POPUPS` + OverlayClickHandler.
У нас: Premium **1300** < Menu **2000/2001** < ChatDialogs **2100** < toast **3000** < QrModal **3200** < Popup **4090** < 4100. Следствия: контекст-меню рисуется под Popup (ручной проброс `zIndex` в `SendMediaPopup.tsx:116`); DeleteMessageDialog окажется под Popup; PremiumModal — под всем. **P1**: свести к общей шкале/стеку.

### 8.13 Итог домена

| P | Что |
|---|---|
| **P0** | Delete-конфирм: чекбокс «Also delete for <имя>» вместо двух кнопок; SchedulePopup: нативные date/time вместо календаря tweb (withTime); конфирмы не на каркасе PopupPeer |
| **P1** | Exit-анимация Popup (fade на месте); `.popup-buttons`/Enter-confirm/`overlayClosable`; padding и header-метрики; Mute как большая модалка; позиционирование меню без замера/клампа; danger-хардкод; caption без rich-text + нет spoiler/позиции/удаления вложения; forward без поля комментария; тосты (позиция/фон/анимация, chat-toast); multi-select DatePicker; z-index-шкала; PremiumModal spring |
| **P2** | цвет close, шрифт 20/500, тень z-depth-1, mousemove-автозакрытие, `.menu-open`, мобильный btn-menu, сабменю, хвостик полоски реакций, ширины handhelds |

Самый дешёвый рычаг: почти всё P1 лежит в `shared/ui/Popup/*` (~12 модалок) и `shared/ui/Menu/*`; конфирмы требуют нового `ConfirmPopup` (порт PopupPeer).

---

## 9. Правый сайдбар и настройки

Референс: `tweb/src/components/sidebarRight/*`, `sidebarLeft/tabs/*`, `_rightSidebar.scss`, `_profile.scss`, `_sidebar.scss`, `_slider.scss`, `_searchSuper.scss`, `_section.scss`, `_row.scss`.
Наш код: `UserInfoPanel.tsx` + `userInfo/*`, `SettingsView.tsx`, `SettingsSubScreen.tsx`, `settings/*`, `EditContactView.tsx`, `AddContactView.tsx`.

### 9.1 Каркас правого сайдбара

Референс: `_rightSidebar.scss:3-77`, `sidebarRight/index.ts:16-137`, `updateColumnWidths.ts:70-76`.
Наш код: `UserInfoPanel.tsx:261-291`, `UserInfoPanel.module.scss:6-30`, монтирование `ConversationView.tsx:1184-1195`.

DOM tweb:
```
#column-right (position:absolute; inset-inline-end/inset-block: 16px; width: var(--right-column-width);
               border-radius: 24px; z-index:3;
               ЗАКРЫТ: transform: translate3d(width+padding, 0, 0); transition var(--transition-standard-out)
               ОТКРЫТ (body.is-right-column-shown): translate3d(0,0,0); in)
└─ .sidebar-content (width: var(--right-column-width))
   └─ .sidebar-slider (стек .tabs-tab.sidebar-slider-item — профиль, edit, add-members, …)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Ширина | `--right-column-width` = **360px** default, ресайз 320–480 | хардкод 380px + margin → motion-обёртка 404px | P1 |
| Анимация открытия | **transform** translate3d, панель всегда в DOM, `inert` при скрытии; 0.3s in / 0.25s out cb(.4,0,.2,1) | **анимация `width` 0→404 + opacity** (framer) — лейаут-reflow каждый кадр, чат «дышит» | **P0** |
| Fade | нет opacity-фейда | `opacity: 0→1` — ОТСЕБЯТИНА | P2 |
| Монтирование | панель постоянна, скрыта transform'ом | mount/unmount через AnimatePresence — профиль перезапрашивается при каждом открытии | P1 |
| Стековая навигация внутри | SliderSuperTab-стек: sharedMedia → editContact/editChat/addMembers — вкладки одного `.sidebar-slider` с navigation-анимацией | edit/AddMembers/Stats — свои absolute-оверлеи; EditContactView/AddContactView — **отдельные док-панели** вне колонки | P1 |
| Handhelds | translate3d(100vw) того же элемента | отдельная ветка `narrow`: fixed + x:100% — поведенчески похоже ✓ | — |

Направление: убрать width-анимацию — колонка фиксированной ширины со сдвигом transform, панель держать смонтированной; ширина 360.

### 9.2 Шапка правого сайдбара

Референс: `_sidebar.scss:4-96`, `_profile.scss:598-663`, `sharedMedia.tsx:354-398, 481-552`.
Наш код: `UserInfoPanel.tsx:303-347`, `UserInfoPanel.module.scss:34-85`, `userInfo/helpers.ts:39-42`.

DOM tweb:
```
.sidebar-header (min-height 3.5rem; padding-inline 1rem; absolute; z-index 3;
                 без .header-filled: background transparent, pointer-events none)
├─ .btn-icon.sidebar-close-button > .animated-close-icon[.state-back]   ← морф X↔стрелка
├─ .transition.slide-fade (flex-grow 1)
│  ├─ .transition-item: .sidebar-header__title («User Info») + btn-icon.edit
│  └─ .transition-item: .sidebar-header__rows > (__title «Shared Media» + __subtitle > slide-fade счётчиков)
└─ btn-menu (⋮, только свой профиль)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Высота/отступы | min-height 3.5rem, padding-inline 1rem, заголовок 1.25rem (20px) bold | 56px ✓, gap 12 + padding 0 12px, 19px | P2 |
| X↔back | один элемент `.animated-close-icon` c CSS-морфом | подмена иконки `<TgIcon name={filled?'back':'close'}>` без морфа | P1 |
| Смена заголовка | slide-fade, **400ms** + вложенный slide-fade счётчиков | framer y:±14 + opacity, 200ms | P2 |
| Порог header-filled | `top <= 88` (56+16+16) | `top <= 65` | P2 |
| Фон шапки | появляется **только** с header-filled; граница `:after` 1px | промежуточное `.headerScrolled` при scrollTop>8 со своей тенью — ОТСЕБЯТИНА | P1 |
| ⋮-меню своего профиля | есть | ОТСУТСТВУЕТ | P2 |
| Заголовок по типу пира | User/Group/Channel/Bot/Topic | Bot/Topic нет | P2 |

### 9.3 Профиль-хедер: карусель аватаров

Референс: `_profile.scss:4-399, 471-538`, `peerProfileAvatars.ts:243-347, 929-946`.
Наш код: `UserInfoPanel.tsx:94-228, 355-434`, `UserInfoPanel.module.scss:114-241`.

tweb: **один** DOM-контейнер, состояния морфятся классом `is-collapsed`:
```
.profile-avatars-container (padding-bottom: 100% ↔ 66% collapsed; min-height 276px; transition padding-bottom .3s)
├─ .profile-avatars-avatars (flex-дорожка, transition transform .2s ease-in-out)
│  └─ .profile-avatars-avatar[.active] (min-width 100%; collapsed: translateY(-3%) scale(120/400) + border-radius 50%)
├─ .profile-avatars-tabs (top .5rem) > .profile-avatars-tab (opacity .2/.6; .is-playing → progress)
├─ .profile-avatars-gradient (+ -top)
├─ .profile-avatars-arrow / -arrow-next (width 100%/3, hover opacity 1)
└─ .profile-avatars-info (имя+статус ЖИВУТ тут в обоих состояниях; collapsed: translateY(-33%) + центрирование)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Механизм collapse/expand | один DOM, класс + CSS-transition: аватар **морфит** scale(120/400)+border-radius (фото сжимается в круг) | **два разных дерева** через AnimatePresence mode="wait" — фото исчезает и появляется кружок, морфа нет | **P0** |
| Имя/статус | одни узлы, анимируются transform/color | два дубля: `avatarsInfo` и `avatarBlock` | P1 |
| Разворачивание | клик **и** wheel/scroll-up (`useCollapsable`) | только клик | P1 |
| Стрелки prev/next по hover | есть (`_profile.scss:330-373`) | ОТСУТСТВУЮТ (зоны-трети есть ✓) | P1 |
| Сегменты-пейджер | .5rem/.375rem/.125rem, opacity .2/.6 | 1:1 ✓; нет progress-fill `.is-playing` у видео-аватара | P2 |
| Градиенты | нижний 100px + верхний scaleY(-1); анимация opacity | статичны, геометрия ✓ | P2 |
| Свайп | SwipeHandler | pointer events ✓ | — |
| Инфо поверх фото (verified/premium/status) | и в развёрнутом | только в свёрнутом | P2 |
| Имя (collapsed) | 20px/24px, max-width 21.25rem | 21px, без max-width | P2 |

Направление: один DOM-контейнер с классом `is-collapsed` и CSS-морфом scale.

### 9.4 Инфо-строки профиля (Row)

Референс: `_row.scss:6-268`, `peerProfile.tsx:633-732, 895-967, 1175-1218, 1510-1533`.
Наш код: `settings/kit.tsx:101-151`, `kit.module.scss:34-64`, `UserInfoPanel.tsx:438-534`.

tweb Row: `.row.row-with-padding.row-clickable (min-height 3.5rem; padding .4375rem 1rem; padding-inline-start 4.5rem; radius 16px; ripple)` + `.row-icon` (absolute, inset-inline-start 1rem, 1.5rem) + `.row-title` (16px) + `.row-subtitle` (14px).

Порядок MainSection: Phone → Username → Location → Bio → Link → Birthday → ContactNote → BusinessHours → BusinessLocation → Notifications → Bot*.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Клик по Phone/Username/Bio → копирование + toast | есть (`peerProfile.tsx:655-658, 706-709, 914-921`) | строки **некликабельны** | **P0** |
| Контекст-меню строк (copy/translate bio) | есть | ОТСУТСТВУЕТ | P1 |
| QR-кнопка справа от username | есть (`peerProfile.tsx:734-747`) | ОТСУТСТВУЕТ (QR только у группы) | P1 |
| Строка Link (t.me/…) | Row link-иконка + copy | свой `channelRow`/`linkRow` из div'ов — ОТСЕБЯТИНА-разметка | P1 |
| Bio с переносами | `Row.Title class="pre-wrap"` | `Text noWrap` — bio **обрезается в одну строку** | P1 |
| Геометрия строки | min-height 56px, иконка absolute, текст inset 4.5rem | flex gap 16, padding 9px 12px → ~42px, плотнее | P1 |
| Username subtitle «also @a, @b» | есть | только 'Username' | P2 |
| Notifications toggle | Row + Checkbox toggle | есть ✓ | — |
| Location/BusinessHours/ContactNote | есть | ОТСУТСТВУЮТ (Birthday есть ✓) | P2 |

### 9.5 Shared media (search-super)

Референс: `appSearchSuper.ts:455-496, 555-601`, `_searchSuper.scss:3-327`, `_slider.scss:3-243`, `_rightSidebar.scss:86-101`.
Наш код: `userInfo/SharedMedia.tsx`, `UserInfoPanel.module.scss:384-524`, `shared/ui/Tabs/*`.

DOM tweb:
```
.search-super (absolute; top:100%; min-height var(--super-height) = 100vh − 72px)
├─ .search-super-tabs-scrollable.menu-horizontal-scrollable.sticky (sticky; top: 72px;
│    height 3rem; margin 0 1rem; radius 24px; bg surface; box-shadow --section-box-shadow)
│  └─ nav.menu-horizontal-div > .menu-horizontal-div-item (radius 1.25rem; bold)
│       └─ span + i.-item-background (пилюля активного, transition transform/width .2s)
└─ .tabs-container[data-animation="tabs"] > .search-super-tab-container.tabs-tab > .search-super-content-<type>
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Пагинация | infinite scroll (`searchSuper.load()`, loadMutex) | **одна** загрузка `mediaHistory(chatId, filter)` без offset — длинные истории обрезаны (`SharedMedia.tsx:106-117`) | **P0** |
| Грид «Медиа» | `repeat(3,1fr)`, gap **1px**, radius 24 | 1:1 ✓ | — |
| video-time бейдж | left **5px**, top 4px, h 18px, **radius 4px**, bg rgba(0,0,0,.35), padding 0 6px 0 5px | left 4px, radius 9px, bg rgba(0,0,0,.55) | P2 |
| Sticky-топ табов | `top: 72px` (header 56 + 16) | `stickyTop = 8` — расхождение порога | P1 |
| Пилюля активного таба «переезжает» | есть | наш Tabs портирует ✓ | — |
| Переключение контента | TransitionSlider tabs: **0.2s ease-in-out** | framer x:±100%, **0.3s** | P2 |
| Набор табов | 12 типов, вкл. Groups, Similar channels, Stories | 5 медиа + Members/Chats/Gifts; Groups/Stories/Similar ОТСУТСТВУЮТ | P2 |
| Files строка | icon 3rem radius 5px, h 48+1.5rem, sent-time справа | rowSquare 48 radius 10px, дат справа нет | P2 |
| Links строка | row-media 3rem, subtitle = текст сообщения | кружок-буква с градиентом — ОТСЕБЯТИНА | P2 |
| Music/Voice | общий `.audio`-плеер с прогрессом | своя строка с `--tg-accentGradient` (ОТСЕБЯТИНА) без прогресса | P1 |
| Selection-режим | есть (`_searchSuper.scss:337-407`) | ОТСУТСТВУЕТ | P2 |

### 9.6 Слайдер-навигация экранов настроек

Референс: `slider.ts:11,41-45`, `transition.ts:23-43`, `_slider.scss:226-242`, `sliderTab.ts:45-74`.
Наш код: `motion.ts:28-32`, `SettingsView.tsx:81-234`, `SettingsSubScreen.tsx`, `settings/kit.tsx:14-49`.

tweb «navigation»: новый экран въезжает с `translate(width)`, **старый уезжает на `-width*0.25` и затемняется `filter: brightness(80%)`**; вперёд 0.3s / назад 0.25s.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Въезд нового экрана | translate(width→0), 0.3/0.25s | `slideInRight` ✓ | — |
| Уходящий экран | **параллакс −25% + brightness(80%)** | стоит на месте | P1 |
| Модель навигации | единый стек `historyTabIds`, Esc/Back через appNavigationController | вложенные useState+AnimatePresence на каждом уровне; back браузера не связан | P2 |
| Заголовок вкладки | padding-inline-start 1.5rem, 1.25rem bold | 19px, gap 8 | P2 |

### 9.7 Корневой экран настроек

Референс: `sidebarLeft/tabs/settings.tsx:87-296`. Наш: `SettingsView.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Профиль сверху | **тот же profile-avatars хедер** (свёрнутый круг ↔ фото) + phone/username/**bio** rows | статичный аватар 130px + имя + «online»; bio нет; не разворачивается | P1 |
| Header-кнопки | QR + edit + ⋮ | back + QR + edit + ⋮ ✓ | — |
| Devices: `titleRight` = число сессий | есть | без счётчика | P2 |
| Language: titleRight = имя языка | ✓ | ✓ | — |
| «Night Mode»-строка | НЕТ (тема в General→ColorTheme) | есть первой строкой — ОТСЕБЯТИНА | P2 |
| Подсветка активного пункта `.rowActive` | нет | есть — ОТСЕБЯТИНА | P2 |
| Порядок пунктов | unmute, data, lock, settings, folder, stickers_face, videocamera, devices, language, keyboard | совпадает ✓ | — |

### 9.8 General Settings + range slider

Референс: `generalSettings.tsx:33-355`, `rangeSettingSelector.tsx:20-38`, `_leftSidebar.scss:951-1021`.
Наш код: `settings/GeneralSettings.tsx`, `shared/ui/Slider/*`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Диапазон Text Size | **12–20**, шаг 1 | 12–**24** | P1 |
| Thumb | **12px** | 18px | P2 |
| Трек 2px, заполнение primary | ✓ | ✓ | — |
| Отступы блока | padding 1rem, details margin-bottom 1rem | 8px 16px 0 — теснее | P2 |
| ColorTheme | ChatThemesPicker (реальные превью) + радио day/night/light/tinted/**system последним** + accent-picker (dark) | сетка мок-карточек с эмодзи; System **первым**; accent-picker нет | P2 |
| Time Format | подзаголовок = **живое текущее время** (eachMinute) | статичные «10:00 PM»/«22:00» | P2 |
| Power Saving titleRight живой | есть | захардкожен «Disabled» | P2 |

### 9.9 Two-Step Verification + PasswordMonkey

Референс: `monkeys/password.ts:5-62`, `sidebarLeft/tabs/2fa/*`.
Наш код: `PasswordMonkey.tsx`, `settings/TwoStepVerification.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Обезьянка: сегмент 0↔16 c реверсом | есть | `playSegments([0,16])` — эквивалент ✓ | — |
| Размер | **157** | 140 | P2 |
| tgs | родной .tgs через lottie-воркер | JSON + lottie-web canvas (мигрировать на tlottie) | P2 |
| Флоу-шаги | отдельные slider-вкладки с navigation-анимацией; lottie-заставки | шаги — state одного компонента без анимаций; hero — TgIcon-замок и эмодзи 💡💌🥳 — ОТСЕБЯТИНА | P1 |
| Мёртвый код | — | `monkeyField(..., onEnter?)` не используется, рендерит `<span style=display:none>` | P2 |

### 9.10 Active Sessions / Blocked Users

Референс: `activeSessions.tsx:30-107`, `blockedUsers.tsx:27-97`. Наш: `settings/ActiveSessions.tsx`, `settings/BlockedUsers.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Строка сессии | title/midtitle/subtitle/titleRight (3 строки + дата) | 2 строки + иконка devices (в tweb иконки НЕТ) + крестик — ОТСЕБЯТИНА | P1 |
| Завершение сессии | клик по строке → попап подтверждения | крестик **без подтверждения** | P1 |
| Blocked: добавление | ButtonCorner FAB «+» | строка «Block User» | P2 |
| Разблокировка | попап | крестик без подтверждения | P2 |

### 9.11 Edit contact / Add contact

Референс: `sidebarRight/tabs/editContact.tsx:27-364`, `_rightSidebar.scss:267-285`. Наш: `EditContactView.tsx`, `AddContactView.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Место в навигации | вкладка того же правого слайдера | отдельная док-панель, UserInfoPanel демонтируется | P1 |
| Состав секций | поля+notifications+birthday / фото(3 кнопки) / delete / FAB ✓ | совпадает ✓ | — |
| Имя профиля | 1.5rem (24px) | 22px | P2 |
| Локализация | i18n-ключи | русские строки захардкожены мимо i18n | P1 |
| **Мёртвый код** | — | `EditContactView.module.scss` **не импортируется никем** — удалить | P1 |

### 9.12 Секции-карточки (Section)

Референс: `_section.scss:4-106`, `section.tsx`. Наш: `shared/ui/SidebarSection/*`, `settings/kit.tsx:51-72`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Карточка: padding .5rem 0; radius 24; margin-bottom 1rem; `--section-box-shadow` | ✓ | 1:1 ✓ | — |
| Заголовок `-name` | 16px, weight **500**, primary | weight 600 | P2 |
| Caption | margin -0.375rem 0 1rem, 14/18, padding 0 1rem | 6px 24px 0, 13.5px | P2 |
| kit.Section: margin 12px вместо 16px | — | ОТСЕБЯТИНА | P2 |

### 9.13 Итог домена

- **P0**: анимация `width` вместо transform у панели профиля; нет infinite scroll в shared media; некликабельные Phone/Username/Bio; два DOM-дерева вместо морфа аватар-хедера.
- **P1**: нет стековой slider-навигации с параллаксом; `.headerScrolled` — несуществующее состояние; крестик-морф `animated-close-icon`; bio в одну строку; QR у username; геометрия Row (56px/absolute-иконка/4.5rem); Music/Voice без tweb-плеера; sticky-порог табов; русские строки мимо i18n; мёртвый `EditContactView.module.scss`; Text Size 12–24; sessions без подтверждения.
- **P2**: длительности/размеры по таблицам (slide-fade 400ms, tabs 0.2s, thumb 12px, monkey 157, video-time radius 4px), отсутствующие блоки (Groups/Similar/Stories-табы, accent-picker, живое время), отсебятина (opacity-fade, accentGradient, Night Mode строка, rowActive).

---

## 10. Медиавьюер, видеоплеер, сториз

Референс: `tweb/src/components/mediaViewer/base.ts` + `index.ts` (актуальная реализация; `appMediaViewerNew.ts` — мёртвый, закомментирован целиком), `tweb/src/lib/mediaPlayer/*`, `tweb/src/scss/partials/_ckin.scss`, `tweb/src/components/stories/viewer.tsx` + `viewer.module.scss`.
Наш код: `web-client/src/components/messages/MediaLightbox.tsx`, `VideoControls.tsx`, `web-client/src/components/StoryViewer.tsx`, `core/pip.ts`.

### 10.1 Media viewer — DOM-структура

Референс: `tweb/src/components/mediaViewer/base.ts:318-445`, стили `tweb/src/components/mediaViewer/mediaViewer.scss:5-750`.
Наш код: `web-client/src/components/messages/MediaLightbox.tsx:376-483`, `MediaLightbox.module.scss`.

```
tweb                                                нас
.media-viewer-whole                                 .root (portal в body / PiP)
├─ .overlays (bg rgba(0,0,0,.2), fixed)             ├─ .backdrop.chrome (rgba(0,0,0,.92))
│  └─ .media-viewer (bg rgba(0,0,0,.88))            ├─ .topBar.chrome
│     └─ .media-viewer-content                      │  ├─ Avatar 36 + .info (sender, date · «N из M»)
│        └─ .media-viewer-container                 │  └─ .toolbar [pip?][rotate][zoomin][download][close]
│           └─ .media-viewer-media (visibility:hidden — скрытая цель)
├─ .media-viewer-topbar (h 3.5rem, absolute)        ├─ .nav.navLeft / .nav.navRight (круглые кнопки)
│  ├─ .media-viewer-topbar-left                     └─ .mover
│  │  ├─ btn mobile-close                              ├─ .aspecter
│  │  └─ .media-viewer-author (avatar-44, name, date)  │  └─ .zoomLayer (framer drag/scale/rotate)
│  └─ .media-viewer-buttons                            │     └─ img | video
│     [delete][forward][download][rotate][zoomin][close]  └─ VideoControls (сиблинг аспектера)
├─ .media-viewer-movers  ← ЕДИНЫЙ слой zoom/pan-transform
│  ├─ .media-viewer-switcher-left/-right (зоны 7rem)
│  └─ .media-viewer-mover-wrapper (clip-path)
│     └─ .media-viewer-mover
│        └─ .media-viewer-aspecter → img/video/.ckin__player
├─ zoom-container (слайдер зума)
└─ .media-viewer-caption (scrollable)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Кнопки topbar | `[delete][forward][download][rotate][zoomin][close]` (`base.ts:356`, `index.ts:102`) | `[pip][rotate][zoomin][download][close]` — **forward и delete ОТСУТСТВУЮТ**, pip в topbar — ОТСЕБЯТИНА (в tweb PiP-кнопка живёт в правых контролах плеера, `mediaPlayer/index.ts:328-337`) | P1 |
| Мобильное меню ⋮ (forward/download/delete) | есть (`index.ts:147-162`, `setBtnMenuToggle`) | ОТСУТСТВУЕТ | P2 |
| Скрытие кнопок по правам (`no-forwards`, canDelete) | `index.ts:396-418, 489-498` | ОТСУТСТВУЕТ | P2 |
| Аватар автора | 44px (`base.ts:2037`, `.avatar-44`) | 36px | P2 |
| Дата | `formatFullSentTime` — «Today at 14:05» (`base.ts:2043`) | `friendlyMsgTime` + счётчик «N из M» — счётчик у message-media в tweb ОТСУТСТВУЕТ (только в avatar-viewer через `.media-viewer-date-dot`, `mediaViewer.scss:754-759`) | P2 |
| Клик по автору → перейти к сообщению | `index.ts:268-290` (`onAuthorClick`: close → `setInnerPeer`) | ОТСУТСТВУЕТ | P2 |
| Прозрачность хрома | кнопки/автор `opacity: .4`, hover → 1 (`mediaViewer.scss:459-471`, `$inactive-opacity`) | всегда `opacity: 1` | P1 |
| Высота topbar | 3.5rem, `padding: 0 1.25rem`, кнопки `padding .5rem .75rem; gap .25rem` (`mediaViewer.scss:447-457, 55-63`) | `padding: 10px 12px`, gap 4px | P2 |
| Фон | `.overlays` .2 + `.media-viewer` .88 (`mediaViewer.scss:11,744`) | 0.92 одним слоем | P2 |
| Caption (подпись сообщения) | `.media-viewer-caption`: центр, `bottom: 0`, scrollable `max-height 6rem; max-width 50rem`, `--link-color: #60a5e9`, opacity .4→1 hover (`mediaViewer.scss:113-217`, `index.ts:112-143, 304-356`) | **ОТСУТСТВУЕТ полностью** | **P0** |
| Клик по фону/картинке = close | клик по IMG тоже закрывает (`base.ts:1127-1129`) | `.mover` делает `stopPropagation` (`MediaLightbox.tsx:415`) — клик по фото не закрывает | P1 |

Направление фикса: добавить caption (скроллящийся, по центру снизу), кнопки forward/delete с проверкой прав, opacity .4 на хром, закрытие по клику на фото, перенести PiP в панель плеера.

### 10.2 Анимация открытия/закрытия (FLIP mover)

Референс: `base.ts:1176-1798` (`setMoverToTarget`), `base.ts:86-87` (`OPEN_TRANSITION_TIME = 200`, `MOVE_TRANSITION_TIME = 350`), scss `.media-viewer-mover:280-436`.
Наш код: `MediaLightbox.tsx:226-316`, `MediaLightbox.module.scss:39-75`.

Что совпадает (порт честный): fixed-мовер `transform-origin: top left`, неуниформный `scale3d(sx,sy)` + контр-скейл аспектера (`setFullAspect`, `base.ts:1858-1882` ↔ `MediaLightbox.tsx:252-257`), эллиптическая компенсация радиуса `x/sx / y/sy` (`base.ts:1454-1459` ↔ `tsx:68-69`), радиус на закрытии на полпути (legacy `delay/2` ↔ `tsx:311`), `doubleRaf`, 200ms `ease`, fade вместо полёта если миниатюра ушла из вьюпорта (`base.ts:1345-1357` ↔ `tsx:294-314`), перезамер rect на закрытии.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Clip-path обрезка по scrollable-предку | `.media-viewer-mover-wrapper` + `getMediaViewerClipPath`: во время полёта мовер клипается по границам видимой области чата (между topbar и инпутом), inset анимируется к `inset(0px)` (`base.ts:1320-1367, 1481-1509`, `clipPath.ts`) | ОТСУТСТВУЕТ — при открытии из полуобрезанного бабла клон рисуется поверх шапки чата/композера | P1 |
| Наследование радиуса от клипающих предков | `computeEffectiveCornerRadii` — по углам грида sharedMedia (`base.ts:2071-2114`) | только радиус самой миниатюры (`tsx:62-67`) | P2 |
| needOpacity на открытии из офф-скрина | fade-in вместо полёта (`base.ts:1355-1357`) | только на закрытии | P2 |
| Canvas-снапшот кадра видео как thumb полёта | `base.ts:1535-1577` (`getMediaViewerSnapshotSize`, drawImage) | летит `<img>` миниатюры; для видео летит постер — приемлемо, но нет снапшота текущего кадра при закрытии игравшего видео | P2 |
| Скрытие плавающих оверлеев источника | tweb прячет только `.video-time`, `.time.is-floating`, `.video-play` (`base.ts:2136-2173`), сам бабл остаётся видимым | мы прячем **весь** элемент-источник `visibility: hidden` (`useLightbox.ts:81`) — за клоном пустая дыра до `onClosingStart` | P2 |
| Ожидание конца перехода | `waitForMoverTransition` — `transitionend` + fallback `delay+100` (`base.ts:1800-1841`) | голый `setTimeout(OPEN_MS)` (`tsx:315`) | P2 |
| Центрирование | `applyCenterStyles`: `top: calc(50% + (80−110)/2 px)` — резервы 80 сверху / 110 снизу (`base.ts:95-96, 2236-2252`) | геометрический центр, бокс `0.92vw × 0.84vh` (`tsx:204`) | P1 |
| `mediaBoxSize` | `100vw × (100vh − 190px)` desktop (`base.ts:2267-2274`) | `92vw × 84vh` — ОТСЕБЯТИНА | P1 |
| Пейджинг prev/next | старый мовер **уезжает** за экран `MOVE_TRANSITION_TIME 350ms ease` (`moveTheMover`, `base.ts:1928-1956`; `.moving` — `mediaViewer.scss:374-376`), новый въезжает с `fromRight` | `nav()` сбрасывает flyFrom и делает snap + crossfade картинки (`tsx:271-275`, `snapToRest`) — **слайд-анимации листания НЕТ** | **P0** |
| Resize | `applyLayoutVariables` — refit + recenter (`base.ts:2198-2234`) | `vw/vh` читаются при рендере, слушателя resize нет | P2 |

### 10.3 Zoom / pan / rotate

Референс: `base.ts:81-84` (ZOOM_STEP 0.5, MIN 0.5, MAX 4), слайдер `base.ts:367-399`, `zoom-container` scss:674-736, boundaries `base.ts:795-850`, инерция `base.ts:636-648`, dblclick `base.ts:565-571`, rotate `base.ts:932-968`.
Наш код: `MediaLightbox.tsx:270, 343-345, 355, 418-430`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Диапазон | 0.5 – 4, шаг кнопки 0.5 | 1 – 4 (`Math.max(1, …)`), шаг 0.4/0.5/0.3 (клавиша/кнопка/колесо — три разных) | P1 |
| Zoom-слайдер (панель снизу) | `.zoom-container` 17.125rem × 3.375rem, `bottom: 1.25rem`, RangeSelector 0.5–4, кнопки ±, скрыт пока не зумишь (`is-visible`) | ОТСУТСТВУЕТ | P1 |
| Кнопка zoomin ↔ zoomout | иконка меняется, повторный клик сбрасывает зум (`base.ts:473-478`, `replaceButtonIcon:744`) | всегда zoomin, только += шаг | P2 |
| Двойной клик | scale 3 (`ZOOM_INITIAL_VALUE + 2`), зум **в точку клика** (`changeZoomByPosition`) | scale 2.5 в центр | P2 |
| Пан-границы | точный кламп по rect медиа (`calculateOffsetBoundaries`) + инерция броска | framer `dragConstraints ±140·zoom` — константа от балды (`tsx:356`) | P1 |
| Механика применения | transform на **`.media-viewer-movers`** (общий слой, `transform-origin: 0 0`, транзишен `--open-duration`; `applyMoversTransform`, `base.ts:852-873`) | framer spring на внутреннем `.zoomLayer` | P2 |
| Ctrl+колесо / `-`/`=` c Ctrl | пинч через SwipeHandler `onZoom`, клавиши только с ctrl (`base.ts:1145-1148`) | голое колесо зумит всегда (перехватывает скролл), `+`/`-` без модификатора | P2 |
| Rotate | против часовой (−90), **refit-scale**: на 90°/270° повёрнутый бокс вписывается в вьюпорт (`getRotationFitScale:890-904`); контролы видео блокируются пока повёрнуто (`updateVideoControlsLock:962-968`); rotation сбрасывается на смене медиа (`base.ts:2419-2425`); закрытие раскручивает к ближайшему upright в полёте (`base.ts:1466-1476`) | −90 есть; refit НЕТ (горизонтальное фото после поворота вылезает за экран); контролы не прячутся; на закрытии `setRot(0)` мгновенно (`tsx:280`) — снап вместо раскрутки | P1 |
| Хоткей R для rotate | НЕТ в tweb | есть (`tsx:345`) — ОТСЕБЯТИНА | P2 |
| `is-zooming`: спрятать caption/стрелки | `mediaViewer.scss:602-608` | нечего прятать (caption нет), стрелки остаются | P2 |

### 10.4 Навигация prev/next, клавиатура, свайп

Референс: switcher `mediaViewer.scss:219-278`, `base.ts:422-428, 463-471`, свайп `base.ts:522-587`, клавиатура `base.ts:1132-1174`.
Наш код: `MediaLightbox.tsx:321-353, 402-407`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Вид стрелок | невидимые зоны 7rem во всю высоту; иконка `font-size: 3rem` появляется `opacity 0→1` при ховере зоны (`&-switcher:hover .media-viewer-sibling-button`) | постоянно видимые круглые кнопки 54px с фоном `rgba(255,255,255,.08)` — ОТСЕБЯТИНА | P1 |
| Исчерпание списка | кнопка получает `.hide` (`base.ts:440-441, 2387-2388`) | листание **по кольцу** `(i+dir+len)%len` (`tsx:274`) — ОТСЕБЯТИНА | P1 |
| Подгрузка истории медиа | `SearchListLoader`, prefetch при `next.length < 10` (`base.ts:2382, 2993-3002`) | только уже загруженные в ленту сообщения (`useLightbox.ts:46`) | P2 |
| Свайп (touch) | горизонтальный >20%/125px — prev/next; вертикальный — close (`base.ts:545-562`); `highlight-switchers` по тапу | ОТСУТСТВУЕТ | P1 |
| Стрелки на видео | ←/→ = **навигация** (seek только в fullscreen, `mediaPlayer/index.ts:405-407`) | ←/→ = seek ±5с на любом видео, навигация недоступна (`tsx:336-342`) | P1 |
| Клавиши плеера F / M | `KeyF` fullscreen, `KeyM` mute (`mediaPlayer/index.ts:396-399`) | ОТСУТСТВУЮТ (в title кнопок «(F)»/«(M)» написано, но обработчиков нет) | P1 |
| Esc | через `appNavigationController` | `pushEsc` + `useNavLayer` — паритет по поведению | ✓ |

### 10.5 Видеоплеер (ckin)

Референс: `tweb/src/lib/mediaPlayer/index.ts`, `tweb/src/scss/partials/_ckin.scss`, `tweb/src/helpers/dom/controlsHover.ts`.
Наш код: `web-client/src/components/messages/VideoControls.tsx`, `VideoControls.module.scss`, `videoPlayback.ts`.

DOM tweb (`buildControls`, `index.ts:603-628` + `stylePlayer`):

```
.ckin__player.default
├─ video.ckin__video
├─ button.default__button--big.toggle      ← БОЛЬШАЯ play-кнопка по центру (4rem)
├─ .default__gradient-bottom.ckin__controls  (h 49px + padding-top 49px, translate3d(0,50px,0) скрыт)
└─ .default__controls.ckin__controls         (translate3d(0,52px,0) скрыт → translateZ(0) в .show-controls)
   ├─ .progress-line (MediaProgressLine: __filled, __loaded, thumb, превью-скраббер)  margin: 0 16px
   └─ .bottom-controls (h 2.25rem, padding 0 .625rem)
      ├─ .left-controls: [toggle play][.player-volume: иконка 2.25rem + слайдер 50px][.ckin__time: 0:00 / 0:00]
      └─ .right-controls: [playback-rate (меню 0.5/1/1.5/2/3)][quality HD][pip][fullscreen]
└─ .speed-drag-handler (зажать ЛКМ → 2x c подсказкой-стрелками)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Большая play-кнопка по центру | `default__button--big` 4rem, скрыта в `is-playing`/`is-seeking`/`is-buffering` (`_ckin.scss:44-79, 169-184, 245-249`) | **ОТСУТСТВУЕТ** | **P0** |
| Анимация появления панели | `transform: translate3d(0,52px,0)` → `translateZ(0)` (слайд снизу, `_ckin.scss:144-161`), градиент — отдельный слой со своим translate 50px | `opacity + translateY(12px)` вместе с градиентом (`VideoControls.module.scss:4-21`) | P1 |
| Автоскрытие | `ControlsHover`: mousemove **по плееру**, таймаут **3000ms**, mouseleave прячет сразу, исключение — уход на caption/topbar; `cursor: none` пока играет и скрыто (`controlsHover.ts:57-120`, `_ckin.scss:169-176`) | глобальный `window mousemove`, таймаут **2500ms**, `cursor: none` нет (`VideoControls.tsx:13, 87-104`) | P1 |
| Прогресс-линия | высота **5px**, radius 6px, thumb **13px** (scale-транзишен, focus-scale 1.125), `__loaded` = `#fff` @ opacity .3, фон `rgba(255,255,255,.38)` (`_ckin.scss:270-407, 98-114`) | трек 4px/radius 2px, thumb 12px, буфер `rgba(255,255,255,.55)` без opacity-слоя | P2 |
| Превью-скраббер (storyboard) + время над курсором | есть: `media-progress-line__current-time-info` (`mediaViewer.scss:1090-1125`), `preview.tsx`, storyboard из alt_documents (`base.ts:118-193`) | ОТСУТСТВУЕТ (у бэка нет storyboard — допустимо, но нет даже плавающего времени над курсором) | P2 |
| Скорости | `[0.5, 1, 1.5, 2, 3]`, MAX 5, кнопка — geometric-иконка «1x», меню `min-width 140px` с чек-маркой, `Alt+=`/`Alt+-` меняют (`playbackRateButton.tsx:24-25`, `index.ts:402-404`) | `[0.5, 1, 1.5, 2]` — нет 3; текстовая кнопка; Alt-хоткеев нет | P2 |
| Speed-drag (зажать = 2x) | `speedDragHandler` + UI-плашка со стрелками (`mediaViewer.scss:911-995`) | ОТСУТСТВУЕТ | P2 |
| Время | `ckin__time` `margin-left: .875rem; font-size: .875rem` (14px), `<time>` элементы | 13px, margin 6px | P2 |
| Громкость | иконка 2.25rem + RangeSelector 50px, раскрытие анимацией **width** контейнера (`--hide-width → --show-width`), высота 4px, thumb .75rem (`_ckin.scss:186-243`); mute — 4 состояния иконки | близко (0→64px, hover), иконки volume_off/down/up | ✓/P2 |
| Клик по видео = play/pause | да, только не-touch (`index.ts:375-381`) | да (`MediaLightbox.tsx:445-449`) | ✓ |
| Dblclick по видео = fullscreen | `index.ts:436-440` | НЕТ (onDoubleClick для видео отключён) | P1 |
| Fullscreen-элемент | `.ckin__player` (wrapper); scss `.ckin__fullscreen` — `position: fixed; inset: 0; z-index 10000; video object-fit: contain` | мовер (`fullscreenRef={moverRef}`), `:fullscreen`-хак в scss — работает | P2 |
| Буферизация | `is-buffering` + ProgressivePreloader на мовере, прячет big-button (`base.ts:2742-2803`) | ОТСУТСТВУЕТ — при ожидании данных нет ни спиннера, ни состояния | P1 |
| Loop коротких видео | `video.loop = true` если `duration < 60` (`base.ts:2601-2603`) | НЕТ | P2 |
| Пауза других медиа при открытии | `appMediaPlaybackController.setSingleMedia` (`base.ts:2616-2625`) | НЕТ (голосовое может играть под видео) | P1 |
| Прогресс во время seek | пауза на время скраба + resume | есть (`VideoControls.tsx:158-186`) | ✓ |

### 10.6 PiP видео

Референс: `mediaPlayer/index.ts:328-337, 364-371, 533-597`; реакция вьюера: `base.ts:2665-2705`; клик по фону live → PiP `base.ts:1122-1125`.
Наш код: `MediaLightbox.tsx:391-393`, `core/pip.ts:34-46`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Кнопка | в right-controls плеера (`!IS_MOBILE && pictureInPictureEnabled`) | в topbar вьюера | P2 |
| Поведение вьюера при входе в PiP | **вьюер прячется**: mover `opacity 0`, `toggleWholeActive(false)`, оверлей и глобальные слушатели снимаются; выход из PiP на паузе → `close()`; выход с play → вьюер возвращается (`onPip`/`onPipClose`) | `enterPip()` просто вызывает `requestPictureInPicture` — лайтбокс остаётся висеть открытым поверх чата | **P1** |
| Пустое PiP до загрузки метаданных | `emptyPipVideo` + canvas-stream (`index.ts:575-596`) | НЕТ | P2 |
| Document-PiP всего клиента | `clientPip.tsx` | `core/pip.ts:enterAppPip` — аналог есть (переезд `#root`, стили, заглушка) | ✓ |

### 10.7 Stories viewer — DOM и размеры

Референс: `tweb/src/components/stories/viewer.tsx:2592-2739`, `viewer.module.scss`, размеры `store.tsx:523-535`.
Наш код: `web-client/src/components/StoryViewer.tsx:116-463`, `StoryViewer.module.scss`.

```
tweb .Viewer (fixed, flex center)                        нас .overlay (fixed, flex center)
├─ .ViewerBackground rgba(0,0,0,.9)                      └─ .card (одна карточка)
├─ N × .ViewerStoryContainer (--translateX, --scale)        ├─ video|img (object-fit: CONTAIN!)
│  │   активная --scale:1; соседи .small --scale:.33        ├─ StoryMediaAreas
│  ├─ .ViewerStory (width: var(--stories-width), 9/16)      ├─ .progress (top 8px)
│  │  ├─ .ViewerStoryContent > media (object-fit: cover)    ├─ .header (top 18px)
│  │  ├─ .hideOnSmall                                       ├─ .tapPrev/.tapNext
│  │  │  ├─ .ViewerStoryShadow (градиент сверху[+снизу])    ├─ .caption (плашка-пилюля)
│  │  │  ├─ .ViewerStorySlides (top .625rem, h .125rem)     ├─ .viewsBar | .footer (input+❤)
│  │  │  ├─ .ViewerStoryHeader (top 1rem, avatar 32)        └─ .viewersSheet (внутри карточки)
│  │  │  ├─ caption-оверлей (scrollable, mask)
│  │  │  ├─ .ViewerStoryMediaAreas
│  │  │  └─ reactions-меню
│  │  └─ .ViewerStoryInfo (аватар+имя 3rem на соседях)
│  └─ stories-input (полный ChatInput) | footer
└─ .ViewerClose (top/right 1rem)
```

| Аспект | tweb | у нас | P |
|---|---|---|---|
| **Карусель с боковыми превью соседей** | все соседние авторы отрендерены рядом, `--scale: .33`, `--translateX` = `(storyWidth − distance)·mult + …` c MARGIN 40 (`viewer.tsx:1742-1754`, scss:146-209); клик по соседу переключает; на соседях — большой аватар+имя (`ViewerStoryInfo`, scss:470-506); медиа соседа затемнено `opacity .5` | **ОТСУТСТВУЕТ** — одна карточка | **P0** |
| Размер | `height = 100vh − 72px`, `width = height·9/16` (`store.tsx:523-530`), radius `$border-radius-medium` с компенсацией `1/var(--scale)` | `height: min(92vh, 900px)`, radius 12px | P1 |
| Медиа | `object-fit: cover` (scss:377-382) | `object-fit: contain` — чёрные поля на фото не 9:16 | P1 |
| Переход между авторами | десктоп: слайд карусели (transition transform); **isFull (мобайл/портрет): куб** `rotateY(±90deg) translateX(∓50%)…` `--transition-time .3s` (scss:31-76; `isFull` = портрет или узкое окно, `viewer.tsx:2763-2767`) | нет ни слайда, ни куба — контент просто подменяется | **P0** |
| Фон | `rgba(0,0,0,.9)` (scss:113) | `rgba(0,0,0,.9)` | ✓ |
| Кнопка close | отдельная `.ViewerClose` top/right 1rem вне карточки (десктоп) + в header при isFull | в header карточки | P2 |

### 10.8 Stories — анимация открытия/закрытия

Референс: `viewer.tsx:3151-3315` (`animate`), `3069-3103` (`open`, клон аватарки).
Наш код: `StoryViewer.tsx:118-131`.

tweb, 250ms `cubic-bezier(0.4, 0.0, 0.6, 1)` (Web Animations API, keyframes реверсируются вручную на закрытие):
1. **клон аватарки** летит из ленты в шапку сториз: `translate(0,0) scale(rectFrom.width/32)` → `translate(dx,dy) scale(1)`;
2. контейнер: из rect аватарки — `translate3d(dx,dy,0) scale3d(w/W, h/H) + borderRadius 50% + opacity 0` → `identity + borderRadius 0` (opacity 1 уже к 30%);
3. фон и close — просто opacity;
4. **соседние маленькие контейнеры** разъезжаются из-за активного: `translateX + offset(±60·i)px, scale .165` → `scale .33`, opacity появляется после 50%.

У нас: framer `opacity 0→1` оверлея + `scale 0.9→1` карточки за 0.25s. **Полёт из аватарки ОТСУТСТВУЕТ, обратный полёт на закрытии ОТСУТСТВУЕТ** — **P0**. Easing наш, не `cubic-bezier(0.4,0,0.6,1)`.

### 10.9 Stories — прогресс-сегменты и авто-переход

Референс: `viewer.tsx:107` (`STORY_DURATION = 5e3`), `1756-1765` (`playOnReady`: **видео = длительность видео**), scss:211-244.
Наш код: `StoryViewer.tsx:150-166`, scss:44-81.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Длительность видео-сториз | `videoDuration + 0.001`; прогресс = позиция видео | CSS-анимация **всегда 5s** — сегмент заканчивается раньше/позже видео, next стреляет посреди ролика | **P0** |
| Геометрия | top .625rem; высота .125rem; `padding 0 .625rem 0 .4375rem`; зазор `margin-inline-start .1875rem`; radius 1px; `min-width .375rem`; box-shadow `0 0 3px rgba(0,0,0,.2)` | top 8px; left/right 8px; gap 3px; radius 2px; без shadow и min-width | P2 |
| Заполнение | `:before` с `width: var(--progress)` — управляется из JS-тикера (`animateSingle`), пауза точная | CSS `@keyframes` + `animationPlayState` — прогресс OK, но рассинхрон с видео | P1 |
| Пауза не сбрасывает прогресс при next/prev | tweb хранит elapsed в сторе | `key={current}` перезапускает — при prev назад прогресс с нуля (как tweb, ок) | ✓ |

### 10.10 Stories — header, пауза, mute

Референс: `viewer.tsx:2673-2716` (header), `2989-3067` (свайп + hold), `2701-2716` (кнопки).
Наш код: `StoryViewer.tsx:168-208`, `useStoryViewer.ts:104-118`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Правая часть header | `[privacy-icon][play/pause][mute (если видео)][⋮ menu][close (isFull)]` | `[stats (ОТСЕБЯТИНА — в tweb «ViewStatistics» пункт меню ⋮)][⋮][close]` — **нет кнопки play/pause, нет кнопки mute** | P1 |
| Звук видео | видео со звуком, mute-кнопка + tooltip «no sound» (`viewer.tsx:1792-1813`) | `<video muted>` жёстко — **звук сториз не воспроизводится вообще** (`StoryViewer.tsx:136`) | **P0** |
| Hold-to-pause (зажать = пауза + скрыть интерфейс) | SwipeHandler `onStart`: пауза через 200ms удержания, `.hold` прячет `.hideOnSmall` (`viewer.tsx:3036-3038, 2605`; scss:180-185) | ОТСУТСТВУЕТ | P1 |
| Время «5m ago» рядом с именем | `getDateText` (`viewer.tsx:1957-2009`), name bold + время secondary opacity .5 | только имя, времени нет | P1 |
| Privacy-иконка (close friends/contacts) | scss:345-357 + tooltip | ОТСУТСТВУЕТ | P2 |
| Клик по имени → профиль | `onProfileClick` | НЕТ | P2 |
| Тап-зоны | ⅓ prev / остальное next (клик-обработчик по `rect.left + width/3`) | 33.33%/66.66% | ✓ |
| Клавиатура | →/← throttle 200ms, Space toggle, ↓/Esc close (`viewer.tsx:2773-2824`) | то же без throttle | ✓/P2 |
| Свайпы (touch) | ↓/→/← (`viewer.tsx:2990-3018`) | ОТСУТСТВУЮТ | P2 |
| Меню ⋮ | 12+ пунктов: pin, share, copy link, download, stealth, archive, statistics, delete, report (`viewer.tsx:2102-2250`) | своя: pin/edit/share/delete; чужая: stealth/repost/share. Нет copy link, download, report, archive | P2 |

### 10.11 Stories — caption

Референс: scss:508-568, логика `viewer.tsx:1843-1944`.

tweb: caption — **оверлей во всю карточку** (`top: calc(100% − 320px); padding-top: 264px`), скроллящийся, с mask-градиентом по краям, `font-size 16`, text-shadow; клик разворачивает с анимированным скроллом (`scrollPath`, easeOutCubic 300ms); пока развёрнут — медиа затемняется `opacity 1 − captionOpacity·0.5` и **фото-история ставится на паузу**, видео — в loop; `.ViewerStoryShadow.hasCaption` добавляет нижний градиент.

У нас: маленькая пилюля `bottom: 12px` с `background rgba(0,0,0,.5) + blur` (scss:121-140) — и подложка-блюр, и геометрия, и отсутствие разворота/паузы — расхождение. **P1**.

### 10.12 Stories — reply-инпут и реакции

Референс: scss:735-939 (`stories-input` — полный ChatInput: attach, emoji, запись голоса, btn-reaction с `--focus-translateX`-хореографией), реакции-панель scss:668-705 (319px, `btn-menu-reactions`), футер своих сториз scss:385-457 (высота 3rem, stacked-avatars просмотревших).
Наш код: `StoryViewer.tsx:288-363`, scss:142-265.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Reply-инпут | полный ChatInput (markdown, emoji-дропдаун, attach, войс, анимация расширения на фокус `--chat-input-focus-offset: 135px`) | голый `<input>` + Enter | P1 |
| Кнопка реакции | `btn-reaction` поверх инпута, дефолт ❤ `#FF3B30`, панель — общий `btn-menu-reactions` | своя панель из 7 эмодзи — приемлемое приближение | P2 |
| Футер своей истории | `.ViewerStoryFooter`: слева stacked-avatars зрителей + «N views», справа delete/forward | пилюля «Просмотры (N)» | P2 |
| Отправка reply | reply-to-story на бэке | обычный DM (ограничение бэка, задокументировано) | P2 |

### 10.13 Stories — список зрителей

tweb: `openViewsList` → **общий попап** `showPickUserPopup` с поиском и реакцией зрителя у строки (`viewer.tsx:2339-2370`).
У нас: bottom-sheet внутри карточки (`StoryViewer.tsx:366-404`) без поиска и реакций зрителей. P2.

### 10.14 Stories — media areas

Референс: scss:570-658, `viewer.tsx:609-830`. Наш код: `StoryMediaAreas.tsx`.

Координаты `left/top/width/height %` + `translate(-50%,-50%) rotate(var(--rotate))` — у нас так же ✓. Расхождения: tweb reaction-area — белый круг с «хвостиком» из двух пузырей (`&Bubble` 24%/10%), стикер 72% внутри, счётчик снизу появляющийся; размер шрифта счётчика от `--stories-width`; у нас — плоская пилюля с Emoji. P2.

### 10.15 Итог домена

**P0:** caption в media viewer отсутствует; нет слайд-анимации листания prev/next (350ms `moveTheMover`); нет большой центральной play-кнопки плеера; нет карусели соседних авторов сториз + перехода (слайд/куб); нет анимации открытия сториз из аватарки; видео-история живёт 5с вместо длительности видео; видео сториз всегда muted.

**Отсебятина к удалению:** PiP-кнопка в topbar вьюера, счётчик «N из M», хоткей R, кольцевое листание, постоянные круглые стрелки, кнопка статистики в header сториз, framer-spring для зума (в tweb — CSS-transition на `.media-viewer-movers`).

---

## 11. Реакции, поллы, спец-контент

**Важно про референс:** в этом чекауте tweb опрос уже переписан на Solid — актуальный код `src/components/chat/bubbleParts/pollMessageContent/*` (+ `styles.module.scss`), а `src/scss/partials/_poll.scss` — легаси старого `poll-element`, который в рантайме больше не создаётся. Сверять надо с новым.

### 11.1 Чипы реакций под сообщением (reaction-block)

Референс: `_reaction.scss:81-230`, `_reactions.scss:1-24`, `chat/reaction.ts:719-1097`, `reactions.ts:259-446`, `_chatBubble.scss:2240-2268, 1655-1687, 3549-3567`.
Наш код: `messages/MessageReactions.tsx:1-129`, `MessageRow.module.scss:252-441`.

DOM tweb:
```
reactions-element.reactions.reactions-block.reactions-like-block
├─ custom-emoji-renderer.reactions-renderer (общий canvas, если есть custom-emoji реакции)
├─ reaction-element.reaction.reaction-block[.is-chosen.forwards][.is-last][.is-paid]
│  ├─ div.reaction-sticker[.is-regular|.is-custom|.is-static]   ← 22×22, стикер center_icon (CSS раздувает до 40×40, --reaction-offset:-9px)
│  ├─ span.reaction-counter                                      ← formatNumber(count)
│  └─ div.stacked-avatars (вместо счётчика, avatarSize 24)
└─ … (время переезжает СЮДА: .reactions-like-block .time { order:100 })
```
DOM наш (структурно эквивалентен): `div.reactions > div.reactionChip[.starChip][.reactionChosen][.isLast] > (.reactionEmoji Emoji(22) | .reactionCount | .reactionAvatars) + {trailing время}`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Пилюля 30px (22+8), radius=высоте, padding 0 .5rem | ✓ | ✓ | — |
| chosen: `:before` scale(0)→1, transition 300ms только с `.animating` | `reaction.ts:1086-1097` | тот же приём через defer-кадр ✓ | — |
| hover: `:after` alpha .08 | ✓ | ✓ | — |
| Иконка реакции — **lottie/webp стикер** `center_icon` 40×40 в 22×22 боксе | стикер | системный unicode-эмодзи 22 | P1 (вне Telegram нет доков реакций, но эмодзи крупнее/иначе центрован) |
| Custom-emoji реакции (общий canvas-renderer) | есть | ОТСУТСТВУЕТ (модель `r.emoji: string`) | P2 (нет на бэке) |
| Счётчик: `font-weight: var(--font-weight-bold)` = **500** | `_reaction.scss:210-217` | **700** (`:396`) | **P1** — заметно жирнее |
| Счётчик: `formatNumber` (1.2K) | `reaction.ts:1035` | сырое `r.count` | P2 |
| Правило «счётчик vs аватары» (count<4 && canRenderAvatars → аватары) | `reaction.ts:1013-1084` | совпадает ✓ (нюанс с пустым recent) | P2 |
| Отступ ряда | -2px (`_reactions.scss:17-20`) | -3px | P2 |
| В теле сообщения: `--light-filled-message-primary-color` фон, counter `--message-primary-color` | `_chatBubble.scss:2240-2250` | `.reactionsInside` ✓ | — |
| is-message-empty (стикер/кружок): out → chosen surface + counter primary, `--margin-horizontal:.25rem`, flex-end | `_chatBubble.scss:3549-3572` | `.emptyMediaCol` ✓, но `--margin-horizontal` не сужен и hover не-chosen не белый (`:1677-1685`) | P2 |
| **Анимация срабатывания** (around-effect 80px, generic-fallback `ReactionGeneric` с летящими копиями; выстрел и на чужие unread-реакции с задержкой 150ms) | `reaction.ts:1099-1470`, `reactions.ts:420-446` | **ОТСУТСТВУЕТ** — реакция появляется без эффекта | **P1** (ассет `ReactionGeneric.json` — локальный в tweb assets/tgs, портируем) |
| Reaction tags (Saved Messages, SVG-ярлык 43×30) | `_reaction.scss:232-339` | ОТСУТСТВУЕТ | P2 |
| Платный чип `.is-paid`: цвета #ffbc2e/rgba(.2)/#e98111 | ✓ | `.starChip` ✓ | — |
| `.is-paid`: звезда 22×22 | `_reaction.scss:172-175` | `StarIcon size={18}` | P2 |
| `.is-paid`: Sparkles + `effect-active` → scale3d(1.5) + плавающий `+N` (font-rounded 26px, золотой градиент) | `reaction.ts:852-885`, `_reaction.scss:189-207,341-375` | ОТСУТСТВУЕТ | P1 |
| StackedAvatars: row-reverse, border .125rem, margin −.875rem | ✓ | ✓ | — |

Направление фикса: (1) счётчик 700→500; (2) портировать generic-эффект срабатывания; (3) formatNumber; (4) paid-эффект при быстрых повторных тапах.

### 11.2 Быстрая панель реакций над контекстным меню

Референс: `_button.scss:649-900`, `chat/reactionsMenu.ts:39-260`.
Наш код: `conversation/MessageContextMenu.tsx:22-125`, `MessageContextMenu.module.scss:10-70`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Таблетка 40px, radius 40, drop-shadow, blur | ✓ | ✓ | — |
| Ячейка 36×28, эмодзи 28; максимум 7 + «ещё» | ✓ | ✓ | — |
| Набор реакций — **серверный** `getAvailableReactionsByMessage` (пер-чат ограничения) | `reactionsMenu.ts:230-257` | хардкод `['❤️','👍','👎','🔥','🥰','👏','😁']` | P1 |
| Появление: контейнер сам scale(.8)→1 c origin от стороны | `_button.scss:666-678` | панель едет внутри общей анимации Menu | P2 |
| «Хвостик» bubble-big | `_button.scss:792-816` | ОТСУТСТВУЕТ | P2 |
| Анимации appear/select (lottie) | есть; CSS hover-scale у tweb ВЫКЛЮЧЕН | hover scale(1.25) — документированная замена | P2 |
| Снапшот кликнутой иконки → «полёт» в чип (`stashFlightSource`) | `reactionsMenu.ts:159-172` | ОТСУТСТВУЕТ | P1 |

### 11.3 Hover-реакция на бабле

Референс: `_chatBubble.scss:414-445` — `.bubble-hover-reaction`: круг 1.875rem, `inset-inline-end: calc(30px * -.75)`, bottom 0, surface + `--menu-box-shadow`, opacity 0 + scale(.8) → `.is-visible` scale(1); у out зеркалится.

У нас: **ОТСУТСТВУЕТ**. **P1** — заметный UX-элемент tweb на десктопе (быстрый лайк при наведении). (См. также §4.11.)

### 11.4 Опрос в сообщении

Референс (актуальный): `bubbleParts/pollMessageContent/PollMessageContent.tsx:442-663`, `PollOption.tsx:118-379`, `styles.module.scss:24-613`, `roundPercents.ts`.
Наш код: `messages/PollBubble.tsx:16-131`, `PollBubble.module.scss:1-141`.

DOM tweb:
```
.container (бабл)
├─ .header > .headerTitle(bold 500) + .headerSubtitle(14: PollType + AvatarGroup голосовавших) + ButtonIcon 'lamp' (объяснение)
├─ .pollOption (padding 12px 12px 12px 10px; min-width 260px)
│  ├─ .clickableArea (absolute, ripple + hover)
│  ├─ .checkContainer 24×24  ← Transition: Spinner | InMessageCheckbox | .percent (12 bold)
│  ├─ .labelRow > .labelText + .labelStats(.labelNumber 12 + AvatarGroup 26) 
│  │  ├─ .labelProgress (absolute, h 4px, translateY(13px)) > .labelProgressFill (width: 5px + p*(100%-5px); transition linear ~600ms·Δ)
│  │  ├─ PathDot (точка-загрузка перед показом процентов, 0.4s)
│  │  └─ .chosenCheckbox (мини-чекбокс .875rem НА полосе: translate(-30px,18px); green/red в викторине)
├─ AddOption | .footer > .footerButton («Vote» / «View Results») | .timer | AutoStartedConfetti
```
DOM наш: `.poll > .question + .option(.left 30px: .check|percent + .body: labelRow + .track > .bar) + .footer`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Процент: **анимированный** отсчёт 0→N после PathDot | `PollOption.tsx:340-379` | статичный | P1 |
| Округление — **largest remainder**, сумма ровно 100 | `roundPercents.ts` | `Math.round` на каждый — сумма ≠ 100 | **P1** |
| Полоса: min 5px, transition width **linear**, длительность ∝ Δ | `styles.module.scss:264-276` | `max(pct,5%)` + `.4s ease` | P2 |
| «Мой выбор»: мини-чекбокс НА полосе (зел/красн в викторине) | `styles.module.scss:312-351` | галка/крест в строке статистики справа | P1 |
| Ripple + hover всей строки | `styles.module.scss:198-217` | hover rgba(0,0,0,.05), ripple нет | P2 |
| Спиннер пока голос уходит | `PollOption.tsx:132-153` | `busy`-флаг без визуала | P2 |
| Аватары голосовавших (заголовок + вариант) | `PollMessageContent.tsx:526-533` | ОТСУТСТВУЕТ | P1 |
| Объяснение викторины (лампочка) | `:536-552` | ОТСУТСТВУЕТ | P1 |
| **Конфетти** при верном ответе | `:388-397,444-446` | ОТСУТСТВУЕТ | P1 |
| Таймер закрытия (close_date) | `:654-660` | ОТСУТСТВУЕТ | P2 |
| «View Results» → просмотр результатов | `:373-385` | футер-надпись без действия | P1 |
| Цвета викторины | `#5CC85E` / `#ff595a` (base.scss:277-279) | `#4ec643` / `#e5484d` | P2 |
| min-width 260px | ✓ | ✓ | — |

Направление: roundPercents + анимация процентов/полосы, «моя» отметка на полосе, конфетти (портировать `tweb/src/components/confetti.ts`), футер-кнопка результатов.

### 11.5 Кастом-эмодзи в тексте

Референс: `_customEmoji.scss:1-65`, `base.scss:92` (`--messages-custom-emoji-size: text + 4px`), `lib/customEmoji/*`.
Наш код: `RichText.tsx:65-94`, `RichText.module.scss:25-43`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер инлайн: **текст + 4px** (16→20) | ✓ | `fontSize × 1.2` (16→19) — заменить на `+4px` | P2 |
| Вёрстка: `display:inline` + `:before`-спейсер, `vertical-align: middle` | `_customEmoji.scss:1-17` | `inline-block; vertical-align:-0.2em` | P2 |
| Рендер: **общий канвас** на сообщение (батч) + animationIntersector | `lib/customEmoji/renderer.ts` | по-элементно StickerMedia + свой IO — честная замена, масштабируется хуже | P2 |
| `--custom-emoji-size` наследуется от контекста (статусы/реакции) | есть | не используется | P2 |

### 11.6 Emoji-статус и Premium/Verified бейджи

Референс: `base.scss:1548-1586`, `generatePremiumIcon.ts`.
Наш код: `EmojiStatus.tsx`, `PremiumBadge.tsx`, `VerifiedBadge.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| `.emoji-status`: бокс **18px**, margin-inline-start .25rem, custom-emoji док, sparkles для collectible | `base.scss:1561-1577` | 16px, unicode, без sparkles | P1 |
| `.premium-icon`: звезда, **color: `var(--primary-color)`** (акцент темы) | `base.scss:1548-1559` | **`#9275ff` фиолетовый хардкод** | **P1 — ОТСЕБЯТИНА по цвету** |
| `.verified-icon`: 1.25rem в списках / 1.125rem в бабле | — | SVG 1:1 ✓, дефолт 16px | P2 |

### 11.7 Star gifts (бабл подарка)

Референс: `_starGift.scss`, `chat/bubbles/starGift.module.scss:1-149`, `starGift.tsx`.
Наш код: `messages/GiftBubble.tsx:12-41`, `GiftBubble.module.scss:1-39`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Ширина 13.75rem (220px) | ✓ | 200-240 ✓ | P2 |
| Стикер подарка 120×120 (lottie) | `:23-28` | emoji 84px | P1 (бокс можно 120) |
| Бейдж «Limited 1K» | `starGift.tsx:107-117` | ОТСУТСТВУЕТ | P2 |
| Backdrop/sparkles у unique | есть | ОТСУТСТВУЕТ | P2 |
| Цена в звёздах пилюлей | нет в бабле tweb | есть `.price` — ОТСЕБЯТИНА | P2 |

### 11.8 Stars-badge

Референс: `_starsBadge.scss:1-66` (20px, radius 10, градиент `#ffcd3a→#ffaa00`, анимации).
У нас: **ОТСУТСТВУЕТ** — платных сообщений нет. P2 (фича бэка).

### 11.9 Sparkles

Референс: `_sparkles.scss:1-29` (keyframes `sparkle`, `--sparkles-duration: 5s`), `sparkles.ts:19-90` (11 фиксированных искр).
У нас: системы нет; имитация только в `PremiumModal.tsx:48` (самопис). **P2** — портировать перед paid-реакциями/gifts.

### 11.10 Чек-лист (todo)

Референс: `chat/bubbles/checklist.tsx:96-174`, `checklist.module.scss:1-151`.
Наш код: `messages/ChecklistBubble.tsx:63-129`, `ChecklistBubble.module.scss:1-118`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Чекбокс **круглый** 1.375rem | `checklist.module.scss:54-79` | квадрат 20px radius 5 | **P1** |
| Аватар выполнившего **выезжает из-под чекбокса** (translateX(14px), scale .75→1) | `:81-97` | аватар+имя строкой ниже | P1 |
| Строка во всю ширину бабла (`margin-inline: -0.5rem`), hover-заливка | `:29-48` | компактная строка radius 8 | P2 |
| line-through: только readonly | `:125-127` | всегда + opacity .6 | P2 |
| **Конфетти** при 100% (`mode:'poppers'`) | `checklist.tsx:49-58` | ОТСУТСТВУЕТ | P1 |
| readonly-вид (галка/точка, тосты о причинах) | `:63-94,130-137` | клик игнорируется молча | P2 |
| Инлайн-добавление пункта в бабле | в tweb НЕТ (только попап) | есть `addRow` — ОТСЕБЯТИНА | P2 |
| Подпись «N of M completed» по центру внизу | `:137-144` | слева в футере | P2 |

### 11.11 Giveaway

Референс: `chat/giveaway.tsx:196-358`, `_chatBubble.scss:2487-2590`.
Наш код: `messages/GiveawayBubble.tsx:29-102`, `GiveawayBubble.module.scss:1-83`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Стикер lottie 160px, `margin-top: -2rem` (вылезает за верх бабла) | `_chatBubble.scss:2510-2514` | 🏆 96px без выноса | P1 |
| Счётчик «X{n}»: пилюля с border 2px цвета фона бабла | `:2516-2535` | пилюля без бордера ✓ приблизительно | P2 |
| Чипы каналов-участников (peer-color, avatar 30) | `giveaway.tsx:252-276` | ОТСУТСТВУЮТ | P1 |
| Дата победителей | `formatFullSentTime` | live-обратный отсчёт + кнопка «Participate» + счётчик — ОТСЕБЯТИНА документированная (комментарий: требование фичи) | P2 |
| Клик по баблу → инфо-попап | `giveaway.tsx:44-195` | нет | P2 |

### 11.12 Попапы создания

- **CreatePollPopup** ↔ `popups/createPoll/*`: у нас стоковый набор. В tweb дополнительно: **solution (объяснение) для викторины** (maxExplanationLength 200) — **P1**; медиа к вопросу/вариантам, shuffle, duration — P2. Лимит вариантов: tweb `poll_answers_max ?? 12`, у нас 10 — P2.
- **CreateChecklistPopup** ↔ `popups/checklist.tsx`: набор совпадает ✓.
- **CreateGiveawayPopup** ↔ `popups/boostsViaGifts.tsx`: наша упрощённая форма под свой бэкенд-примитив — системное расхождение, P2.

### 11.13 Итог домена

**P1:** анимация срабатывания реакции (generic-эффект + полёт из панели); счётчик реакций 700→500; hover-кнопка быстрой реакции; серверный набор реакций для панели; полл (округление, анимации, отметка на полосе, конфетти, объяснение, аватары, View Results); чек-лист (круглые чекбоксы, выезжающий аватар, конфетти); PremiumBadge фиолетовый → `--primary-color`; EmojiStatus 18px; giveaway (чипы каналов, вынос стикера); paid-реакция effect-active + sparkles.

**ОТСЕБЯТИНА:** цвет PremiumBadge; инлайн-добавление пункта чек-листа; Participate/countdown в giveaway (задокументировано); пилюля цены в GiftBubble.

**Оправданные замены (вне Telegram недоступно):** unicode-эмодзи вместо стикеров реакций; hover-scale вместо lottie select; глиф-fallback custom-emoji; эмодзи вместо lottie в gift/giveaway. Но generic-эффект реакций и конфетти — локальные ассеты tweb, портировать можно.

---

## 12. Система анимаций и переходов (сквозная)

**Резюме.** tweb строит ВСЁ движение на **CSS-переменных-токенах** (`base.scss:39-77`), одном JS-механизме **TransitionSlider** (`components/transition.ts`) с классами `.from/.to/.animating/.backwards`, событии **heavy-animation** (пауза lottie/видео на время тяжёлых переходов) и **animationIntersector** (авто play/pause по вьюпорту). Spring-физики в tweb **нет вообще** (`grep spring` по `src/**/*.ts` — 0 совпадений; «пружинность» — только overshoot-безье: `.34,1.56,.64,1`, `.22,.75,.7,1.3`, `.12,1.1,.56,1.2`, `.35,.35,.47,1.34`). У нас: framer-motion в **94 файлах**, 10 мест с `type:'spring'` (все — отсебятина), нет токенов длительностей в CSS, нет heavy-animation, intersector — заглушка, `reduceMotion` не гейтит CSS.

### 12.1 Базовые токены длительностей/easing

Референс: `base.scss:39-77`; JS: `config/transitions.ts:11-16` (`standard: cubic-bezier(.4,0,.2,1)`, 300ms вперёд / 250ms назад).

| Токен tweb | Значение | У нас | P |
|---|---|---|---|
| `--transition-standard-easing` | `cubic-bezier(.4,.0,.2,1)` | `EASE` в `motion.ts:11` ✓; в SCSS — 14 разрозненных литералов, токена нет | P1 |
| `--transition-standard-in/out-time` | `.3s` / `.25s` | `DUR={in:.3,out:.25,fast:.2}` ✓ (только framer; CSS не видит) | P1 |
| `--layer-transition` | `.2s cb(.4,0,.2,1)` | ОТСУТСТВУЕТ; руками: ShellLayout 0.26s, MarkupTooltip 0.14s | P1 |
| `--tabs-transition` | `.2s ease-in-out` | ОТСУТСТВУЕТ; TabSlide → 0.3s | P1 |
| `--btn-menu-transition` | `.2s cb(.4,0,.2,1)` | Menu.tsx:49 ✓ | — |
| `--esg-transition` | = btn-menu | EmojiDropdown ✓ | — |
| `--input-transition` | `.2s ease-out` | Input 0.15s без easing | P2 |
| `--popup-transition` | `.15s cb(.4,0,.2,1)` | Popup DUR=0.15 + EASE ✓ | — |
| `--btn-corner-transition` | `.2s cb(.34,1.56,.64,1)` | ScrollDownFab ✓; ComposeFab — **spring 420/32** | P1 |
| `--chatlist-badge-transition-in/out` | `.25s cb(.35,.35,.47,1.34)` / `.25s cb(.35,.35,.7,1)` | ОТСУТСТВУЕТ | P2 |
| `--slide-header-transition` | `.4s ease-in-out` | ОТСУТСТВУЕТ | P2 |
| `--sticker-viewer-switch-transition` | `.2s cb(.12,1.1,.56,1.2)` | ОТСУТСТВУЕТ (long-tap viewer не портирован) | P2 |
| `--bubble-transition-in/out` | transform+opacity на standard in/out | bubbleAnimations ✓ по значениям | — |

**Фикс:** завести в `styles/_tokens.scss` блок 1:1 из `base.scss:39-78` и заменить литералы.

### 12.2 TransitionSlider: навигация экранов и табов

Референс: `transition.ts:23-146`, `_transition.scss`, `_slider.scss:226-243`.

| Режим tweb | Механика | У нас | P |
|---|---|---|---|
| `navigation` (250ms; `slider.ts:11`) | входящий с `+width`, **уходящий → `-width*0.25` + `filter: brightness(80%)`** (параллакс); backwards — `-out`; cleanup timeout +100 | `slideInRight` (motion.ts:28-32): x 100%→0 ок, но **нижний экран стоит на месте: нет −25% и brightness(80%)** (SettingsView, ContactsView, CallsView, PostStats, StoryStats, settings/kit, RightsEditor) | **P0** |
| `tabs` (200ms; `--tabs-transition .2s ease-in-out`) | оба едут на полную ширину, transform в px от rect | TabSlide.tsx:34-49: ±100%, но 0.3s + EASE вместо 0.2s ease-in-out | P1 |
| `zoom-fade` (`_transition.scss:20-61`) | from: fade-out .15s ease; to: fade-in + scale 1.1→1 .15s; backwards: scale .95→1 | Поиск в сайдбаре (tweb 150ms). У нас Sidebar.tsx:235: opacity+scale .96+y:-6, 0.22s — ОТСЕБЯТИНА | P1 |
| `slide-fade` (`_transition.scss:101-149`) | `.4s`; fade + translateX ∓1.5rem | ОТСУТСТВУЕТ (нужен для заголовков shared media, 400ms) | P2 |
| `fade` (`:66-96`) | `.15s ease` | наши fade 0.2s — дольше | P2 |
| `premiumTabs` (250ms) | как tabs | PremiumModal/Checkout — spring 320/28 — ОТСЕБЯТИНА | P1 |
| Вспом. классы `.fade-enter-active .1s`, `.fade-2/4-*`, `.t-move .2s`, `.t-zoom .12s` (`:164-212`) | есть | ОТСУТСТВУЮТ | P2 |

Механизм-гэп: каждый heavy-переход tweb диспатчит `dispatchHeavyAnimationEvent(deferred, transitionTime*2)` (`transition.ts:362-369`) — лотти/видео замирают на время слайда. У нас аналога НЕТ. **P0** для плавности.

### 12.3 Таблица @keyframes

tweb — 55 объявлений; у нас — 16. Ключевые сопоставления:

| Keyframe tweb | Где/тайминг | У нас | P |
|---|---|---|---|
| `fade-in/out-opacity` (+backwards) | .15s ease (переходы), .2s linear (баблы) | FadeIn/FadeOut `.2s linear` ✓ (баблы); версий .15s нет | P2 |
| `bubbleSelected` (`_chatBubble.scss:6-18`; 2s linear, 0→1(25%)→0) | подсветка jump-to | framer opacity [0,.5,.5,0] times [0,.12,.5,1] — кривая другая, пик .5 vs 1 | P1 |
| появление сообщения: `.can-zoom-fade` scale3d(.8)+opacity → transition `--bubble-transition-in`; лестница `animateAsLadder` шаг **40ms** + heavy-event | `bubbles.ts:10363-10394, 10442` | BubbleAppear ✓ (scale/easing); heavy-event НЕТ | P1 |
| `dotFirst/dotMiddle/dotLast` (.6s linear infinite) | точки «печатает» | TypingIndicator ✓ | — |
| `upload` 1s, `eye`/`eye-move` 1.8s | статусы тайпинга | ОТСУТСТВУЮТ | P2 |
| `ripple-effect` (`--ripple-duration .7s`, моб. .4s/.27) | ripple | порт ✓; **нет мобильного override** | P2 |
| `rotate` preloader (1s и 2s linear) + `dash/dashNew` | прелоадеры | 1s ✓; `dashNew` (растяжение дуги) ОТСУТСТВУЕТ | P2 |
| `wave` shimmer (2s cb(0.4,0,0.6,1)) | скелетоны | 1.4s ease / 1.25s — другие тайминги | P2 |
| `grow-icon/hide-icon` (.4s ease-in-out) | смена иконки send/record | ОТСУТСТВУЕТ; вместо — whileTap 0.92 (ОТСЕБЯТИНА) | P1 |
| `grow-input/hide-input` .25s | поиск | ОТСУТСТВУЕТ | P2 |
| `input-shake` .2s | ошибка инпута | ОТСУТСТВУЕТ | P2 |
| `audio-dots` 1.5s, `loading` 1s | голосовые | Transcription ✓ близко | — |
| `zoom-fade-*-move`, `slide-fade-*-move` | режимы слайдера | ОТСУТСТВУЮТ (см. §12.2) | P1 |
| `sparkle`, `drop-outline-move .5s`, `pollAnswerRotate`, `scaleIn`, `text-loading` | нишевые | ОТСУТСТВУЮТ | P2 |
| наши без референса: `storyFill 5s`, `lbFadeIn`, `skelShimmer`, `waSpin`, `rp-rotate` | — | допустимая замена/фича | — |

### 12.4 `transition:` системно

- Гистограмма: tweb — 121×`.2s`, 24×`.15s`, 24×`.1s`, 12×`.3s`, 10×`.25s`. У нас — 50×`0.15s`, 44×`0.2s`. Hover-конвенция tweb — **`.2s`** (`mixins/_hover.scss`); у нас массово `0.15s ease` (~40 мест: IconButton, MenuItem, ReportPopup, TopicsPanel, NowPlayingBar, AuthFlow…). Систематическое ускорение ховеров — **P1** (заменить одной волной).
- Чекбокс: tweb галка `.2s .05s` + дорисовка `.1s`; у нас `.2s .05s` ✓ / `.15s delay .15s` — вторая фаза длиннее. P2.
- Toggle: tweb `.1s cb(.22,.75,.7,1.3)`; у нас `.14s` та же кривая. P2.
- MarkupTooltip: tweb `var(--layer-transition)` = .2s; у нас 0.14s default-ease. P1.

### 12.5 animationIntersector

tweb `components/animationIntersector.ts:43-452`: единый IntersectionObserver, группы (`chat-N`, EMOJI…), `onlyOnePlayableGroup`, lock/unlock, интеграция с `idleController`, `setAutoplay/setLoop` по liteMode-ключам, `toggleVideosUnder`.

У нас `src/components/animationIntersector.ts:1-21` — **тип-shim, реализации НЕТ** (этап 2 tlottie-порта). Частичный суррогат: per-элементный IO в `StickerMedia.tsx:139-153` — только video-стикеры, без групп/idle/лимитов. **P0** (CPU/батарея, поведение 1:1).

### 12.6 liteMode / animation-level

tweb: `helpers/liteMode.ts` (ключи all/gif/video/emoji/…) + `body.animation-level-0|2` и миксин `@include animation-level(2)` вокруг КАЖДОЙ значимой transition (`mixins/_animationLevel.scss`); TransitionSlider проверяет `liteMode.isAvailable('animations')` (`transition.ts:258`).

У нас: один флаг `reduceMotion`; App.tsx:183 `MotionConfig reducedMotion` + `data-reduce-motion` на `<html>`. **Ни один SCSS не читает `data-reduce-motion`** (grep — 0) → все CSS-transition/animation живут при «выключенных» анимациях. `helpers/liteMode.ts` — shim. **P0** (фича заявлена в настройках, но работает частично).

**Фикс:** глобальный гейт `html[data-reduce-motion] * { transition-duration: 0s !important; animation: none !important; }` — или честный порт `animation-level`-миксина.

### 12.7 Heavy-animation

tweb `hooks/useHeavyAnimationCheck.ts` + вызовы из transition.ts:368, fastSmoothScroll.ts:87, bubbles.ts:10444, themeController.ts:396. У нас — ОТСУТСТВУЕТ полностью. **P0** в связке с §12.5/12.6.

### 12.8 btn-menu / popup

- Контекст-меню: tweb scale(.8)→1, .2s cb(.4,0,.2,1), origin по 9 позициям — наш Menu ✓. OK/P2.
- Popup: tweb opacity .15s + `translate3d(0,3rem,0)→0` — наш Popup ✓. Но параллельные самописные попапы: PremiumModal, PremiumCheckout, PasskeyIntroPopup, EmojiStatusPicker — **spring 320/28**; GiftInfoPopup/SendGiftPopup/StarsPopup — близко, но scale-появление — отсебятина. P1.

### 12.9 framer-motion: полный реестр spring (всё — ОТСЕБЯТИНА, tweb springs не имеет)

| Место | Параметры | tweb-эквивалент |
|---|---|---|
| MediaLightbox.tsx:52,429 | spring 260/30 (zoom) | `transform .2s ease` (OPEN_TRANSITION_TIME=200) |
| NowPlayingBar.tsx:32 | spring 500/30 + whileTap .85 | нет пружины; кнопки без tap-scale |
| ComposeFab.tsx:45 | spring 420/32 | `--btn-corner-transition .2s cb(.34,1.56,.64,1)` |
| StoriesRow.tsx:182 | spring 520/24 + stagger .05/.07 | сторис-лента без каскада |
| StoryViewer.tsx:354 | spring 500/18 | — |
| EmojiStatusPicker:50, PremiumCheckout:78, PremiumModal:79,115, PasskeyIntroPopup:70 | spring 320/28 (500/30) | popup = `.15s cb(.4,0,.2,1)` |

Прочие не-spring расхождения: ShellLayout 0.26s (tweb layer .2s); NotificationBanner 0.28s; SearchView 0.22s `[0.16,1,0.3,1]` — кривая не из tweb; useForumPanel/Sidebar 0.22s (tweb topics `.3s`); NewGroupFlow `[0.3,0,0.2,1]` — опечатка кривой; whileTap/whileHover scale (~20 мест) — в tweb жестовых scale нет вовсе, есть ripple.

Соответствуют tweb: TabSlide (механика), Composer reply/edit-бары (тайминг ✓, in vs out P2), Checkbox, Popup, QrModal, ScrollDownFab, ChatHeader, ChatDialogs.

### 12.10 Скролл к сообщению

tweb `helpers/fastSmoothScroll.ts`: JS-tick, длительность `250 + path/1500*(600-250)` ms, easing `1-(1-t)^3.5` (<500px) / `1-(1-t)^5`, кап 1500px с телепортом, heavy-event, отмена по контейнеру.
У нас `core/dom/smoothScrollToElement.ts`: кап 1500 ✓, но дальше **нативный `scrollTo({behavior:'smooth'})`** — UA-кривая вместо power-easing 250-600ms, нет отмены/heavy-event; `afterScrollSettles` — поллинг-костыль. Плюс ~12 разрозненных `behavior:'smooth'`. **P1**.

### 12.11 Смена темы

tweb `themeController.ts:370-455`: View Transition + WAAPI-клип `duration = standard×2` (**600ms вперёд / 500ms назад**), reverse-режим, DPR-скейлинг, heavy-event + safety-skip 2000ms. Наш `useThemeToggle.ts:33-40`: только `::view-transition-new`, **450ms**, без reverse/DPR/heavy. P1.

### 12.12 Порядок фиксов

1. **P0:** порт `animationIntersector` (этап 2 tlottie) + `useHeavyAnimationCheck` + CSS-гейт для `reduceMotion`.
2. **P0→P1:** параллакс `navigation` (−25% + brightness 80%) — общий wrapper в `motion.ts` вместо голого `slideInRight`.
3. **P1:** выпилить все 10 spring → длительность+безье из токенов (таблица выше даёт замену) — это же путь к удалению framer-motion.
4. **P1:** токены `--transition-*` в `_tokens.scss` 1:1; волна hover `0.15s→.2s`; TabSlide → `.2s ease-in-out`; поиск-оверлей → zoom-fade 150ms; fastSmoothScroll → честный JS-порт.
5. **P2:** мобильный ripple, keyframes-хвосты (`grow-icon`, `input-shake`, `dashNew`, shimmer 2s), toggle 100ms, bubbleSelected-кривая.

---

## 13. Auth, поиск, сервисные экраны

**Вводная по референсу:** в этом чекауте tweb легаси-страницы `pageSignIn.ts`/`pageAuthCode.ts` и `src/scss/pages/*` **удалены** — актуальный референс auth-флоу: `src/pages/authFlow.tsx` + `AuthCardsHost.tsx` + `src/pages/cards/*.tsx` + `authFlow.module.scss` (+ `_pages.scss`). Аудит — против них.

### 13.1 Auth-флоу: shell/host

Референс: `AuthCardsHost.tsx:154-176`, `authFlow.module.scss:19-108`.
Наш код: `auth/AuthFlow.tsx:486-534`, `AuthFlow.module.scss:5-53`.

tweb DOM:
```
#auth-pages.whole.host (overflow:hidden)
├── Button.Icon back .closeButton   (fixed 24px; только при аккаунте ≠ 1)
├── Button.Icon darkmode_filled .themeButton (fixed 24px — всегда)
└── <Scrollable> (flex column, fade-in по loadFonts)
    ├── .placeholder.placeholderTop (flex:1; min-height с клиренсом под кнопки)
    ├── .cardsContainer (width: min(24.5rem, 100%))
    │   └── .card (surface, radius 2rem, padding 1rem)
    └── .placeholder (flex:1)
```
У нас: `.overlay (fixed, flex center) > <ChatBackground> + corner-кнопки + .card (384px, radius 32, padding 40px 36px, box-shadow)`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Фон экрана | нет обоев — surface | `<ChatBackground>` (градиент+doodle) — ОТСЕБЯТИНА | P1 |
| Padding карточки | 1rem | 40px 36px | P1 |
| Тень карточки | нет | есть — ОТСЕБЯТИНА | P2 |
| Скролл-структура | Scrollable + flex-плейсхолдеры с клиренсом | overflow-y + flex center — на низком вьюпорте карточка подлезет под кнопки | P1 |
| Кнопка «назад» | только возврат к прежнему аккаунту; между карточками стрелки нет | стрелка на любом шаге ≠ phone — ОТСЕБЯТИНА | P1 |
| Corner-кнопки | фон `--message-highlighting-color` | rgba(255,255,255,.2) хардкод | P2 |

### 13.2 Переходы карточек

Референс: `authFlow.module.scss:279-327`, `AuthCardsHost.tsx:227-241`. Наш: `AuthFlow.tsx:521-531`, `core/accountTransition.ts`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Card enter/exit | translateX(±24px), opacity .18s + transform .2s | x ±40, 0.2s EASE | P2 |
| hostEnter 0.4s translateX(100px) / hostExit 0.2s scale(1.025) | есть | порт ✓ | — |
| main-screen enter/exit (scale 1.75, 0.2s) | есть | есть ✓ | — |

### 13.3 SignIn (телефон)

Референс: `cards/SignInCard.tsx:237-278`, `countryInputField.ts`, `telInputField.ts`.
Наш код: `AuthFlow.tsx:254-357`, `AuthFlow.module.scss:69-148`.

tweb: логотип — плоский SVG `#logo` 120px `fill: var(--primary-color)`; CountryInputField — outlined input с floating-label «Country», стрелка, дропдаун со **всеми странами** (эмодзи-флаг, имя, код) + живой фильтр; TelInputField — одно поле «Phone Number», `+код` внутри значения, ввод `+49` сам переключает страну; NEXT → «PleaseWait» + спиннер; QR/Passkey — btn-transparent кнопки.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Поле страны | полный список стран + поиск, floating-label | свой бокс с hardcoded **8 странами** без поиска | **P0** |
| Поле телефона | одно поле, `+код` внутри, автопереключение страны | код отдельным Text + национальная часть; переключения по вводу кода нет | P1 |
| Логотип | плоский SVG 120px primary | свой 96px круг с градиентом + тень — ОТСЕБЯТИНА | P1 |
| «Keep me signed in» | **НЕТ в актуальном tweb** | есть — ОТСЕБЯТИНА | P1 |
| NEXT при сабмите | «PleaseWait» + preloader в кнопке; ошибка → error-label поля | opacity-disable; ошибка строкой снизу | P1 |
| Инпуты 54px | ✓ (border 1px + focus-слой 2px) | 54px ✓, border 1.5px | P2 |

### 13.4 AuthCode (код)

Референс: `cards/AuthCodeCard.tsx:319-343`, `codeInputField.tsx:187-291`, `monkeys/tracking.ts`.
Наш код: `AuthFlow.tsx:403-441`, `AuthFlow.module.scss:277-301`.

tweb: TrackingMonkey (обезьянка следит за вводом: frame по прогрессу), телефон в заголовке + **карандаш «изменить номер»**; CodeInputField — **ЕДИНЫЙ невидимый input** (absolute, one-time-code) поверх отрисованных ячеек `.digit` (48×48, radius 12, gap 10; цифра влетает translateY(20px)→0 spring-безье, исчезает scale(.5); мигающий caret).

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Обезьянка TrackingMonkey | есть | **ОТСУТСТВУЕТ** — статичный логотип | **P0** |
| Код-инпут | один input + ячейки; вставка из буфера, autocomplete one-time-code | 5 отдельных `<input maxLength=1>` — вставка кода не работает | **P0** |
| Карандаш «изменить номер» | есть | ОТСУТСТВУЕТ | P1 |
| Анимации цифр/каретки | есть | нет | P1 |
| Ячейка | 48×48 | 48×56 | P2 |
| Ошибка | error-рамка + errorLabel height 1lh (без прыжка layout) | текст снизу, layout прыгает | P2 |

### 13.5 Password (2FA)

Референс: `cards/PasswordCard.tsx:223-249`, `monkeys/password.ts:16-56`.
Наш код: `AuthFlow.tsx:444-481`, `PasswordMonkey.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Peek-обезьянка (0↔16 по глазку) | есть | есть ✓ | — |
| Размер | 100/130 | 157 | P2 |
| Hint пароля | в **floating label** поля, обновление поллингом | в placeholder `Password (hint)` | P1 |
| «Forgot password?» | есть → recovery-флоу | **ОТСУТСТВУЕТ** | P1 |
| Кнопка при сабмите | PleaseWait + preloader | opacity | P2 |

### 13.6 QR-логин

Референс: `cards/SignQRCard.tsx:220-244`, `authFlow.module.scss:195-237`. Наш: `AuthFlow.tsx:359-401`, `auth/QrCode.tsx`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Размер/подложка | 240px, `--light-filled-primary-color` (тема-зависимая), цвета QR из переменных темы | 220px, белый `#fff`/чёрный QR — в тёмной теме белый квадрат | P1 |
| Перерисовка на theme_changed | есть | нет | P1 |
| Появление | preloader → hide-icon/grow-icon .4s | текст «Обновление…» | P2 |
| Маркеры инструкции | 22px, фон `--light-primary-color`, текст primary | 24px, фон primary, белый текст | P2 |

### 13.7 Passcode lock screen

Референс: `passcodeLock/passcodeLockScreen.tsx:191-248`, `passcodeLockScreen.module.scss`, `_passcodeLockScreen.scss:1-73`.
Наш код: `PasscodeLockScreen.tsx`, `PasscodeLockScreen.module.scss`.

tweb: фон — градиент-обои, `toNextPosition()` на **каждый введённый символ**; карточка 320px surface radius 20; поле с floating-label «Enter your passcode» (ошибка в label); фирменная анимация — **иконка замка из топбара летит в центр** (--x/--y/--scale, .3/.4s), морфится → появляется обезьянка.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Анимация замка топбар→монки | есть | ОТСУТСТВУЕТ | P1 |
| Фон-обои + вращение градиента на ввод | есть | плоский `--background-color` | P1 |
| Карточка 320 surface radius 20 | есть | 360 без фона/radius | P1 |
| Ошибка в label поля | есть | отдельной строкой | P1 |
| Глазок-обезьянка | ✓ | ✓ | — |
| Too many attempts (60с, переживает reload) | есть | retryAt + счётчик секунд (у tweb счётчика нет) | P2 |

### 13.8 Глобальный поиск: результаты (SearchView)

Референс: `sidebarLeft/index.ts:1097-1166`, `_searchGroup.scss`, `emptySearchPlaceholder/index.tsx:17-51`.
Наш код: `SearchView.tsx`.

tweb: пустой запрос → секция **People** (горизонтальная лента топ-пиров) + Recent+Clear; запрос → Chats → Global search → Messages (+ChatTypeMenu); date-саджесты и peer-фильтры встраиваются в инпут как entity; пустое состояние — lottie-утка 156px.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Секция «People» (топ-пиры, гориз. скролл) | есть | ОТСУТСТВУЕТ | P1 |
| Recent + Clear | есть | есть ✓ | — |
| Порядок/названия секций Chats/Global/Messages | ✓ | ✓ 1:1 | — |
| Date-саджесты / peer-entity в инпуте | есть | ОТСУТСТВУЮТ | P1 |
| Пустое состояние | lottie-утка + title + subtitle | текстовая строка | P1 |
| Подсветка совпадений | ✓ | ✓ | — |
| Переключение табов | TransitionSlider 250ms | framer 80px/0.22s | P2 |

### 13.9 Поиск по чату

Референс: `chat/topbarSearch.tsx` + `_topbarSearch.scss`, mobile `_chatSearch.scss`.
Наш код: `conversation/ChatSearchCard.tsx`, `ChatHeader.module.scss:37-166`, `useChatHeaderSearch.ts`.

tweb desktop: панель absolute в топбаре; поле radius 21 h 40 (`--old-input-background-color` → при фокусе surface+тень); внутри инпута — **[↑][↓] ArrowButton'ы** + clear, «from:»-режим с peer-entity-чипом ВНУТРИ инпута; ниже — `.collapsable` (height-transition, **max-height 271px**) с реакциями-тегами и результатами; справа — календарь. Mobile: футер «3 of 20» + кнопки ↑/↓.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Стрелки prev/next в поле | есть | **ОТСУТСТВУЮТ** | **P0** |
| Счётчик «1 of 20» | есть | ОТСУТСТВУЕТ | P1 |
| Раскрытие результатов | height-transition, max 271px | framer height auto, max **60vh** | P1 |
| Фильтр «от кого» | «from:»-entity внутри инпута, backspace убирает | отдельный чип-ряд под полем | P1 |
| Фильтр по реакциям | лента реальных тегов-реакций | статический emoji-грид — частично ОТСЕБЯТИНА | P1 |
| Фильтр по типу | нет в tweb topbarSearch | есть — ОТСЕБЯТИНА | P2 |
| Jump to date (календарь) | ✓ | ✓ | — |
| Скролл активного результата к центру | есть | нет | P2 |

### 13.10 Пустые состояния

Референс: `bubbles.ts:10466-10560`, `_chatBubble.scss:4118-4145`. Наш: `EmptyChatGreeting.tsx`, `App.module.scss:31`.

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Пустой приватный чат | **service-бабл** (`.service-msg` max-width 232px, title «No Messages», НАСТОЯЩИЙ greeting-стикер; клик = отправка стикера) | своя карточка rgba+blur, emoji 👋 160px; клик = 👋 | P1 |
| «Select a chat to start messaging» | **НЕТ в tweb WebK** (пустая колонка = только обои) | pill есть — ОТСЕБЯТИНА (осознанно оставить или убрать) | P1 |
| Пустая группа (подсказки) | есть | нет | P2 |

### 13.11 Онбординг/загрузка

| Аспект | tweb | у нас | P |
|---|---|---|---|
| Preloader (75% дуга, 1 об/с) | ✓ | ✓ | — |
| Скелетон чатлиста | НЕТ (список сразу) | шиммер 9 строк — ОТСЕБЯТИНА (продуктово лучше, не 1:1) | P2 |
| Fade-in шрифтов на auth (loadFonts) | есть | нет | P2 |

### 13.12 Итог домена

- **P0**: country-picker из 8 hardcoded стран без поиска; код-инпут из 5 отдельных input (нет вставки/one-time-code); отсутствие стрелок prev/next в поиске по чату.
- **P1**: нет TrackingMonkey на коде; нет «Forgot password?»; нет карандаша у номера; QR не тема-зависимый; passcode-экран без карточки/обоев/анимации замка; «Keep me signed in» и corner-back — отсебятина; нет «People»-ленты и lottie-утки в поиске; результаты чат-поиска 60vh vs 271px; greeting не service-бабл; «Select a chat» pill — не из WebK.
- Совпадает 1:1: hostEnter/hostExit/main-screen анимации, preloader-swing, секции глобального поиска, DatePickerPopup для jump-to-date, peek-обезьянка, структура чат-поиска.

---

## 14. Сводка приоритетов

### 14.1 Все P0 (ломает восприятие «это Telegram» — чинить в первую очередь)

Колонка «Статус» — ревизия 2026-08-09 (см. блок «Ревизия» в начале документа; там же границы проверки).

| # | Домен | Проблема | Референс tweb | Статус 2026-08-09 |
|---|---|---|---|---|
| 1 | Фундамент | **Roboto не бандлится** — всё приложение рендерится системным шрифтом | `src/scss/fonts/_roboto.scss` | ✅ `styles/_fonts.scss` + 13 woff2 в `assets/fonts/` |
| 2 | Баблы | reply/имя/forwarded не рендерятся ни в одном не-текстовом бабле (фото/альбом/voice/документ) | `_chatBubble.scss:1059-1125`, `bubbles.ts:9337-9598` | ✅ единый `bubble-content-wrapper`, `messages/MessageContent.tsx:500-560` |
| 3 | Баблы | blockquote — полностью другой визуал (нет фона/иконки/коллапса до 3 строк) | `_quote.scss:57-106` | ❌ **ОТКРЫТ, и хуже описанного** — см. врезку под таблицей |
| 4 | Медиа | медиабокс 320×420 вместо 420×400 (моб. 340×340) + нет `setAttachmentSize` (мин. 200/320/120/368); альбом 320/spacing 2 вместо 420/spacing 1 | `mediaSizes.ts:64-101`, `setAttachmentSize.ts:64-94`, `album.ts:56-58` | ✅ `core/dom/mediaSizes.ts` (+тест), `RealMediaBubble.tsx:120` |
| 5 | Медиа | видео ≤50 МБ не автоплеится инлайн в бабле | `video.ts:50,550-579` | ✅ `RealMediaBubble.tsx:29,162-166` |
| 6 | Voice/audio | музыкальный бабл вообще не воспроизводится (onClick не подключён) | `audio.ts:342-444` | ✅ `AudioRow` → `playQueue`/`toggle`, `RealMediaBubble.tsx:422-500` |
| 7 | Каркас чата | paddingTop ленты не учитывает пин-бар — первый бабл перекрыт плашкой | `_chat.scss:486` | ✅ `--pinned-floating-height`, `styles/tweb/_chat.scss:486` |
| 8 | Каркас чата | pinned bar: нет скролл-трекинга показанного пина и анимации смены (AnimatedSuper) | `pinnedMessage.tsx:529-589` | ✅ `conversation/PinnedBar.tsx` + `core/hooks/usePinnedBar.ts` |
| 9 | Каркас чата | нет corner-кнопок goto-mention/goto-reaction/goto-poll | `input.ts:824-880` | ✅ `conversation/CornerButton.tsx` |
| 10 | Каркас чата | плавающая дата не скрывается после остановки скролла | `_chatBubble.scss:498-506`, `_chat.scss:1343-1353` | ✅ снятие через 1.35 s, `Chat.tsx:1032-1039` |
| 11 | Каркас чата | CommentsBar: фейковые хардкод-аватары комментаторов | `chat/replies.ts` | ✅ `recent` из `commentRepliers`, `messages/ChatFeed.tsx:271-273` |
| 12 | Каркас чата | нет анимации перехода между чатами (tabs-слайд ±200px) | `_chat.scss:489-506`, `appImManager.ts:2237-2270` | ✅ `.chat.tabs-tab.active`, `Chat.tsx:1110-1117` |
| 13 | Левый сайдбар | сториз-fold в поисковую строку не подключён (`--stories-fold` мёртв) | `stories/list.tsx:124-243` | ✅ `foldInto`, `StoriesRow.tsx:123-127` |
| 14 | Попапы | delete-конфирм: две кнопки вместо чекбокса «Also delete for <имя>» + Delete | `popups/deleteMessages.ts:84-160` | ✅ `conversation/ChatMsgActionPopups.tsx:36,86` |
| 15 | Попапы | SchedulePopup: нативные date/time-инпуты вместо календаря tweb с withTime | `popups/datePicker.tsx:214-256` | ✅ `DatePickerPopup.tsx` / `SchedulePopup.tsx` |
| 16 | Попапы | конфирмы не на каркасе PopupPeer (вертикальные lowercase-кнопки, свой скрим) | `popups/peer.ts:36-120` | ✅ порт PopupPeer — `shared/ui/ConfirmPopup/` |
| 17 | Правый сайдбар | анимация `width` вместо transform — reflow каждый кадр | `_rightSidebar.scss:3-77` | ✅ transform, `UserInfoPanel.module.scss:25,32,48,53` |
| 18 | Правый сайдбар | shared media без infinite scroll (одна загрузка) | `appSearchSuper.ts` | ✅ offset/hasMore/onScrolledBottom, `userInfo/SharedMedia.tsx:118-159` |
| 19 | Правый сайдбар | Phone/Username/Bio некликабельны (нет копирования) | `peerProfile.tsx:655-658` | ✅ `UserInfoPanel.tsx:293,490,499` |
| 20 | Правый сайдбар | аватар-хедер: два DOM-дерева вместо морфа `is-collapsed` | `_profile.scss:4-399` | ✅ `is-collapsed`, `UserInfoPanel.module.scss:133-135` |
| 21 | Медиавьюер | caption сообщения отсутствует | `mediaViewer.scss:113-217` | ✅ `messages/MediaLightbox.tsx:68-70,106` |
| 22 | Медиавьюер | нет слайд-анимации листания prev/next (moveTheMover 350ms) | `base.ts:1928-1956` | ✅ порт `moveTheMover` 350 ms, `MediaLightbox.tsx:30-31` |
| 23 | Видеоплеер | нет большой центральной play-кнопки | `_ckin.scss:44-79` | ✅ `default__button--big`, `messages/VideoPlayer.tsx:8` |
| 24 | Сториз | нет карусели соседних авторов + перехода (слайд/куб) | `viewer.tsx:1742-1754` | ✅ порт `calculateTranslateX`, `StoryViewer.tsx:41,68` |
| 25 | Сториз | нет анимации открытия из аватарки (полёт клона + морф) | `viewer.tsx:3151-3315` | ✅ `components/storyViewerMorph.ts` (+тест) |
| 26 | Сториз | видео-история живёт 5с вместо длительности видео | `viewer.tsx:1756-1765` | ✅ `videoDurationMs`, `StoryViewer.tsx:236-237` |
| 27 | Сториз | видео всегда muted, кнопки mute нет | `viewer.tsx:1792-1813` | ✅ `StoryViewer.tsx:211-212,316` |
| 28 | Анимации | animationIntersector — тип-shim без реализации | `animationIntersector.ts:43-452` | ✅ полный порт, `components/animationIntersector.ts` (425 строк) |
| 29 | Анимации | heavy-animation событий нет вообще | `useHeavyAnimationCheck.ts` | ✅ `core/dom/heavyAnimation.ts` |
| 30 | Анимации | `reduceMotion` не гейтит CSS-анимации (SCSS не читает `data-reduce-motion`) | `mixins/_animationLevel.scss` | ✅ гейт `body.animation-level-0/2`, `App.tsx:268-272`; `data-reduce-motion` удалён |
| 31 | Анимации | navigation-переходы без параллакса уходящего экрана (−25% + brightness 80%) | `transition.ts:23-43`, `_slider.scss:226-243` | ⚠️ **частично + премиса неверна** — см. врезку под таблицей |
| 32 | Auth | country-picker: 8 hardcoded стран без поиска | `countryInputField.ts` | ✅ `auth/CountryInput.tsx` + `auth/countries.ts` |
| 33 | Auth | код-инпут: 5 отдельных input вместо единого поля (вставка кода не работает) | `codeInputField.tsx:187-291` | ✅ единое поле, `auth/CodeInput.tsx` |
| 34 | Auth | нет TrackingMonkey на шаге кода | `monkeys/tracking.ts` | ✅ `components/TrackingMonkey.tsx` |
| 35 | Поиск по чату | нет стрелок prev/next | `topbarSearch.tsx:695-721` | ✅ `conversation/TopbarSearch.tsx:242,354` |

#### №3 — открыт, и диагноз аудита занижен

Аудит писал «другой визуал». По факту визуала **нет вообще**: `RichText.tsx:280` рендерит цитату как
`<span className={s.quote}>`, но ключа `quote` в `RichText.module.scss` больше нет — его вместе с
`.code` и `.spoiler` выпилили в `3633a6f` (тот самый «Task 2.4, P0 №3»), а `RichText.tsx` в том
коммите **не тронули**. CSS-модуль на отсутствующий ключ отдаёт `undefined` → атрибут `class` не
проставляется вовсе. Итог: ни полосы, ни фона, ни иконки кавычки, ни сворачивания до 3 строк.
Та же беда у инлайн-кода (`RichText.tsx:266`, `s.code`) — спасает только элементный селектор
`code { font-family: var(--font-monospace) }` в `styles/index.scss:135`.

Это **третье срабатывание** одной и той же ловушки: раньше так же молча отвалились спойлер
(починен в `1202baa`) и весь экран `ChangePhone` (см. `web-client/backlogs/frontend/changephone-lost-styles.md`,
где предложено закрыть класс проблемы генерацией `.d.ts` на `*.module.scss`). Пока дыра не закрыта,
любой такой обрыв проходит мимо сборки и тайпчека.

#### №31 — частично, и премиса аудита неверна

JS-порт `slideNavigation` сделан (`core/dom/navigationTransition.ts`) и применён к экранам настроек
(`components/settings/kit.tsx:91`). Но исходное утверждение «navigation-переходы **колонок** без
параллакса» ошибочно: в tweb у колонок такого перехода нет вовсе — параллакс живёт у вкладок слайдера.
Параллакс для уходящей вкладки экранов левой колонки отложен осознанно: нужен разбор `Sidebar`,
чтобы чат-лист стал вкладкой 0 (зафиксировано в PR #162).

### 14.2 Системные P1-темы (сквозные, дают наибольший выигрыш на единицу работы)

1. ✅ **Портировать `:root`-блок tweb `base.scss:39-225`** в `_tokens.scss`: transition-токены, line-height-шкала, font-токены, ripple-токены, `--scrollbar-color`, `--danger-color`-семейство, `--chatlist-status-color`, `--badge-text-color` и пр. Затем волна замены хардкодов (`#ff595a`, `#fff`, rgba-литералы) на токены. Закрывает десятки P1/P2 из всех доменов разом.
   → блок портирован (`styles/_tokens.scss`, 205 переменных: `--transition-standard-*`, `--ripple-*`, line-height). **Волна замены хардкодов НЕ проведена** — см. §14.3.
2. ✅ **font-weight 500 вместо 600** глобально (`--font-weight-bold`), line-height 1.3125 в `Text`, `user-select: none` на body. → `styles/_tokens.scss:68`.
3. ✅ **Выпилить все 10 spring** framer-motion → длительность+безье из токенов (таблица в §12.9 даёт замену каждому). Путь к удалению framer-motion по программе parity.
   → сделано целиком: framer-motion удалён из зависимостей (PR #162), анимации на классах tweb + `useSetTransition`/`useMountTransition`.
4. ✅ **Единый каркас бабла** `bubble-content-wrapper > bubble-content` для всех типов сообщений (открывает reply/имя/forward у медиа — P0 №2).
5. ⚠️ **Единые примитивы**: `.scrollable` (скроллбары), Row (56px + ripple), Radio, RangeSelector/MediaProgressLine, video-time бейдж, ConfirmPopup (PopupPeer), z-index-шкала.
   → частично: `.scrollable`, `SidebarSection`/Row, `ConfirmPopup`, `Ripple` есть; RangeSelector живёт как `shared/ui/Slider`. **Отдельного `Radio` в `shared/ui` нет**; z-index-шкала (§8.12) не сведена.
6. ✅ **rAF-прогресс** для voice-закраски/кольца кружка/плеера (вместо 4 Гц timeupdate). → Task 7.3, коммит `dbddf65`.
7. ✅ **fastSmoothScroll** — честный JS-порт (power-easing 250-600ms) вместо нативного smooth. → `core/dom/smoothScrollToElement.ts`.
8. ❌ **hover-волна**: `0.15s → .2s` (~40 мест). → не проведена: **33 вхождения `0.15s`** в наших SCSS-модулях мимо портированных партиалов (`shared/ui/Popup`, `ConfirmPopup`, `UserInfoPanel`, `NowPlayingBar`, `TopicsPanel`, `DatePickerPopup` и др.).

### 14.3 Отсебятина к удалению (сводно)

**Это самая живая часть документа: почти всё из списка на месте.**

- ❌ Градиент `--tg-accentGradient` на FAB/send-кнопке/плеерах — tweb везде плоский `--primary-color`.
  → жив: `styles/_tokens.scss:283,320`, `QrModal.tsx:177`, `UserInfoPanel.module.scss:596,728`.
- ✅ framer-spring повсюду (10 мест), whileTap/whileHover scale (~20 мест) — в tweb жестовых scale нет, есть ripple. → удалено вместе с framer-motion (PR #162).
- ⚠️ PiP-кнопка в topbar вьюера, счётчик «N из M», кольцевое листание, постоянные круглые стрелки, хоткей R.
  → PiP-кнопки, счётчика и постоянных стрелок в `MediaLightbox` больше нет; **хоткей R (поворот) жив** — `MediaLightbox.tsx:565`. Кольцевое листание — не проверено.
- ✅ «Keep me signed in», corner-back на внутренних auth-шагах — в коде отсутствуют (экран входа переписан, PR #159/#161). Обои+тень на auth-карточке — **не проверено** (обои экрана входа с тех пор переделаны по tweb).
- ⚠️ Счётчик символов у инпута, slowmode-текст в кнопке, paidBar-плашка, Location/Contact в attach-меню.
  → счётчика символов и Location/Contact нет; **slowmode-текст жив** (`Composer.tsx:153-154`), **paidBar жив** (`messages/SendMediaPopup.tsx`).
- ⚠️ forwards-счётчик в Time, hover сервис-пилюли, headerScrolled-состояние шапки профиля, «Night Mode»-строка в настройках, rowActive-подсветка.
  → **forwards-счётчик удалён** (2026-08-10): в tweb число пересылок попадает только в подсказку `title` и только внутри ветки `if (message.views)`, то есть у постов канала (`messageRender.ts:281-283`, `SharesTooltip`); видимого элемента со стрелкой в оригинале нет. У нас он рисовался в том числе в личных чатах.
  Остальные живы: `UserInfoPanel.module.scss:81`, `SettingsView.tsx:148`, `SettingsView.module.scss:69` + `TopicsPanel.module.scss:52`. Hover сервис-пилюли — не проверено.
  **Хвост:** подсказки `ViewsTooltip`/`SharesTooltip` у нас нет вообще — `title` на `.time-inner` содержит только полную дату. Это шире счётчика (просмотры тоже без подсказки) и требует интерполяции в `i18n` (`makeT` сейчас без неё) — отдельная задача.
- ❌ PlayPauseGlyph (framer-морф), Spinner (border-кольцо), `IconButton.small`.
  → все три на месте: `components/PlayPauseGlyph.tsx` (уже без framer, но сам компонент — отсебятина), `shared/ui/Spinner/`, `shared/ui/IconButton/IconButton.tsx:8-9`.
- ❌ Хардкод-цвета мимо токенов: `#ff595a`, `#ff3b30`, `#ff5a5a`, `#fff`/`#212121`/`#2b2b2b` в хелперах/тултипе, `#9275ff` у PremiumBadge, `#4dcd5e` у online-точки.
  → живы: `CallsView.tsx:45,53`, `SuggestPostPopup.tsx:55`, `UserInfoPanel.module.scss:807`, `Menu/MenuItem.module.scss:32`, `StoryStats.tsx:72`.
- ✅ Фиолетовая тема `classic` и тема `dark` (не из tweb) — см. аудит 2026-08-07. → удалены (Волна 1, PR #142).
- ⚠️ Мёртвый код: `EditContactView.module.scss`, `StoriesStack`, `monkeyField(onEnter)`.
  → первые два удалены; **`monkeyField(onEnter)` жив** — `settings/TwoStepVerification.tsx:69`.

### 14.4 Рекомендуемый порядок работ (волны)

Волны 1-6 отработаны в PR #154, #156-#162. Остатки после ревизии 2026-08-09 отмечены ниже.

1. ✅ **Волна «Токены+шрифт»** (§14.2 п.1-2): Roboto, `:root`-блок, веса, danger/scrollbar/status-токены, замена хардкодов. Низкий риск, массовый эффект. → всё, кроме **замены хардкод-цветов** (§14.3).
2. ✅ **Волна «Анимационный фундамент»**: animationIntersector (этап 2 tlottie), heavy-animation, reduceMotion-гейт, transition-токены, параллакс navigation, деспринг. → фаза 7, PR #162; параллакс — с оговоркой (P0 №31).
3. ⚠️ **Волна «Каркас бабла»**: bubble-content-wrapper для всех типов, reply/имя/forward у медиа, blockquote/pre/spoiler по tweb, peer-color переменные, mediaSizes/setAttachmentSize + альбом 420/1. → всё, кроме **blockquote** (P0 №3 — открыт).
4. ✅ **Волна «Каркас чата»**: floating-plates стек (padding/маска/пин-бар), скролл-трекинг пина + AnimatedSuper, goto-кнопки, sticky-date скрытие, переход между чатами.
5. ⚠️ **Волна «Примитивы UI»**: Popup/ConfirmPopup/меню-позиционирование, Row/Radio/scrollable/ripple-покрытие, RangeSelector. → остались Radio, z-index-шкала, hover-волна (§14.2 п.5, п.8).
6. ✅ **Волна «Экраны»**: правый сайдбар (transform, морф аватара, infinite scroll), левый сайдбар (72px строка, бейджи, zoom-fade, сториз-fold), медиавьюер/сториз (caption, слайд, карусель, полёт из аватарки), auth (country-picker, code-input, обезьянка), композер (морф send, voice-панель, reply-плашка, drop-зона).

**Что делать дальше (по остаткам):**

1. Починить blockquote (P0 №3) — и закрыть класс проблемы: типизировать `*.module.scss`, иначе
   четвёртый молчаливый обрыв — вопрос времени.
2. Волна «отсебятина» по §14.3: accentGradient, хардкод-цвета, PlayPauseGlyph/Spinner/`IconButton.small`,
   slowmode-текст, paidBar, forwards в Time, «Night Mode», rowActive, `monkeyField(onEnter)`, хоткей R.
3. Хвосты §14.2: hover-волна `0.15s → .2s` (33 места), `Radio` в `shared/ui`, z-index-шкала.
4. Отдельной задачей — **переперепроверить §1-13**: они размечены по состоянию на 2026-08-08.

> Ссылки `файл:строки` во всех разделах — снимок на 2026-08-08. Перед фиксом перепроверять по контексту: tweb-чекаут живёт на `e52b5d931`.

---
