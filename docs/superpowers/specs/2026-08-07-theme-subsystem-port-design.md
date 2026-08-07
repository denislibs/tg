# Порт тема-подсистемы tweb (Волна 1 CSS-паритета) — дизайн

**Дата:** 2026-08-07
**Статус:** спека на ревью
**Контекст:** [аудит стилей/анимаций](../../research/2026-08-07-frontend-tweb-styles-animations-audit.md) §1 (дизайн-токены/темизация). Первая волна программы доведения фронта до «1:1 с tweb».

## Цель

Заменить плоскую статичную систему токенов (`--tg-*` в `_tokens.scss` + `data-theme`) на **рантайм тема-подсистему tweb 1:1**: `themeController` инжектит CSS-переменные с полным набором производных (`--light-*/--dark-*/--light-filled-*/*-rgb`), темы — точные пресеты tweb (day/night/light/tinted), акцент по умолчанию — синий.

## Не входит в эту волну (явный out-of-scope)

- **Big-bang переименование 242 файлов** `var(--tg-*)` → tweb-имена — **отдельный следующий PR** (codemod). Здесь `--tg-*` остаются как **алиас-мост** поверх новых токенов, поэтому потребители не трогаем.
- **Accent-color picker UI** (выбор произвольного акцента) — движок `themeController` его поддерживает, но UI-экран — позже (в волне настроек, §5.7 функц. аудита).
- **tinted-тема: реальный blend от обоев** — машинерия поддерживает tinted, но вычисление цветов из средней яркости обоев хукается в **волне обоев**; пока tinted использует статичный фолбэк-пресет.
- **View-transition при смене темы** (reveal через View Transitions API) — откладываем; смена темы мгновенная.

## Архитектура

Рантайм-стек, портируемый из tweb (источник истины — файлы tweb, значения/логика 1:1):

```
settings-store (выбор темы)
      │  setTheme(preset)
      ▼
themeController ──build colorMap──► генерит производные (appColorMap)
      │                              │
      │  toggle .night на <html>     ▼
      └──────────────────────► inject <style id="theme"> в <head>
                                     │  --primary-color, --light-primary-color,
                                     │  --primary-color-rgb, --surface-color, …
                                     ▼
                        компоненты: var(--primary-color),
                        rgba(var(--primary-color-rgb), .4), var(--light-primary-color)
                                     ▲
                        алиас-мост: --tg-accent: var(--primary-color); …
                        (242 существующих потребителя работают без изменений)
```

## Компоненты

### 1. `helpers/color.ts` (порт tweb `src/helpers/color.ts`)
Чистые цвето-функции, нужные `themeController`: `hexToRgb`, `rgbToHex`/`rgbaToHexa`, `hslaStringToRgba`, `rgbaToHsla`/`hslaToRgba`, `mixColors`, `changeColorAccent`, `getAccentColor`, `getAverageColor` (для будущего tinted). Портировать те, что реально использует `themeController` + `_splitColor`-эквивалент. Юнит-тестируемо (fixtures из известных значений).

### 2. `config/themePresets.ts` (порт tweb `src/config/themePresets.ts`)
- Значения тем **day / night / light / tinted** — точные hex из tweb.
- `appColorMap: {[AppColorName]: {rgb?, light?, lightFilled?, dark?, darkRgb?, darkFilled?}}` — определяет, какие производные генерятся для каждого семантического токена (1:1 из `themeController.ts`).
- Список семантических токенов (`AppColorName`): `primary-color`, `message-out-primary-color`, `surface-color`, `danger-color`, `primary-text-color`, `secondary-text-color`, `message-out-background-color`, `saved-color`, `message-background-color`, `green-color`, `background-color`, `body-background-color`, `border-color`, `secondary-color`, `link-color`, `input-search-background-color`.
- `presetToThemeSettings(preset)` — резолв пресета в набор цветов.

### 3. `helpers/themeController.ts` (порт tweb `src/helpers/themeController.ts`, урезанный)
- `setTheme(preset)`: строит `colorMap` из пресета, прогоняет через `appColorMap` → набор CSS-переменных со всеми производными, инжектит в `<style id="theme">`, тоглит класс `.night` на `<html>` для тёмных тем.
- Nil-safe: guard на отсутствие `document`/`window` (worker/SSR-безопасность).
- **Убрано из порта** (out-of-scope): view-transition reveal (`THEME_TRANSITION_TIMEOUT`, `dispatchHeavyAnimationEvent`), tinted wallpaper-blend (метод-хук оставить со статичным фолбэком), accent-preset UI. Оставить сигнатуры/хуки, чтобы позже дозаполнить без переписывания.

### 4. Алиас-мост (`styles/_tokens.scss` переписывается)
Старые плоские блоки `:root/[data-theme=…]` **удаляются**. Вместо них — **один статичный блок алиасов** `--tg-* → var(--tweb-token)`:
```scss
:root {
  --tg-accent: var(--primary-color);
  --tg-textPrimary: var(--primary-text-color);
  --tg-textSecondary: var(--secondary-text-color);
  --tg-link: var(--link-color);
  --tg-green: var(--green-color);
  --tg-divider: var(--border-color);
  --tg-bubble: var(--surface-color);
  --tg-bubbleOut: var(--message-out-background-color);
  --tg-menuShadow: var(--menu-box-shadow);
  /* … полная таблица — deliverable плана (task «mapping table») … */
}
```
Токены без прямого tweb-аналога (`--tg-composeShadow`, `--tg-searchCardBg/Shadow`, `--tg-plateShadow`, `--tg-accentGradient`, `--tg-appBg`, `--tg-sectionBackdrop`, `--tg-textFaint`, `--tg-switchOff`): где есть tweb-эквивалент — маппим на него (заодно чиним §6.6 «цветные тени» → нейтральные `--menu-box-shadow`, и скелетон → `--skeleton-color`); где нет — оставляем как проектный токен, определённый через новые семантические (напр. `--tg-appBg: var(--background-color)`). **Точная таблица маппинга — таск плана, ревьюится до правок.**

### 5. Провод в bootstrap + settings
- `theme.ts`: `ThemePreset` меняется на `'day' | 'night' | 'light' | 'tinted'`; `classic`/`dark` удаляются. `PRESET_MODE`: day/light→light, night/tinted→dark. `resolvePreset('system')` → `day` (light) / `night` (dark). Дефолт светлой = `day` (синий).
- **Миграция сохранённого выбора:** существующие юзеры с `classic`/`dark` в persist → `classic→day`, `dark→night` (в загрузке settings-store).
- Точка входа: `themeController.setTheme(resolvePreset(choice))` при старте и при смене темы (заменяет установку `data-theme`).
- General Settings: список тем → 4 tweb-пресета.

## Data flow (смена темы)
1. Юзер выбирает тему в General Settings → settings-store обновляет `themeChoice` (persist).
2. Подписчик (bootstrap/эффект) зовёт `themeController.setTheme(resolvePreset(choice))`.
3. `themeController` перегенеривает `<style id="theme">` + тоглит `.night`.
4. CSS-переменные меняются каскадно → перерисовка без JS-пересчёта в компонентах.

## Обработка ошибок / edge-cases
- `themeController` без `document` (worker) — no-op guard (тема нужна только в window-контексте).
- Неизвестный/устаревший persist-preset (`classic`/`dark`) → миграция на day/night; неизвестное значение → дефолт `day`.
- `<style id="theme">` создаётся один раз, переиспользуется (не плодить теги).
- tinted без обоев → статичный фолбэк-пресет (не падать).

## Тестирование
- **Юнит (vitest):** `color.ts` — известные конвертации (hex↔rgb, mixColors, changeColorAccent) на fixtures; `appColorMap`-генерация даёт ожидаемые производные для sample-токена.
- **Сборка:** `npm run typecheck` + `npm run build` зелёные; SCSS компилируется.
- **Стенд (live, :38443):** переключить все 4 темы через General Settings; проверить: day=синий дефолт, dark-режим = night, производные переменные присутствуют в DOM (`getComputedStyle(root).getPropertyValue('--light-primary-color')` не пуст, `--primary-color-rgb` есть), `.night` на `<html>` в тёмных темах, существующий UI (сайдбар/чат/пузыри/меню) не поехал (алиасы резолвятся), миграция classic→day / dark→night для старого persist.

## Инварианты (не нарушать)
- Стилизация — SCSS-модули + CSS custom properties; MUI не возвращать (frontend CLAUDE.md).
- Значения тем/логика — **точно из tweb**, не выдумывать (главное правило).
- Мёртвый код удалять: старые блоки `_tokens.scss`, `classic`/`dark` из `theme.ts` — убрать полностью, не оставлять закомментированными.

## Итог-состояние PR-1
Приложение работает на рантайм тема-подсистеме tweb: 4 точные темы, синий дефолт, полный набор производных токенов доступен для будущей копипасты SCSS из tweb; 242 существующих потребителя `--tg-*` работают через алиас-мост. Codemod-переименование и удаление моста — следующий PR.
