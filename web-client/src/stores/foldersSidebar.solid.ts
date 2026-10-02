/**
 * Порт tweb `src/stores/foldersSidebar.ts` (112 строк) — режим показа папок:
 * горизонтальный ряд вкладок над списком чатов или вертикальная колонка слева.
 * План — `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`,
 * задача 8; разбор оригинала — `docs/tweb/folders-tabs.md` § 1.9.
 *
 * Взято у оригинала: сигналы `useHasFolders` (`:43-50`, пишет владелец папок
 * `lib/appDialogsManager.ts` из `onFiltersLengthChange`, `:1315-1316`),
 * `useFoldersSidebarShown` (`:25-41`), `useIsSidebarCollapsed` (`:52-59`), вызов
 * `setFoldersSidebarShown` из эффекта показа колонки (`:30-34`) и итоговый
 * эффект body-классов (`:90-112`):
 *   `has-horizontal-folders` = есть папки ∧ (не свёрнута ∨ экран мобильный)
 *                              ∧ колонка не показана;
 *   `has-vertical-folders`   = есть папки ∧ не горизонтальный.
 * Ряд вкладок владелец держит в DOM всегда, его видимость решает только первый
 * класс (`styles/tweb/_leftSidebar.scss:304-313`), поэтому класс не косметика:
 * статического `has-horizontal-folders` в `index.html` больше нет.
 *
 * ── Расхождения с оригиналом ────────────────────────────────────────────────
 *  1. «Колонка показана» — не производная (`createMemo` от сырой настройки
 *     `useHasFoldersSidebar` и `!mediaSizes.isLessThanFloatingLeftSidebar`,
 *     `:25-28`), а сигнал с сеттером, который пишет колонка
 *     (`components/Sidebar.tsx`): вертикальная колонка у нас ещё React
 *     (`components/folders/FoldersSidebar.tsx`, отложенная задача 17) и
 *     рендерится по своему условию. Класс обязан совпадать с тем, что
 *     нарисовано, иначе при расхождении условий ряд и колонка окажутся на
 *     экране вместе — поэтому факт «показана» сообщает тот, кто её рисует.
 *     Сырая настройка `useHasFoldersSidebar` (`:11-18`) не заводится: у нас
 *     это `tabsInSidebar` стора настроек, а другого читателя, кроме условия
 *     колонки, у неё нет: бургер-морф (`AppSidebarLeft.construct`, tweb
 *     `sidebarLeft/index.ts:431-442`) читает «показана», а не настройку.
 *  2. Класс `body.has-folders-sidebar` (`:32`) не ставится. Его правила в
 *     `_leftSidebar.scss` прячут `.left-sidebar-burger` без `.is-visible`
 *     (`:549-570`), а у нас `is-visible` носят кнопки внутри бургера
 *     (`sidebarLeft/index.ts`), не сам контейнер — включённый класс спрятал бы
 *     кнопку «назад» открытого поиска в режиме «папки слева». Это предмет
 *     порта колонки папок (задача 2-7 волны 7).
 *  3. «Свёрнута» пишет хост колонки (`Sidebar.tsx`, порт `setSidebarLeftWidth`,
 *     ВРЕМЕННО до Э4-1) и ручка ресайза класса; в плавающем
 *     диапазоне 601–925px сигнал ложен; у tweb он = `isUserCollapsedLeft() &&
 *     !isMobile` (`src/index.ts:224-228`) и в этом диапазоне истинен. Сигнал
 *     следует тому, что колонка рисует (`is-collapsed`), — расхождение самой
 *     колонки (`left-sidebar.md` § 8.2), не этого стора.
 *  4. `useMediaSizes()` (реактивный стор `helpers/mediaSizes.ts:46-52`) у нас не
 *     портирован (шапка `core/dom/mediaSizes.ts`) — активный экран здесь
 *     сигнал, который кормит событие `changeScreen` того же инстанса.
 *  5. `useHasOpenLeftTabs` (`:61-74`) не заводится: его читатель (кнопка
 *     поиска свёрнутой колонки) не портирован. `useIsLeftSearchActive`
 *     (`:76-88`) есть — его читает бургер-морф класса колонки; пишет сеттер
 *     `AppSidebarLeft.isSearchActive` (tweb `sidebarLeft/index.ts:134-139`),
 *     который пока зовёт React-владелец поиска (`Sidebar.tsx`, ВРЕМЕННО до 2-3).
 */
import { createEffect, createRoot, createSignal } from 'solid-js'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import { setFoldersSidebarShown } from '@core/dom/updateColumnWidths'

const foldersSidebarShownSignal = createRoot(() => {
  const [shown, setShown] = createSignal(false)

  // `:30-34`: панель резервирует место — правая колонка начинает всплывать
  // раньше, а чат становится уже (`updateColumnWidths`).
  createEffect(() => {
    setFoldersSidebarShown(shown())
  })

  return [shown, setShown] as const
})

/** Показана ли вертикальная колонка папок на экране (расхождение 1). */
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

/** Свёрнута ли левая колонка в полосу аватаров (расхождение 3). */
export function useIsSidebarCollapsed() {
  return isSidebarCollapsedSignal
}

// tweb :76-88 — Whether the left sidebar's search input is focused / search
// panel is open. Drives the burger element's "back-arrow vs menu icon" state
// via a Solid effect so the class wiring stays in one place.
const isLeftSearchActiveSignal = createRoot(() => {
  const [isLeftSearchActive, setIsLeftSearchActive] = createSignal(false)
  return [isLeftSearchActive, setIsLeftSearchActive] as const
})

/** Открыт ли глобальный поиск колонки (расхождение 5). */
export function useIsLeftSearchActive() {
  return isLeftSearchActiveSignal
}

// расхождение 4
const activeScreen = createRoot(() => {
  const [screen, setScreen] = createSignal(mediaSizes.activeScreen)
  mediaSizes.addEventListener('changeScreen', (_from, to) => setScreen(to))
  return screen
})

createRoot(() => {
  const [hasFolders] = hasFoldersSignal
  const [foldersSidebarShown] = foldersSidebarShownSignal
  const [isSidebarCollapsed] = isSidebarCollapsedSignal
  createEffect(() => {
    const hasFolders$ = hasFolders()
    const hasHorizontal = (!isSidebarCollapsed() || activeScreen() < ScreenSize.medium) &&
      !foldersSidebarShown()
    const hasVertical = !hasHorizontal
    document.body.classList.toggle('has-horizontal-folders', hasFolders$ && hasHorizontal)
    document.body.classList.toggle('has-vertical-folders', hasFolders$ && hasVertical)
  })
})
