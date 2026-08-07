# Порт per-chat темизации tweb 1:1 + чистка токенов — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Шаги — чекбоксы.

**Goal:** заменить плоскую 5-переменную per-chat темизацию на портированную деривацию tweb (`changeColorAccent`/`getAccentColor`/`message_colors`, скоуп на контейнер чата), затем codemod статических `--tg-*`→tweb-имена + чистка мёртвых.

**Architecture:** `themeController.deriveChatThemeVars(preset, accent, messageColors)` (мирроринг tweb `applyTheme` accent-пути, переиспользует `buildAppColorVars`) → inline vars на контейнере чата (`ConversationView` `.root`). Скоуп сужен с `#app-shell` до чата. Codemod: 26 семантических `--tg-*` → tweb + JS-ссылки + мёртвые `--tg-*`.

**Tech Stack:** React 19 + TS strict, SCSS-модули, vitest. Истина — `/Users/denisurevic/Documents/tweb/src`.

## Global Constraints

- **1:1 tweb.** Деривация — точно из `helpers/themeController.ts:739-898 applyTheme` + `helpers/color.ts` (`changeColorAccent`/`getAccentColor`/`mixColors`). Не выдумывать формулы.
- Скоуп per-chat **цветов** — контейнер колонки чата, НЕ сайдбары (как tweb `chat.ts:367-371`). Один источник.
- Обои (`ChatBackground` на shell) — не трогать (осознанное отклонение вне скоупа цветов).
- Мёртвый код удалять полностью (плоские 5-переменных, `chatThemeBubbleOut`, переименованные алиасы, мёртвые `--tg-*`).
- Новый код — `core/theme/` / `config/`, НЕ `helpers/`. TS strict, без `any`/неиспользуемого. SCSS-модули, MUI не возвращать.
- Уже готово (Волна 1): `shared/lib/color.ts` (все хелперы), `core/theme/themeController.ts` (`buildAppColorVars`, `getColorOverride`, `setTheme`), `config/themePresets.ts` (`appColorMap`, `presetToColorMap`, `AppColorName`, `ThemePresetName`).
- Проверять: `npm run typecheck` + `npm test` + `npm run build` + стенд :38443.

---

## File Structure

- **Modify** `web-client/src/core/theme/themeController.ts` — + `deriveChatThemeVars()` + `applyChatTheme()`.
- **Test** `web-client/src/core/theme/themeController.test.ts` — + кейсы деривации под кастом-акцент.
- **Modify** `web-client/src/chatThemes.ts` — `ChatThemeVariant` += `messageColors`; убрать `chatThemeBubbleOut` color-mix / фейк-градиент.
- **Modify** `web-client/src/components/ConversationView.tsx` — применять `applyChatTheme` на контейнер чата вместо 5 плоских переменных.
- **Modify** `web-client/src/core/hooks/useShellTheme.ts` — убрать accent на `#app-shell` (сайдбары глобальные).
- **Modify** `web-client/src/styles/_tokens.scss` — удалить переименованные алиасы; adopt `--input-search-border-color`.
- **Modify** множество `*.scss` + `core/webapp.ts` (+ др. JS-ссылки) — codemod `--tg-*`→tweb.

---

## Task 1: Деривация темы чата в themeController

**Files:**
- Modify: `web-client/src/core/theme/themeController.ts`
- Test: `web-client/src/core/theme/themeController.test.ts`

**Interfaces:**
- Consumes: `shared/lib/color.ts` (`changeColorAccent`, `getAccentColor`, `mixColors`, `hexToRgb`, `rgbToHsv`, `rgbaToHexa`, `getAverageColor`), `config/themePresets.ts` (`presetToColorMap`, `appColorMap`, `AppColorName`, `ThemePresetName`), существующий приватный `buildAppColorVars`.
- Produces:
  - `deriveChatThemeVars(preset: ThemePresetName, accentColor: string, messageColors: string[]): Array<[string, string]>` — набор CSS-переменных (имя, значение) для темы чата.
  - `applyChatTheme(element: HTMLElement, preset: ThemePresetName, accentColor: string, messageColors: string[]): void` — пишет их инлайном (`element.style.setProperty`). И `clearChatTheme(element)` — снять (для сброса на дефолт).

**Логика (мирроринг tweb `applyTheme` accent-пути, themeController.ts:747-897):**
1. База: `presetToColorMap(preset)` → `colorMap` (hex по `AppColorName`).
2. **primary:** `changeColorAccent` сдвигает базовый `colorMap['primary-color']` под `accentColor` (как tweb :792: `changeColorAccent(rgbToHsv(base), rgbToHsv(accent), baseRgb, !isNight)`), результат → новый `primary-color`.
3. **out-bubble:** из `messageColors` (hex[]) → `getAverageColor`/`getAccentColor` + `mixColors` вычислить `message-out-background-color` и `message-out-primary-color` (как tweb :833-897). Для night — `message-out-primary-color = #ffffff` (как в setTheme).
4. Прогнать ВСЕ `AppColorName` через существующий `buildAppColorVars(name, hex, appColorMap[name], params)` → получить производные (`-rgb`/`light-`/`dark-`/`light-filled-`). Для переопределённых (primary, out-bubble) — использовать новые hex.
5. Вернуть плоский список `[--var, value]`.

`applyChatTheme` = `deriveChatThemeVars(...).forEach(([k,v]) => element.style.setProperty(k, v))`. `clearChatTheme` = снять те же ключи.

- [ ] **Step 1: Падающий тест** (jsdom/happy-dom) `themeController.test.ts` (добавить блок):

```ts
describe('deriveChatThemeVars', () => {
  it('shifts primary under a custom accent (day)', () => {
    const base = new Map(require('./themeController').__testDefaultDayVars ?? [])
    const vars = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076']))
    // primary сдвинут под красный акцент, не синий дефолт day
    const primary = vars.get('--primary-color')!.toLowerCase()
    expect(primary).not.toBe('#3390ec')
    // производные присутствуют
    expect(vars.has('--primary-color-rgb')).toBe(true)
    expect(vars.has('--light-primary-color')).toBe(true)
    // out-bubble посчитан из messageColors
    expect(vars.get('--message-out-background-color')).toBeTruthy()
  })
  it('applyChatTheme writes inline vars on element', () => {
    const el = document.createElement('div')
    applyChatTheme(el, 'day', '#e17076', ['#e17076'])
    expect(el.style.getPropertyValue('--primary-color')).toBeTruthy()
    expect(el.style.getPropertyValue('--light-primary-color')).toBeTruthy()
  })
})
```
(Если `__testDefaultDayVars` не нужен — упростить: проверять только что primary ≠ дефолт day и производные есть.)

- [ ] **Step 2: Запустить → FAIL** (`npx vitest run src/core/theme/themeController.test.ts`).
- [ ] **Step 3: Реализовать** `deriveChatThemeVars`/`applyChatTheme`/`clearChatTheme`, рефакторя общее с `buildThemeCss` (не дублировать генерацию производных — вынести общий helper, принимающий colorMap-override). Сверить формулу primary/out-bubble с tweb `applyTheme`.
- [ ] **Step 4: Тест → PASS** + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(theme): деривация темы чата под кастом-акцент (themeController.deriveChatThemeVars)`.

---

## Task 2: Данные тем + провод (скоуп на чат, убрать отсебятину)

**Files:**
- Modify: `web-client/src/chatThemes.ts`
- Modify: `web-client/src/components/ConversationView.tsx`
- Modify: `web-client/src/core/hooks/useShellTheme.ts`

**Interfaces:**
- Consumes: `applyChatTheme`/`clearChatTheme` (Task 1).

- [ ] **Step 1: `chatThemes.ts`** — `ChatThemeVariant` += `messageColors: string[]`. Для 8 тем `CHAT_THEMES` задать `messageColors: [accent]` (placeholder до облачных тем — out-bubble деривится из акцента формулой tweb; комментарий об этом). **Удалить** `chatThemeBubbleOut` (color-mix) и использование фейк-градиента для баблов.
- [ ] **Step 2: `ConversationView.tsx`** — вместо сборки `themeStyle` из 5 плоских переменных (`:165-180`) применять тему чата через `applyChatTheme(rootEl, preset, variant.accent, variant.messageColors)` на контейнере `.root` (`:854`) в layout-effect по смене чата/темы; при отсутствии темы чата — `clearChatTheme` (наследуется глобальная). Убрать плоские `--tg-accent`/`--tg-accentGradient`/`--tg-bubbleOut`/`--tg-bubbleOutAccent`/`--tg-badge` из inline-стиля.
- [ ] **Step 3: `useShellTheme.ts`** — **убрать** установку accent-переменных на `#app-shell` (сайдбары остаются на глобальной теме, как tweb). Если после этого хук не несёт иной нагрузки (проверить: обои/режим) — упростить/удалить; вызов в `App.tsx:121` обновить соответственно. НЕ трогать `ChatBackground` (обои).
- [ ] **Step 4: Проверка** — `npm run typecheck` + `npm test` зелёные. Визуально (следующий live-таск подтвердит): глобальная тема на сайдбаре, тема чата — в колонке.
- [ ] **Step 5: Commit** `refactor(theme): per-chat тема через tweb-деривацию, скоуп на колонку чата (убрана отсебятина)`.

---

## Task 3: Codemod `--tg-*`→tweb + чистка мёртвых

**Files:** множество `web-client/src/**/*.scss` + `core/webapp.ts` + `web-client/src/styles/_tokens.scss` (+ прочие JS-ссылки по grep).

**Таблица переименования (26 статических семантических):**
```
--tg-accent, --tg-badge                    → --primary-color
--tg-textPrimary                           → --primary-text-color
--tg-textSecondary, --tg-textFaint         → --secondary-text-color
--tg-link                                  → --link-color
--tg-green                                 → --green-color
--tg-divider                               → --border-color
--tg-bubble, --tg-sidebarBg, --tg-skelBase → --surface-color
--tg-bg, --tg-appBg, --tg-sectionBackdrop  → --background-color
--tg-bubbleOut                             → --message-out-background-color
--tg-bubbleOutText, --tg-bubbleOutAccent   → --message-out-primary-color
--tg-dangerText                            → --danger-color
--tg-hover, --tg-skelHi                    → --light-secondary-text-color
--tg-inputSearchBg, --tg-searchBg          → --input-search-background-color
--tg-switchOff                             → --secondary-color
--tg-menuShadow                            → --menu-box-shadow
--tg-menuBg                                → --menu-background-color
```
**Adopt:** `--tg-inputBorderIdle` → `--input-search-border-color` (определить per-theme в `_tokens.scss`: day/light `#dfe1e5`, night/tinted `#2f2f2f`).
**Мёртвые (заменить `var(--tg-x, FB)` → `FB`):** `--tg-danger`, `--tg-primary`, `--tg-border`, `--tg-borderColor`, `--tg-borderSubtle`, `--tg-serviceBg`, `--tg-inputBg`, `--tg-secondaryBg`, `--tg-bgSecondary`, `--tg-fill-secondary`.
**Оставить как есть (bespoke декор):** `--tg-accentGradient`, `--tg-composeShadow`, `--tg-bgGrad0..3`, `--tg-searchCardBg`, `--tg-searchCardShadow`, `--tg-plateShadow`, `--tg-bannerBg`, `--tg-bubbleBorder`.

- [ ] **Step 1:** По каждому имени из таблицы заменить `var(--tg-X)` и `var(--tg-X, fb)` → `var(--tweb-token)` / `var(--tweb-token, fb)` во всех `.scss`. Скрипт (sed) или пофайлово; охватить все вхождения.
- [ ] **Step 2:** JS-ссылки (grep `['"\`]--tg-` в `.ts/.tsx`): `core/webapp.ts` (`v('--tg-accent',…)`→`v('--primary-color',…)`, appBg→--background-color, textPrimary→--primary-text-color, textSecondary→--secondary-text-color, sidebarBg→--surface-color, bubble→--surface-color, link→--link-color). Прочие `getPropertyValue('--tg-*')`. (setters `--tg-accent` в ConversationView/useShellTheme уже убраны в Task 2 — проверить, что не осталось.)
- [ ] **Step 3:** Мёртвые: `var(--tg-x, FB)` → `FB` для 10 имён из списка.
- [ ] **Step 4:** `_tokens.scss` — удалить 26 переименованных алиасов из `:root` + `--tg-inputBorderIdle`; добавить `--input-search-border-color` per-theme (day/light #dfe1e5, night/tinted #2f2f2f). Оставить bespoke блок.
- [ ] **Step 5: Сверка** — `grep -rho 'var(--tg-[a-zA-Z-]*' src | sort -u` должен содержать ТОЛЬКО ~9 bespoke имён (accentGradient/composeShadow/bgGrad0-3/searchCardBg/searchCardShadow/plateShadow/bannerBg/bubbleBorder). Ни одного переименованного/мёртвого. `grep` по JS-строкам `--tg-` — только bespoke (bgGrad/accentGradient в ChatBackground).
- [ ] **Step 6:** `npm run typecheck` + `npm test` + `npm run build` зелёные.
- [ ] **Step 7: Commit** `refactor(theme): codemod --tg-*→tweb-токены + чистка мёртвых (алиас-мост убран)`.

---

## Task 4: Live-верификация на стенде

**Files:** нет правок (верификация); фиксы при находках.

- [ ] **Step 1:** Собрать (`npx vite build --outDir /Users/denisurevic/Documents/messenger-denis/client-build --base=/` из worktree/web-client) + пересобрать nginx стенда (`docker compose -p msgrverify -f docker-compose.verify.yml up -d --build nginx`).
- [ ] **Step 2:** :38443, playwright. Глобальные темы: переключить day/night/light/tinted — не поехали (как в Волне 1). `getComputedStyle(root)`: переименованные tweb-токены присутствуют, bespoke `--tg-*` резолвятся, мёртвых нет.
- [ ] **Step 3:** Открыть чат, выбрать тему чата (ChatThemesPicker). Проверить: **колонка чата** перекрашивается — primary/пузыри/ссылки/тики консистентны (hover/rgba-состояния из того же акцента, т.к. производные регенерированы); **сайдбар/список чатов остаётся на глобальной теме** (не перекрашен). Снять тему чата → колонка вернулась к глобальной.
- [ ] **Step 4:** Переключить day↔night при выбранной теме чата — тема чата сохраняется, вариант меняется. 0 console-ошибок (кроме pre-existing notification.mp3).
- [ ] **Step 5:** Зафиксировать результат; фиксы — `fix(theme):` при необходимости.

---

## Self-Review

- Покрытие: деривация (Task1), данные+провод+скоуп (Task2), codemod+чистка (Task3), стенд (Task4). Облачные темы (A) — явный out-of-scope спеки. ✓
- Green-ность: Task1 добавляет неиспользуемую ф-цию (green); Task2 переводит per-chat на неё, алиасы `--tg-*` в `_tokens.scss` ещё живы → scss с `var(--tg-accent)` резолвится через алиас на (теперь inline-переопределённый на чате) `--primary-color` (green); Task3 убирает алиасы одновременно с переименованием usages (green). ✓
- Типы: `messageColors: string[]` (hex-строки); `deriveChatThemeVars` возвращает `Array<[string,string]>`. Согласовать с существующим `CssVar`-типом в themeController (переиспользовать, не плодить). ✓
