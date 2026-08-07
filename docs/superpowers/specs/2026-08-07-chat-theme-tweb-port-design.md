# Порт per-chat темизации tweb 1:1 + чистка токенов (Волна 1b) — дизайн

**Дата:** 2026-08-07
**Статус:** спека на ревью
**Контекст:** продолжение [Волны 1 (тема-подсистема)](./2026-08-07-theme-subsystem-port-design.md). Изначально планировалась как big-bang codemod `--tg-*`→tweb, но разведка выявила, что наша per-chat темизация — отсебятина (плоские переменные + свои формулы + неверный скоуп), а codemod без её исправления сломал бы кастомные темы чата. Мандат (web-client/CLAUDE.md): расхождение с tweb → привести к tweb, не выдумывать.

## Цель

Заменить нашу плоскую 5-переменную per-chat темизацию на **портированную из tweb деривацию** (`applyTheme(theme, container)`): акцент темы чата → `changeColorAccent` → полный набор accent-производных токенов (primary + `--light-*/--dark-*/-rgb` + out-bubble из `message_colors` + saved), записанных inline на **контейнер чата** (скоуп как в tweb, не на сайдбары). После этого переименовать статические семантические `--tg-*` в tweb-имена и почистить мёртвые.

## Как делает tweb (якорь 1:1)

- `helpers/themeController.ts:739-898 applyTheme(theme, element)` — единственный путь темы в CSS-переменные. `element` по умолчанию `<html>` (глобально), но per-chat вызывается с `element = .chat`-контейнером.
- Акцент темы (`theme.settings.accent_color`) → `changeColorAccent` (color.ts) сдвигает базовый primary в HSV; out-bubble → `getAccentColor`+`mixColors` из `theme.settings.message_colors[]`; всё разворачивается в `appColorMap` производные через `applyAppColor` (setProperty на element).
- Per-chat: `components/chat/chat.ts:367-371 applyContainerTheme()` → `themeController.applyTheme(currentTheme, this.container)`. Тема чата резолвится по emoticon пира (`chat.ts:521-539`). **Сайдбары остаются на глобальной теме** (скоуп строго `.chat`).
- Обои — отдельная подсистема (`appChatBackground`), питается тем же `currentTheme`.

## Наши расхождения (что чиним)

- **(B) Деривация:** `useShellTheme.ts`/`ConversationView.tsx` ставят 5 плоских переменных (`--tg-accent`=сырой hex, `--tg-bubbleOut`=наш `color-mix`, `--tg-accentGradient`=фейк `accent→accent`, `--tg-bubbleOutAccent`, `--tg-badge`). Нет `changeColorAccent`, нет производных. → **заменить на tweb-деривацию.**
- **(C) Скоуп:** `useShellTheme` вешает акцент на `#app-shell` (красит сайдбары) + дубль в `ConversationView`. → **сузить до контейнера чата, единственный источник.**
- **(A) Данные:** 8 hardcoded `{accent, gradient}` без `message_colors`. → **дать `message_colors` (вход деривации); облачные темы по emoticon с сервера — DEFERRED (нужен бэкенд).**

## Что уже готово (Волна 1, переиспользуем)

- `shared/lib/color.ts` — все хелперы: `changeColorAccent`, `getAccentColor`, `getAverageColor`, `getRgbColorFromTelegramColor`, `rgbToHsv`/`hsvToRgb`, `mixColors`, `rgbaToHexa`.
- `core/theme/themeController.ts` — `buildAppColorVars(name, hex, flags, params)` (генератор производных на токен), `getColorOverride`, `appColorMap` (в config/themePresets).

## Архитектура

### 1. themeController: деривация под кастомный акцент
Новая функция (переиспускает `buildAppColorVars` + приватную логику `buildThemeCss`):
```
deriveChatThemeVars(preset: ThemePresetName, accentColor: string, messageColors: string[]): CssVar[]
```
Мирроринг tweb `applyTheme` accent-пути (themeController.ts:747-897): взять базовый colorMap пресета → primary через `changeColorAccent(accentColor)` → out-bubble (`--message-out-background-color`/`--message-out-primary-color`) через `getAccentColor`+`mixColors` из `messageColors` → saved-color → прогнать весь `appColorMap` через `buildAppColorVars` (все производные). Возвращает список `[--var, value]`.
Экспортить также `applyChatTheme(element: HTMLElement, ...)` — пишет эти vars инлайном на element (аналог tweb `applyTheme(theme, element)`).

### 2. chatThemes: данные
- `ChatThemeVariant` += `messageColors: string[]` (вход деривации). Для 8 hardcoded тем — задать `messageColors` (по умолчанию `[accent]` — out-bubble деривится из акцента формулой tweb; помечено как placeholder до облачных тем). Убрать наш `chatThemeBubbleOut` `color-mix` и фейк-градиент.
- `accentGradient`: наш фейк `accent→accent` — заменить? В tweb градиента-акцента для баблов нет; `--tg-accentGradient` используется как декор (compose и т.п.). Оставить `--tg-accentGradient` как **bespoke** декоративный (per-theme, не per-chat) — не выдумывать per-chat градиент. Per-chat он больше не переопределяется.

### 3. Скоуп/провод
- **Единственный источник** per-chat цветов — inline-стиль на контейнере колонки чата (`ConversationView` `.root`, уже существует `themeStyle` на строке 854). Вместо 5 плоских переменных — `applyChatTheme(rootEl, preset, accent, messageColors)` (через ref/effect или собранный style-объект из `deriveChatThemeVars`).
- **Убрать** применение accent на `#app-shell` в `useShellTheme` (сайдбары → глобальная тема, как tweb). `useShellTheme` оставить только для того, что реально нужно вне чата (если что-то — переоценить; акцент сайдбара убрать).
- Обои (`ChatBackground` с `themeColors=gradient`) — оставить как есть (осознанное отклонение, вне скоупа цветов).

### 4. Codemod токенов (после п.1-3 конфликт per-chat снят)
- Переименовать **статические семантические** `--tg-*` → tweb-имена по всему `web-client/src` (scss + JS-строки): полная таблица из `_tokens.scss` (accent/badge→--primary-color, textPrimary→--primary-text-color, textSecondary/textFaint→--secondary-text-color, link→--link-color, green→--green-color, divider→--border-color, bubble/sidebarBg/skelBase→--surface-color, bubbleOut→--message-out-background-color, bubbleOutText/bubbleOutAccent→--message-out-primary-color, dangerText→--danger-color, hover/skelHi→--light-secondary-text-color, inputSearchBg/searchBg→--input-search-background-color, switchOff→--secondary-color, menuShadow→--menu-box-shadow, menuBg→--menu-background-color, bg/appBg/sectionBackdrop→--background-color).
- **JS-ссылки (22):** `core/webapp.ts` (`v('--tg-accent',…)` → `v('--primary-color',…)` и т.д.), любые `getPropertyValue('--tg-*')`. `useShellTheme`/`ConversationView` setters — уходят вместе с п.3.
- `inputBorderIdle` → `--input-search-border-color` (adopt tweb-имя; определить per-theme в `_tokens.scss` со старыми значениями #dfe1e5/#2f2f2f).
- **Мёртвые `--tg-*`** (никогда не определены, всегда фолбэк: `--tg-danger`, `--tg-primary`, `--tg-border`, `--tg-borderColor`, `--tg-borderSubtle`, `--tg-serviceBg`, `--tg-inputBg`, `--tg-secondaryBg`, `--tg-bgSecondary`, `--tg-fill-secondary`) → заменить `var(--tg-x, fb)` на `fb`.
- Удалить переименованные алиасы из `_tokens.scss :root`. Оставить ~9 декоративных bespoke `--tg-*` (accentGradient, composeShadow, bgGrad0-3, searchCardBg/Shadow, plateShadow, bannerBg, bubbleBorder).

## Out-of-scope (deferred)

- **Облачные темы по emoticon с сервера** (A) — нужен бэкенд (`accountThemes`/theme by emoticon). Пока hardcoded темы с placeholder `messageColors`.
- Обои-подсистема как отдельный `appChatBackground` — оставляем текущий `ChatBackground`.
- Полный accent-picker UI (произвольный акцент аккаунта).

## Тестирование

- **Юнит:** `deriveChatThemeVars('day', <accent>, [<msg>])` даёт `--primary-color` сдвинутый под accent (≠ базовый day), производные (`--light-primary-color`, `-rgb`) присутствуют, `--message-out-background-color` из messageColors; сверить с ручным расчётом по tweb-формуле для 1 кейса.
- **Сборка:** typecheck + build + полная vitest зелёные; grep — переименованные `--tg-*` имеют 0 вхождений, декоративные ~9 остались определены, мёртвые убраны.
- **Стенд (:38443):** глобальные 4 темы не поехали; выбрать тему чата → **колонка чата** перекрашивается консистентно (primary + hover/rgb/out-bubble из одного акцента), **сайдбар остаётся глобальным**; переключение day↔night сохраняет тему чата; 0 console-ошибок (кроме pre-existing notification.mp3).

## Инварианты

- Деривация/формулы — точно из tweb (`applyTheme`/`changeColorAccent`/`getAccentColor`), не выдумывать.
- Скоуп per-chat цветов — контейнер чата, не сайдбары (как tweb).
- Мёртвый код (плоские 5-переменные, `chatThemeBubbleOut` color-mix, переименованные алиасы, мёртвые `--tg-*`) — удалить полностью.
- SCSS-модули + CSS custom properties, MUI не возвращать. TS strict.
