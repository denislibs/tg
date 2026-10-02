/**
 * Порт tweb `src/stores/foldersSidebar.ts` (112 строк) — режим показа папок:
 * горизонтальный ряд вкладок над списком чатов или вертикальная колонка слева.
 * План — `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`,
 * задача 8; разбор оригинала — `docs/tweb/folders-tabs.md` § 1.9.
 *
 * Взято у оригинала: сигналы `useHasFoldersSidebar` (`:11-18`, сырая настройка),
 * `useFoldersSidebarShown` (`:25-41`: настройка И экран шире плавающего
 * диапазона; эффект ставит `body.has-folders-sidebar` и резервирует место
 * колонке — `setFoldersSidebarShown`), `useHasFolders` (`:43-50`, пишет владелец
 * папок `lib/appDialogsManager.ts` из `onFiltersLengthChange`, `:1315-1316`),
 * `useIsSidebarCollapsed` (`:52-59`), `useHasOpenLeftTabs` (`:61-74`, пишет
 * `AppSidebarLeft.onSomethingOpenInsideChange`, читает кнопка поиска свёрнутой
 * колонки), `useIsLeftSearchActive` (`:76-88`) и итоговый эффект body-классов
 * (`:90-112`):
 *   `has-horizontal-folders` = есть папки ∧ (не свёрнута ∨ экран мобильный)
 *                              ∧ колонка не показана;
 *   `has-vertical-folders`   = есть папки ∧ не горизонтальный.
 * Ряд вкладок владелец держит в DOM всегда, его видимость решает только первый
 * класс (`styles/tweb/_leftSidebar.scss:304-313`), поэтому класс не косметика:
 * статического `has-horizontal-folders` в `index.html` больше нет.
 *
 * ── Расхождения с оригиналом ────────────────────────────────────────────────
 *  1. `useHasFoldersSidebar` — без сеттера: это чтение настройки `tabsInSidebar`
 *     (`stores/appSettings.solid.ts`, над zustand `settings.tsx`), а не второй
 *     держатель того же факта. У tweb сигнал пишут два места — старт
 *     (`src/index.ts:527-528`) и вкладка «Папки» по `settings_updated`
 *     (`chatFolders.tsx:275-282`); у нас оба заменяет подписка на настройку.
 *  2. «Свёрнута» пишет эффект `setSidebarLeftWidth` (`src/index.ts`) и ручка
 *     ресайза класса; в плавающем диапазоне 601–925px сигнал ложен; у tweb он =
 *     `isUserCollapsedLeft() && !isMobile` (`src/index.ts:224-228`) и в этом
 *     диапазоне истинен. Сигнал следует тому, что колонка рисует (`is-collapsed`),
 *     — расхождение самой колонки (`left-sidebar.md` § 8.2), не этого стора.
 *  3. `useMediaSizes()` (реактивный стор `helpers/mediaSizes.ts:46-52`) у нас не
 *     портирован (шапка `core/dom/mediaSizes.ts`) — активный экран и «уже
 *     плавающего диапазона» здесь сигналы, которые кормят события `changeScreen`
 *     и `resize` того же инстанса.
 */
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import { setFoldersSidebarShown } from '@core/dom/updateColumnWidths'
import { useAppSettings } from '@stores/appSettings.solid'

// расхождение 1
const hasFoldersSidebarSignal = createRoot(() => {
  const [appSettings] = useAppSettings()
  const hasFoldersSidebar = createMemo(() => !!appSettings.tabsInSidebar)
  return [hasFoldersSidebar] as const
})

/** Сырая настройка «папки слева» — не зависит от ширины экрана (расхождение 1). */
export default function useHasFoldersSidebar() {
  return hasFoldersSidebarSignal
}

// расхождение 3
const mediaSizesSignals = createRoot(() => {
  const [activeScreen, setActiveScreen] = createSignal(mediaSizes.activeScreen)
  const [isLessThanFloatingLeftSidebar, setIsLessThanFloatingLeftSidebar] = createSignal(mediaSizes.isLessThanFloatingLeftSidebar)
  mediaSizes.addEventListener('changeScreen', (_from, to) => setActiveScreen(to))
  mediaSizes.addEventListener('resize', () => setIsLessThanFloatingLeftSidebar(mediaSizes.isLessThanFloatingLeftSidebar))
  return { activeScreen, isLessThanFloatingLeftSidebar }
})

// `:25-41` — показана ли колонка на самом деле: настройка И экран шире 925px
// (панель прячет SCSS, `_foldersSidebar.scss` `until-floating-left-sidebar`).
// Единственный источник `body.has-folders-sidebar` и места колонки в раскладке
// (`updateColumnWidths`), чтобы все три совпадали.
const foldersSidebarShownSignal = createRoot(() => {
  const [hasFoldersSidebar] = hasFoldersSidebarSignal
  const shown = createMemo(() => hasFoldersSidebar() && !mediaSizesSignals.isLessThanFloatingLeftSidebar())

  createEffect(() => {
    const visible = shown()
    document.body.classList.toggle('has-folders-sidebar', visible)
    setFoldersSidebarShown(visible)
  })

  return [shown] as const
})

export function useFoldersSidebarShown() {
  return foldersSidebarShownSignal
}

const hasFoldersSignal = createRoot(() => {
  const [hasFolders, setHasFolders] = createSignal(false)
  return [hasFolders, setHasFolders] as const
})

/** Есть ли что показывать — больше одной папки (`appDialogsManager.ts:1305-1316`). */
export function useHasFolders() {
  return hasFoldersSignal
}

const isSidebarCollapsedSignal = createRoot(() => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(false)
  return [isSidebarCollapsed, setIsSidebarCollapsed] as const
})

/** Свёрнута ли левая колонка в полосу аватаров (расхождение 2). */
export function useIsSidebarCollapsed() {
  return isSidebarCollapsedSignal
}

// Whether something is open inside the left sidebar (a tab — settings,
// archive, etc., search input focused, or a forum). Mirrors the
// `has-open-tabs` class on `#column-left`; pushed in from
// AppSidebarLeft.onSomethingOpenInsideChange so reactive consumers (e.g.
// the collapsed-search-trigger button) can drive their visibility from a
// signal instead of CSS selectors that combine three sidebar classes.
const hasOpenLeftTabsSignal = createRoot(() => {
  const [hasOpenLeftTabs, setHasOpenLeftTabs] = createSignal(false)
  return [hasOpenLeftTabs, setHasOpenLeftTabs] as const
})

export function useHasOpenLeftTabs() {
  return hasOpenLeftTabsSignal
}

// tweb :76-88 — Whether the left sidebar's search input is focused / search
// panel is open. Drives the burger element's "back-arrow vs menu icon" state
// via a Solid effect so the class wiring stays in one place.
const isLeftSearchActiveSignal = createRoot(() => {
  const [isLeftSearchActive, setIsLeftSearchActive] = createSignal(false)
  return [isLeftSearchActive, setIsLeftSearchActive] as const
})

export function useIsLeftSearchActive() {
  return isLeftSearchActiveSignal
}

createRoot(() => {
  const [hasFolders] = hasFoldersSignal
  const [foldersSidebarShown] = foldersSidebarShownSignal
  const [isSidebarCollapsed] = isSidebarCollapsedSignal
  createEffect(() => {
    const hasFolders$ = hasFolders()
    // Folders render as horizontal tabs unless the vertical panel is actually
    // shown — `!foldersSidebarShown()` is exactly the old
    // `!hasFoldersSidebar() || isLessThanFloatingLeftSidebar`.
    const hasHorizontal = (!isSidebarCollapsed() || mediaSizesSignals.activeScreen() < ScreenSize.medium) &&
      !foldersSidebarShown()
    const hasVertical = !hasHorizontal
    document.body.classList.toggle('has-horizontal-folders', hasFolders$ && hasHorizontal)
    document.body.classList.toggle('has-vertical-folders', hasFolders$ && hasVertical)
  })
})
