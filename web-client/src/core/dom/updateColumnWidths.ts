// Ширины колонок — порт tweb `src/helpers/updateColumnWidths.ts`.
// JS владеет всеми width-переменными, SCSS их только читает. Без этого модуля
// портированные партиалы (`_chat.scss` и далее) не могут раскладывать `.bubbles`:
// он позиционируется абсолютом относительно `--left-column-width` /
// `--right-column-width` / `--page-chats-padding`, а `.bubbles-inner` считает
// ширину от `--chat-width`.
//
// НЕ портировано (нет подсистемы — вернуть вместе с ней):
//   • пользовательская ширина сайдбаров (localStorage + ручки ресайза) — у нас
//     колонки не тянутся, поэтому всегда «предпочтения нет»;
//   • всплывание свёрнутого сайдбара при открытой вкладке (openTabsLeftSidebar).
// Формулы, зависящие от этих величин, оставлены как в оригинале — вместе с
// подсистемой достаточно будет вернуть переменные состояния.

// Значения — 1:1 из tweb (updateColumnWidths.ts:66-99).
export const DEFAULT_COLUMN_WIDTH = 360
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

// Брейкпоинты — те же, что в SCSS ($small-screen / $floating-left-sidebar).
const MOBILE_SIZE = 600
const FLOATING_LEFT_SIDEBAR_SIZE = 925

const last = {
  visual: -1, layout: -1, right: -1, middle: -1, defaultColumn: -1,
  foldersWidth: -1, foldersOffset: -1, chatWidth: -1, rightSidebarFits: -1,
  pageChatsPaddingRoot: -1, pageChatsPaddingChat: -1,
  floats: undefined as boolean | undefined,
}

let installed = false
// Виден ли сайдбар папок — зеркалит состояние Sidebar (в tweb это
// setFoldersSidebarShown из stores/foldersSidebar.ts).
let foldersSidebarShown = false

export function setFoldersSidebarShown(value: boolean): void {
  if (foldersSidebarShown === value) return
  foldersSidebarShown = value
  updateColumnWidths()
}

export default function updateColumnWidths(): void {
  const root = document.documentElement
  const vw = window.innerWidth
  const isMobile = vw <= MOBILE_SIZE
  const isFloatingLeft = vw <= FLOATING_LEFT_SIDEBAR_SIZE && !isMobile

  // html несёт safe-area как горизонтальный padding: считаем по content-box,
  // иначе на iPhone в ландшафте чат считается по более широкому вьюпорту.
  const rootStyle = getComputedStyle(root)
  const safeAreaPaddingX = (parseFloat(rootStyle.paddingLeft) || 0) + (parseFloat(rootStyle.paddingRight) || 0)
  const availableWidth = vw - safeAreaPaddingX

  const defaultColumnWidth = Math.min(vw, DEFAULT_COLUMN_WIDTH)
  // Ресайза колонок нет — визуальная и layout-ширина совпадают.
  const visualLeftWidth = isMobile ? vw : defaultColumnWidth
  const layoutLeftWidth = visualLeftWidth
  const rightWidth = isMobile ? vw : defaultColumnWidth

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
  window.addEventListener('resize', updateColumnWidths)
  updateColumnWidths()
}
