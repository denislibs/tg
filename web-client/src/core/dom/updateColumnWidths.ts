// Ширины колонок — порт tweb `src/helpers/updateColumnWidths.ts`.
// JS владеет всеми width-переменными, SCSS их только читает. Без этого модуля
// портированные партиалы (`_chat.scss` и далее) не могут раскладывать `.bubbles`:
// он позиционируется абсолютом относительно `--left-column-width` /
// `--right-column-width` / `--page-chats-padding`, а `.bubbles-inner` считает
// ширину от `--chat-width`.
//
// Переменные (комментарий tweb updateColumnWidths.ts:1-61 в сжатом виде):
//   --default-column-width      min(vw, 360) — эталонная ширина сайдбара, она же
//                               фолбэк, когда пользователь ничего не тянул;
//   --left-column-visual-width  нарисованная ширина #column-left;
//   --left-column-width         ширина, которую #column-left занимает в потоке
//                               (отличается от visual только когда свёрнутый
//                               сайдбар всплыл под открытую вкладку: визуально
//                               360, в раскладке — по-прежнему 80, колонка
//                               наезжает на чат, а не двигает его);
//   --right-column-width        ширина правой колонки (предпочтение, зажатое в
//                               MIN/MAX); на узком экране — весь вьюпорт;
//   --middle-column-width(-value), --chat-width, --right-sidebar-fits,
//   --folders-sidebar-width/-offset, --page-chats-padding — см. tweb.
//
// Отступления от tweb:
//   • пользовательская ширина лежит не в отдельных localStorage-ключах
//     ('sidebar-left-width'/'sidebar-right-width'), а в общем сторе настроек
//     (`settings.tsx`) — у нас так принято для всего, что переживает перезагрузку;
//   • нет rootScope-события 'resizing_left_sidebar': пересчёт дёргается прямо из
//     сеттеров, а побочные эффекты драга висят на `onSwipeTick` ручки ресайза.
import clamp from '@helpers/number/clamp'
import throttle from '@helpers/schedulers/throttle'
import mediaSizes from './mediaSizes'
import { useSettingsStore } from '../../settings'

// Значения — 1:1 из tweb (updateColumnWidths.ts:70-101).
export const DEFAULT_COLUMN_WIDTH = 360
export const MIN_SIDEBAR_WIDTH = 320
export const MAX_SIDEBAR_WIDTH = 480
export const SIDEBAR_COLLAPSE_FACTOR = 0.65
// Ширина #column-left в свёрнутом виде. Совпадает с --sidebar-collapsed-width
// из styles/tweb/_leftSidebar.scss:4.
export const SIDEBAR_COLLAPSED_WIDTH = 80
const FOLDERS_SIDEBAR_WIDTH = 72
const FOLDERS_SIDEBAR_GAP = 8
const FOLDERS_SIDEBAR_OFFSET = FOLDERS_SIDEBAR_WIDTH + FOLDERS_SIDEBAR_GAP
const PAGE_CHATS_PADDING_ROOT_DESKTOP = 16
const PAGE_CHATS_PADDING_ROOT_HANDHELD = 0
const PAGE_CHATS_PADDING_CHAT_DESKTOP = 16
const PAGE_CHATS_PADDING_CHAT_HANDHELD = 8
const PAGE_CHATS_PADDING = PAGE_CHATS_PADDING_ROOT_DESKTOP
const CHAT_WIDTH_MAX = 696
const RIGHT_SIDEBAR_FITS_EXTRA = 64

// Предпочтения пользователя по ширине пристыкованных сайдбаров (tweb
// updateColumnWidths.ts:106-111). `undefined` — «предпочтения нет, брать
// DEFAULT_COLUMN_WIDTH»; для левой колонки 0 дополнительно значит «свёрнута».
let userPreferredLeftWidth: number | undefined
let userPreferredLeftCollapsed = false
let userPreferredRightWidth: number | undefined
let preferencesLoaded = false

// Транзиентное состояние: сайдбар свёрнут, но внутри открыта вкладка
// (настройки и т.п.) — колонка всплывает до полной ширины, пока вкладка видна.
// Анимацию делает CSS (transition: width у #column-left.is-collapsed), JS
// переключает только установившийся флаг. (tweb updateColumnWidths.ts:117)
let openTabsLeftSidebar = false

// Виден ли сайдбар папок — зеркалит состояние Sidebar (в tweb это
// setFoldersSidebarShown из stores/foldersSidebar.ts).
let foldersSidebarShown = false

// tweb читает localStorage прямо в теле модуля (IIFE loadUserPreferences,
// :124-138). У нас источник — стор настроек, поэтому чтение отложено до первого
// пересчёта: так модуль не зависит от порядка импортов.
function loadUserPreferences(): void {
  if (preferencesLoaded) return
  preferencesLoaded = true
  const { sidebarLeftWidth, sidebarRightWidth } = useSettingsStore.getState()
  if (sidebarLeftWidth != null && !isNaN(sidebarLeftWidth)) {
    if (sidebarLeftWidth === 0) userPreferredLeftCollapsed = true
    else userPreferredLeftWidth = clamp(sidebarLeftWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  }
  if (sidebarRightWidth != null && !isNaN(sidebarRightWidth)) {
    userPreferredRightWidth = clamp(sidebarRightWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  }
}

// Записывать настройки на каждый тик драга нельзя — tweb троттлит персист на
// 200 мс (updateColumnWidths.ts:140-149), общим `@helpers/schedulers/throttle`
// (leading + trailing). Здесь лежала локальная копия этого хелпера — снята,
// потребитель сведён к порту.
const persistLeftPreference = throttle(() => {
  useSettingsStore.getState().update({
    sidebarLeftWidth: userPreferredLeftCollapsed ? 0 : userPreferredLeftWidth,
  })
}, 200)

const persistRightPreference = throttle(() => {
  useSettingsStore.getState().update({ sidebarRightWidth: userPreferredRightWidth })
}, 200)

/**
 * Дёргает левая ручка ресайза во время драга. `width <= 0` записывает свёрнутое
 * предпочтение, любое другое значение зажимается в MIN/MAX. (tweb :156-166)
 */
export function setUserPreferredLeft(width: number): void {
  loadUserPreferences()
  if (width <= 0) {
    userPreferredLeftCollapsed = true
    userPreferredLeftWidth = undefined
  } else {
    userPreferredLeftCollapsed = false
    userPreferredLeftWidth = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  }
  persistLeftPreference()
  updateColumnWidths()
}

/**
 * Дёргает правая ручка ресайза. Ширина зажимается в MIN/MAX — у правой колонки
 * свёрнутого состояния нет. (tweb :172-176)
 */
export function setUserPreferredRight(width: number): void {
  loadUserPreferences()
  userPreferredRightWidth = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  persistRightPreference()
  updateColumnWidths()
}

/** Запомненное предпочтение «сайдбар свёрнут» (tweb :178-180). */
export function isUserCollapsedLeft(): boolean {
  loadUserPreferences()
  return userPreferredLeftCollapsed
}

/**
 * Переключатель «внутри открыта вкладка»: свёрнутый сайдбар всплывает до
 * DEFAULT_COLUMN_WIDTH вместо SIDEBAR_COLLAPSED_WIDTH. Саму смену ширины
 * анимирует CSS. (tweb :188-192)
 */
export function setOpenTabsLeftSidebar(value: boolean): void {
  if (openTabsLeftSidebar === value) return
  openTabsLeftSidebar = value
  updateColumnWidths()
}

/**
 * Зеркалит видимость сайдбара папок: он резервирует место, значит правая
 * колонка начинает всплывать раньше. (tweb :199-203)
 */
export function setFoldersSidebarShown(value: boolean): void {
  if (foldersSidebarShown === value) return
  foldersSidebarShown = value
  updateColumnWidths()
}

// tweb :205-221
function computeVisualLeftWidth(vw: number, isMobile: boolean, isFloatingLeft: boolean): number {
  const defaultColumnWidth = Math.min(vw, DEFAULT_COLUMN_WIDTH)
  // Узкий экран — колонка занимает свою ячейку целиком.
  if (isMobile) return vw
  // 601-925px — выдвижная панель поверх чата, всегда дефолтной ширины.
  if (isFloatingLeft) return defaultColumnWidth
  // Свёрнута И внутри ничего не открыто → узкая полоса. Открытая вкладка
  // подменяет это полной шириной, переход анимирует CSS у .is-collapsed.
  if (userPreferredLeftCollapsed && !openTabsLeftSidebar) return SIDEBAR_COLLAPSED_WIDTH
  return userPreferredLeftWidth ?? defaultColumnWidth
}

// Ширина, которую левая колонка резервирует в потоке. Совпадает с визуальной
// везде, кроме «свёрнута + всплыла под вкладку»: там остаётся 80, и развёрнутый
// сайдбар наезжает на чат, а не двигает его. (tweb :227-237)
function computeLayoutLeftWidth(vw: number, isMobile: boolean, isFloatingLeft: boolean): number {
  const defaultColumnWidth = Math.min(vw, DEFAULT_COLUMN_WIDTH)
  if (isMobile) return vw
  if (isFloatingLeft) return defaultColumnWidth
  if (userPreferredLeftCollapsed) return SIDEBAR_COLLAPSED_WIDTH
  return userPreferredLeftWidth ?? defaultColumnWidth
}

// tweb :239-243
function computeRightWidth(vw: number, isMobile: boolean): number {
  if (isMobile) return vw
  return userPreferredRightWidth ?? Math.min(vw, DEFAULT_COLUMN_WIDTH)
}

const last = {
  visual: -1, layout: -1, right: -1, middle: -1, defaultColumn: -1,
  foldersWidth: -1, foldersOffset: -1, chatWidth: -1, rightSidebarFits: -1,
  pageChatsPaddingRoot: -1, pageChatsPaddingChat: -1,
  floats: undefined as boolean | undefined,
}

let installed = false

export default function updateColumnWidths(): void {
  loadUserPreferences()
  const root = document.documentElement
  const vw = window.innerWidth
  // Брейкпоинты — у `mediaSizes` (порт tweb `helpers/mediaSizes.ts`), ровно как
  // в оригинале (updateColumnWidths.ts:207-208): своих констант 600/925 модуль
  // не держит, это был второй владелец того же факта.
  const isMobile = mediaSizes.isMobile
  const isFloatingLeft = mediaSizes.isLessThanFloatingLeftSidebar && !isMobile

  // html несёт safe-area как горизонтальный padding: считаем по content-box,
  // иначе на iPhone в ландшафте чат считается по более широкому вьюпорту.
  const rootStyle = getComputedStyle(root)
  const safeAreaPaddingX = (parseFloat(rootStyle.paddingLeft) || 0) + (parseFloat(rootStyle.paddingRight) || 0)
  const availableWidth = vw - safeAreaPaddingX

  const defaultColumnWidth = Math.min(vw, DEFAULT_COLUMN_WIDTH)
  const visualLeftWidth = computeVisualLeftWidth(vw, isMobile, isFloatingLeft)
  const layoutLeftWidth = computeLayoutLeftWidth(vw, isMobile, isFloatingLeft)
  const rightWidth = computeRightWidth(vw, isMobile)

  const foldersOffset = foldersSidebarShown ? FOLDERS_SIDEBAR_OFFSET : 0
  const rightColumnFits = foldersOffset + layoutLeftWidth + rightWidth + CHAT_WIDTH_MAX + PAGE_CHATS_PADDING * 4
  // На узком экране правая колонка всегда перекрывает чат (слайдер).
  const floats = isMobile || availableWidth < rightColumnFits
  const middleWidth = isMobile ? vw : availableWidth - PAGE_CHATS_PADDING * 2
  // Ширина контента чата: на узком — весь экран, иначе кап 696 и не больше, чем
  // осталось справа от левой колонки (её отступ + два гаттера вокруг чата).
  const chatAvailableWidth = (isMobile || isFloatingLeft)
    ? middleWidth
    : availableWidth - foldersOffset - layoutLeftWidth - PAGE_CHATS_PADDING * 3
  const chatWidth = isMobile ? vw : Math.min(chatAvailableWidth, CHAT_WIDTH_MAX)
  const rightSidebarFits = DEFAULT_COLUMN_WIDTH * 2 + CHAT_WIDTH_MAX + RIGHT_SIDEBAR_FITS_EXTRA
  const pageChatsPaddingRoot = isMobile ? PAGE_CHATS_PADDING_ROOT_HANDHELD : PAGE_CHATS_PADDING_ROOT_DESKTOP
  const pageChatsPaddingChat = isMobile ? PAGE_CHATS_PADDING_CHAT_HANDHELD : PAGE_CHATS_PADDING_CHAT_DESKTOP

  const setVar = (name: string, value: string) => root.style.setProperty(name, value)

  if (last.defaultColumn !== defaultColumnWidth) {
    setVar('--default-column-width', defaultColumnWidth + 'px')
    last.defaultColumn = defaultColumnWidth
  }
  if (last.visual !== visualLeftWidth) {
    setVar('--left-column-visual-width', visualLeftWidth + 'px')
    last.visual = visualLeftWidth
  }
  if (last.layout !== layoutLeftWidth) {
    setVar('--left-column-width', layoutLeftWidth + 'px')
    last.layout = layoutLeftWidth
  }
  if (last.right !== rightWidth) {
    setVar('--right-column-width', rightWidth + 'px')
    last.right = rightWidth
  }
  if (last.middle !== middleWidth) {
    setVar('--middle-column-width', middleWidth + 'px')
    setVar('--middle-column-width-value', '' + middleWidth)
    last.middle = middleWidth
  }
  if (last.foldersWidth !== FOLDERS_SIDEBAR_WIDTH) {
    setVar('--folders-sidebar-width', FOLDERS_SIDEBAR_WIDTH + 'px')
    last.foldersWidth = FOLDERS_SIDEBAR_WIDTH
  }
  if (last.foldersOffset !== foldersOffset) {
    setVar('--folders-sidebar-offset', foldersOffset + 'px')
    last.foldersOffset = foldersOffset
  }
  if (last.chatWidth !== chatWidth) {
    setVar('--chat-width', chatWidth + 'px')
    last.chatWidth = chatWidth
  }
  if (last.rightSidebarFits !== rightSidebarFits) {
    setVar('--right-sidebar-fits', rightSidebarFits + 'px')
    last.rightSidebarFits = rightSidebarFits
  }
  if (last.pageChatsPaddingRoot !== pageChatsPaddingRoot) {
    setVar('--page-chats-padding', pageChatsPaddingRoot + 'px')
    last.pageChatsPaddingRoot = pageChatsPaddingRoot
  }
  if (last.pageChatsPaddingChat !== pageChatsPaddingChat) {
    const center = document.getElementById('column-center')
    // Узла ещё нет (первый прогон до монтирования React) — повторим на resize.
    if (center) {
      center.style.setProperty('--page-chats-padding', pageChatsPaddingChat + 'px')
      last.pageChatsPaddingChat = pageChatsPaddingChat
    }
  }
  if (last.floats !== floats) {
    document.body.classList.toggle('right-column-floats', floats)
    last.floats = floats
  }
}

/** Однократная установка слушателя resize (tweb installColumnWidthsUpdater). */
export function installColumnWidthsUpdater(): void {
  if (installed) return
  installed = true
  // tweb :385 — пересчёт по событию `mediaSizes`, а не по своему
  // window-слушателю: брейкпоинт и ширины считаются от ОДНОГО снимка окна.
  mediaSizes.addEventListener('resize', updateColumnWidths)
  updateColumnWidths()
}

// Первая простановка — на импорте модуля, ДО того как браузер разрешит стиль
// колонок. Иначе `.chats-container` успевает получить первый стиль с
// `--left-column-width: 0` и уже армированным `transition: transform`, а
// installColumnWidthsUpdater() (layout-эффект Shell, App.tsx) дописывает
// переменные только после — колонка анимированно выезжает 0 → 188px на каждой
// перезагрузке. Дальнейшие пересчёты — по resize-слушателю оттуда же.
// (tweb helpers/updateColumnWidths.ts:390-394)
updateColumnWidths()
