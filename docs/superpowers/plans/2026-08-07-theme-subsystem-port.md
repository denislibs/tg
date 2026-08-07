# Порт тема-подсистемы tweb — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана таск-за-таском. Шаги — чекбоксы (`- [ ]`).

**Goal:** заменить плоскую статичную систему токенов (`--tg-*` + `data-theme`) на рантайм тема-подсистему tweb 1:1 (`themeController` инжектит семантические + производные CSS-переменные; темы day/night/light/tinted; синий дефолт), сохранив 242 существующих потребителя `--tg-*` через алиас-мост.

**Architecture:** рантайм-стек из tweb: `shared/lib/color.ts` (цвето-функции) → `config/themePresets.ts` (значения 4 тем + `appColorMap`) → `core/theme/themeController.ts` (строит colorMap, генерит производные, инжектит `<style id="theme">`, тоглит `.night` + ставит `data-theme`). Провод — через существующий `useThemeToggle`. `_tokens.scss` переписывается: семантические `--tg-*` → алиасы на tweb-токены, бесхозные (без tweb-аналога) остаются per-theme.

**Tech Stack:** React 19 + TS strict, SCSS-модули + CSS custom properties, Zustand (settings-store), vitest. Источник истины значений/логики — **исходники tweb** (`/Users/denisurevic/Documents/tweb/src`).

## Global Constraints

- **1:1 с tweb.** Значения цветов тем, `appColorMap`, логика генерации производных, формулы цвето-функций — брать **точно из исходников tweb**, не выдумывать. Перед «в tweb так» — открыть файл tweb.
- Стилизация — только SCSS-модули + CSS custom properties. **MUI не возвращать** (никаких `@mui`/`sx`/emotion).
- **Новый код НЕ в `helpers/`** (легаси-корзина): `color.ts` → `shared/lib/`, `themeController.ts` → `core/theme/`, пресеты → `config/`.
- TS strict: без `any`, без неиспользуемых переменных (иначе сборка падает). Тайпчек — `npm run typecheck` (TS7 native).
- `themeController.setTheme(preset)` ставит **три** вещи: `<html data-theme=preset>` (совместимость с ~7 нашими компонентами-читателями), класс `.night` на `<html>` (для tweb-1:1 SCSS), инжект `<style id="theme">` с семантическими + производными токенами.
- **Out-of-scope этого PR:** big-bang переименование 242 файлов `var(--tg-*)`→tweb (следующий PR); accent-color picker UI; реальный tinted-blend от обоев (только заглушка/статик); view-transition при смене темы (смена мгновенная).
- Проверять перед «готово»: `npm run typecheck` + `npm run build` + `npm test` зелёные, затем live-стенд.

---

## File Structure

- **Create** `web-client/src/shared/lib/color.ts` — чистые цвето-функции (порт tweb `helpers/color.ts`, подмножество).
- **Create** `web-client/src/shared/lib/color.test.ts` — юнит-тесты цвето-функций.
- **Create** `web-client/src/config/themePresets.ts` — значения тем day/night/light/tinted + `appColorMap` + `presetToColorMap`.
- **Create** `web-client/src/config/themePresets.test.ts` — тест генерации colorMap.
- **Create** `web-client/src/core/theme/themeController.ts` — `setTheme`, генерация производных, инжект `<style>`, `.night`+`data-theme`.
- **Create** `web-client/src/core/theme/themeController.test.ts` — тест инжекта (jsdom).
- **Modify** `web-client/src/theme.ts` — `ThemePreset` = day/night/light/tinted; `PRESET_MODE`; `resolvePreset` (дефолт day).
- **Modify** `web-client/src/settings.tsx:120-130` — миграция persist classic/dark→day/night.
- **Modify** `web-client/src/core/hooks/useThemeToggle.ts` — применять тему через `themeController.setTheme`.
- **Modify** `web-client/src/styles/_tokens.scss` — алиас-блок семантических `--tg-*`→tweb + прунинг бесхозных до light/dark вариантов.
- **Modify** `web-client/src/components/settings/GeneralSettings.tsx:22-` — `THEME_RADIOS`/карточки → 4 пресета.

---

## Task 1: Порт цвето-функций (`shared/lib/color.ts`)

**Files:**
- Create: `web-client/src/shared/lib/color.ts`
- Test: `web-client/src/shared/lib/color.test.ts`

**Interfaces:**
- Produces: `hexToRgb(hex: string): [number, number, number]`, `rgbToHex(rgb: [number,number,number]): string`, `hexaToRgba(hex: string): [number,number,number,number]`, `rgbaToHexa(rgba): string`, `mixColors(color1: number[], color2: number[], ratio: number): number[]`, `hslaStringToRgba(str: string): [number,number,number,number]`, `rgbaToHsla(r,g,b,a?)`, `hslaToRgba(h,s,l,a)`, `changeColorAccent(gradient, accent, target, isDarkTheme?)`, `getAccentColor(baseGradient, baseAccent, targetAccent)`. Точные сигнатуры/тела — из tweb `helpers/color.ts` (портировать только эти функции + их приватные зависимости).

**Источник:** `/Users/denisurevic/Documents/tweb/src/helpers/color.ts`. Портировать 1:1 подмножество, реально используемое `themeController` и `_splitColor`-логикой (см. импорты в tweb `helpers/themeController.ts`: `changeColorAccent, getAccentColor, hexToRgb, mixColors, rgbaToHexa, rgbaToHsla, hslaToRgba, hslaStringToRgba` и др.). Не тащить неиспользуемое.

- [ ] **Step 1: Написать падающий тест** `color.test.ts` на известные значения:

```ts
import { describe, it, expect } from 'vitest'
import { hexToRgb, rgbToHex, mixColors } from './color'

describe('color', () => {
  it('hexToRgb', () => {
    expect(hexToRgb('#3390ec')).toEqual([51, 144, 236])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })
  it('rgbToHex round-trips', () => {
    expect(rgbToHex([51, 144, 236]).toLowerCase()).toBe('#3390ec')
  })
  it('mixColors half blends channels', () => {
    expect(mixColors([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает** (модуль не существует). `npx vitest run src/shared/lib/color.test.ts` → FAIL.
- [ ] **Step 3: Портировать функции** из tweb `helpers/color.ts` в `shared/lib/color.ts` (1:1 тела; TS strict — типизировать, без `any`). Скорректировать значение `mixColors`-ожидания в тесте под фактическую формулу tweb, если она даёт 127/128 (round) — тест подогнать под РЕАЛЬНУЮ формулу tweb, не наоборот менять порт.
- [ ] **Step 4: Запустить тест** → PASS. Затем `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(theme): порт цвето-функций из tweb (shared/lib/color)`.

---

## Task 2: Порт пресетов тем + appColorMap (`config/themePresets.ts`)

**Files:**
- Create: `web-client/src/config/themePresets.ts`
- Test: `web-client/src/config/themePresets.test.ts`

**Interfaces:**
- Consumes: `shared/lib/color.ts` (при необходимости для tinted-фолбэка).
- Produces:
  - `type AppColorName` — union семантических имён (1:1 из tweb `themeController.ts`): `'primary-color' | 'message-out-primary-color' | 'surface-color' | 'danger-color' | 'primary-text-color' | 'secondary-text-color' | 'message-out-background-color' | 'saved-color' | 'message-background-color' | 'green-color' | 'background-color' | 'body-background-color' | 'border-color' | 'secondary-color' | 'link-color' | 'input-search-background-color'`.
  - `type AppColor = { rgb?: boolean; light?: boolean; lightFilled?: boolean; dark?: boolean; darkRgb?: boolean; darkFilled?: boolean }`.
  - `const appColorMap: Record<AppColorName, AppColor>` — **точно** из tweb `themeController.ts` `appColorMap` (какие производные у какого токена).
  - `type ThemePresetName = 'day' | 'night' | 'light' | 'tinted'`.
  - `presetToColorMap(preset: ThemePresetName): Record<AppColorName, string>` — базовые hex-значения токенов для темы (значения — из tweb `config/themePresets.ts` / `themeController` пресетов). Для `tinted` без обоев — статичный фолбэк-набор (см. tweb tinted defaults).

**Источник:** `/Users/denisurevic/Documents/tweb/src/config/themePresets.ts` + `appColorMap` из `/Users/denisurevic/Documents/tweb/src/helpers/themeController.ts` (строки ~40-120). Значения day/night/light/tinted — 1:1.

- [ ] **Step 1: Падающий тест** `themePresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { appColorMap, presetToColorMap } from './themePresets'

describe('themePresets', () => {
  it('day primary is telegram blue', () => {
    expect(presetToColorMap('day')['primary-color'].toLowerCase()).toBe('#3390ec')
  })
  it('night primary is tweb night accent', () => {
    expect(presetToColorMap('night')['primary-color'].toLowerCase()).toBe('#8774e1')
  })
  it('appColorMap marks primary-color with rgb+light+dark', () => {
    expect(appColorMap['primary-color'].rgb).toBe(true)
    expect(appColorMap['primary-color'].light).toBe(true)
    expect(appColorMap['primary-color'].dark).toBe(true)
  })
})
```

- [ ] **Step 2: Запустить → FAIL**.
- [ ] **Step 3: Портировать** `appColorMap` + значения пресетов из tweb. Сверить hex для day/night с реальными значениями tweb (если tweb day-primary отличается — тест подогнать под tweb-значение).
- [ ] **Step 4: Тест → PASS** + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(theme): пресеты тем tweb + appColorMap (config/themePresets)`.

---

## Task 3: Порт themeController (`core/theme/themeController.ts`)

**Files:**
- Create: `web-client/src/core/theme/themeController.ts`
- Test: `web-client/src/core/theme/themeController.test.ts`

**Interfaces:**
- Consumes: `config/themePresets.ts` (`appColorMap`, `presetToColorMap`, `AppColorName`, `ThemePresetName`), `shared/lib/color.ts`.
- Produces:
  - `setTheme(preset: ThemePresetName): void` — строит colorMap из `presetToColorMap`, генерит производные по `appColorMap` (см. ниже), собирает CSS-текст, пишет в единственный `<style id="theme">` в `<head>`, тоглит класс `.night` на `document.documentElement` (для dark-тем: night/tinted), ставит `document.documentElement.setAttribute('data-theme', preset)`.
  - `getCurrentPreset(): ThemePresetName | null`.

**Правило генерации производных (1:1 из tweb `_splitColor` / `themeController`):** для каждого `AppColorName` с базовым hex-цветом `c` и флагами из `appColorMap`:
- всегда: `--{name}: {c}`.
- `rgb` → `--{name}-rgb: R, G, B`.
- `light` → `--light-{name}: hover-color(c)` (осветление; формула hover-color из tweb, alpha `$hover-alpha`).
- `lightFilled` → `--light-filled-{name}: rgba-to-rgb(light, surface)`.
- `dark` → `--dark-{name}: darken(c, hover-alpha)`.
- `darkRgb` → `--dark-{name}-rgb: …`.
- `darkFilled` → `--dark-filled-{name}: …`.

Портировать формулы `hover-color`/`rgba-to-rgb`/darken из tweb `scss/functions.scss` (`_functions.scss`) в TS-эквиваленты в `themeController` (или в `color.ts`), значения `$hover-alpha` — из tweb `variables.scss`.

**Адаптации (урезание порта — out-of-scope):** НЕ портировать view-transition (`THEME_TRANSITION_TIMEOUT`, `dispatchHeavyAnimationEvent`, View Transitions API), accent-preset применение (произвольный акцент), реальный tinted wallpaper-blend. Оставить `setTheme` синхронным и мгновенным. Nil-safe: если `typeof document === 'undefined'` → ранний `return` (worker-безопасность).

**Источник:** `/Users/denisurevic/Documents/tweb/src/helpers/themeController.ts` (логика build+inject) + `/Users/denisurevic/Documents/tweb/src/scss/mixins/_splitColor.scss` + `functions.scss` (формулы производных).

- [ ] **Step 1: Падающий тест** `themeController.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { setTheme } from './themeController'

const rootStyle = () => document.getElementById('theme')!.textContent || ''

describe('themeController', () => {
  it('injects primary-color + derived + rgb for day', () => {
    setTheme('day')
    const css = rootStyle()
    expect(css).toContain('--primary-color:#3390ec')
    expect(css).toMatch(/--primary-color-rgb:\s*51,\s*144,\s*236/)
    expect(css).toContain('--light-primary-color:')
    expect(document.documentElement.classList.contains('night')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('day')
  })
  it('night toggles .night class', () => {
    setTheme('night')
    expect(document.documentElement.classList.contains('night')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
  })
  it('reuses single <style id=theme>', () => {
    setTheme('day'); setTheme('night')
    expect(document.querySelectorAll('#theme').length).toBe(1)
  })
})
```

- [ ] **Step 2: Запустить → FAIL**.
- [ ] **Step 3: Реализовать** `setTheme` + генерацию производных. Значения `--primary-color` в тесте сверить с tweb; форматирование CSS (пробелы) подогнать под реализацию (тест на `toContain`/regex — устойчив к пробелам).
- [ ] **Step 4: Тест → PASS** + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(theme): themeController — инжект токенов + производные + .night (core/theme)`.

---

## Task 4: Cutover — провод + пресеты + токены + настройки

Атомарная задача (все правки должны лечь вместе, иначе промежуточные визуалы поедут). После неё приложение работает на новом движке.

**Files:**
- Modify: `web-client/src/theme.ts`
- Modify: `web-client/src/settings.tsx:120-130`
- Modify: `web-client/src/core/hooks/useThemeToggle.ts`
- Modify: `web-client/src/styles/_tokens.scss`
- Modify: `web-client/src/components/settings/GeneralSettings.tsx:22-`

**Interfaces:**
- Consumes: `core/theme/themeController.ts` (`setTheme`), `config/themePresets.ts` (`ThemePresetName`).

- [ ] **Step 1: `theme.ts`** — заменить пресеты:

```ts
export type Mode = 'light' | 'dark'
export type ThemePreset = 'day' | 'night' | 'light' | 'tinted'
export type ThemeChoice = ThemePreset | 'system'

export const PRESET_MODE: Record<ThemePreset, Mode> = {
  day: 'light', light: 'light', night: 'dark', tinted: 'dark',
}

export function resolvePreset(choice: ThemeChoice): ThemePreset {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day'
}
```

- [ ] **Step 2: `settings.tsx` миграция persist** (сейчас на :120-130 есть legacy light→classic/dark→night; classic больше нет). Обновить так, чтобы любой устаревший выбор (`classic`, `light`-legacy) → `day`, `dark` → `night`:

```ts
// в rehydrate/migrate persist:
const legacyToPreset: Record<string, ThemeChoice> = {
  classic: 'day', light: 'day', dark: 'night',
}
const mapped = legacyToPreset[s.themeChoice as string]
if (mapped) return { ...DEFAULTS, themeChoice: mapped }
```
(Дефолт store: `themeChoice: 'system'` — оставить.)

- [ ] **Step 3: `useThemeToggle.ts`** — применять тему через `themeController.setTheme` (он сам ставит `data-theme`+`.night`+инжект) вместо ручной установки `data-theme`:

```ts
import { setTheme } from '../theme/themeController'
// в эффекте применения (до paint):
useLayoutEffect(() => { setTheme(resolvePreset(themeChoice)) }, [themeChoice])
// toggle-функция: PRESET_MODE[preset] === 'dark' ? 'day' : 'night'
```
Сохранить существующее API хука (что экспортит — не ломать вызовы). Убедиться, что `setTheme` зовётся до первого paint (layout-effect / в bootstrap).

- [ ] **Step 4: `_tokens.scss`** — удалить старые блоки `:root`/`[data-theme=classic|day|night|dark]`. Вместо них:
  - **Алиас-блок семантических** (в `:root`, значения приходят из инжекта themeController):
    ```scss
    :root {
      --tg-accent: var(--primary-color);
      --tg-textPrimary: var(--primary-text-color);
      --tg-textSecondary: var(--secondary-text-color);
      --tg-textFaint: var(--secondary-text-color); /* нет прямого аналога — ближайший */
      --tg-link: var(--link-color);
      --tg-green: var(--green-color);
      --tg-divider: var(--border-color);
      --tg-bubble: var(--surface-color);
      --tg-sidebarBg: var(--surface-color);
      --tg-bubbleOut: var(--message-out-background-color);
      --tg-bubbleOutText: var(--message-out-primary-color);
      --tg-badge: var(--primary-color);
      --tg-searchBg: var(--input-search-background-color);
      --tg-inputSearchBg: var(--input-search-background-color);
      --tg-menuShadow: var(--menu-box-shadow);
      --tg-skelBase: var(--surface-color);
      --tg-skelHi: var(--light-secondary-text-color);
      --tg-hover: var(--light-secondary-text-color);
      /* … остальные семантические — по таблице (см. Step 5) … */
    }
    ```
  - **Бесхозные (нет tweb-аналога) — оставить per-theme**, но перегруппировать под 4 пресета (light-набор для day+light, dark-набор для night+tinted). Значения взять из старых блоков (classic/day → light; night/dark → dark):
    ```scss
    [data-theme='day'], [data-theme='light'] {
      --tg-appBg: var(--background-color);
      --tg-accentGradient: linear-gradient(135deg, #3390ec 0%, #58a6f5 100%);
      --tg-composeShadow: 0 6px 22px rgba(51, 144, 236, 0.4);
      --tg-bgGrad0: #dbddbb; --tg-bgGrad1: #6ba587; --tg-bgGrad2: #d5d88d; --tg-bgGrad3: #88b884;
      --tg-searchCardBg: #ffffff; --tg-searchCardShadow: 0 6px 28px -6px rgba(0,0,0,0.22);
      --tg-plateShadow: 0 1px 8px rgba(0,0,0,0.16);
      --tg-sectionBackdrop: var(--background-color);
      --tg-inputBorderIdle: #dfe1e5; --tg-switchOff: #c4c9cc;
      /* + section/column box-shadow композиция как было */
    }
    [data-theme='night'], [data-theme='tinted'] {
      --tg-appBg: var(--background-color);
      --tg-accentGradient: linear-gradient(135deg, #8774e1 0%, #9a86ec 100%);
      --tg-composeShadow: 0 6px 22px rgba(135,116,225,0.5);
      --tg-bgGrad0: #fec496; --tg-bgGrad1: #dd6cb9; --tg-bgGrad2: #962fbf; --tg-bgGrad3: #4f5bd5;
      --tg-searchCardBg: #2c2c2e; --tg-searchCardShadow: 0 6px 28px -4px rgba(0,0,0,0.6);
      --tg-plateShadow: 0 1px 8px rgba(0,0,0,0.45);
      --tg-inputBorderIdle: #2f2f2f; --tg-switchOff: var(--secondary-color);
    }
    ```
  - `--message-highlighting-color` и `--ripple-color`: оставить как были (per light/dark), keyed на новые data-theme.

- [ ] **Step 5: Таблица маппинга** — пройти по ВСЕМ `--tg-*` из старого `_tokens.scss` и по grep `var(--tg-` (242 файла: уникальные имена, не файлы), для каждого решить: (a) есть tweb-семантика → алиас в `:root`; (b) нет → оставить per-theme бесхозным. Гарантировать: **ни одно используемое `--tg-*` не осталось без определения** (иначе токен пустой → UI поедет). Свести список уникальных `--tg-*` командой `grep -rho 'var(--tg-[a-zA-Z-]*)' src | sort -u` и сверить с определёнными.

- [ ] **Step 6: `GeneralSettings.tsx`** — `THEME_RADIOS`/карточки → 4 пресета:

```ts
const THEME_RADIOS: { choice: ThemeChoice; label: string }[] = [
  { choice: 'system', label: t('Theme.SystemDefault') },
  { choice: 'day', label: t('Theme.Day') },
  { choice: 'night', label: t('Theme.Night') },
  { choice: 'light', label: t('Theme.Light') },
  { choice: 'tinted', label: t('Theme.Tinted') },
]
```
Карточки-превью (`THEME_CARDS`, если есть): обновить preset-значения на day/night/light/tinted (убрать classic/dark). i18n-ключи — использовать существующие или добавить в i18n-словарь.

- [ ] **Step 7: Сборка** — `npm run typecheck` + `npm test` + `npm run build` зелёные. Прогнать `grep -rho 'var(--tg-[a-zA-Z-]*)' src | sort -u` и глазами сверить, что каждое имя определено в `_tokens.scss`.
- [ ] **Step 8: Commit** `feat(theme): cutover на themeController — 4 темы tweb, синий дефолт, алиас-мост`.

---

## Task 5: Live-верификация на стенде

**Files:** нет правок кода (верификация); при находках — фиксы в затронутых файлах.

- [ ] **Step 1:** Собрать фронт (`npx vite build --outDir ../client-build`) и поднять стенд (`msgrverify`, :38443).
- [ ] **Step 2:** Залогиниться (OTP 12345), открыть General Settings → переключить все 4 темы. Проверить:
  - `day` — синий акцент (дефолт light), `night` — тёмная с `.night` на `<html>`, `light` — светлая, `tinted` — не падает (статичный фолбэк).
  - В DevTools: `getComputedStyle(document.documentElement).getPropertyValue('--primary-color')` не пуст; `--primary-color-rgb`, `--light-primary-color` присутствуют; `<style id="theme">` один.
  - `document.documentElement.classList.contains('night')` = true для night/tinted.
- [ ] **Step 3:** Прогнать по UI (сайдбар, список диалогов, чат, пузыри in/out, контекст-меню, настройки, инфо-панель) — ничего не поехало (алиасы резолвятся), 0 ошибок в консоли.
- [ ] **Step 4:** Проверить миграцию: в IndexedDB/localStorage выставить `themeChoice: 'classic'` → перезагрузка → тема стала `day` (не сломалась); аналогично `dark`→`night`.
- [ ] **Step 5:** Зафиксировать результат верификации (что PASS/что чинили). Правки — коммитом `fix(theme): …` при необходимости.

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** color.ts (Task1), themePresets+appColorMap (Task2), themeController+инжект+.night+data-theme (Task3), theme.ts/миграция/провод/токены/настройки (Task4), стенд-верификация (Task5). tinted-заглушка и отказ от view-transition — в Task3-адаптациях. Алиас-мост — Task4 Step4-5. ✅
- **Типы:** `ThemePresetName` (config) vs `ThemePreset` (theme.ts) — намеренно одинаковый union day/night/light/tinted; при импорте в Task4 использовать один источник (`theme.ts` реэкспортит или config — согласовать в Task4, не плодить два несовместимых union).
- **Плейсхолдеры:** значения производных/hex помечены «из tweb» намеренно (мандат 1:1 — портировать из источника, не выдумывать в плане); таблица маппинга — явный шаг Task4 Step5.
