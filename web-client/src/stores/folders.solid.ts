/**
 * Порт tweb `src/stores/folders.ts` (222 строки) — список папок для Solid-рядов
 * (`foldersTabs`, задача 4 плана) и `onClick`-сигнал, в который владелец
 * контейнеров (`lib/appDialogsManager.ts`, задача 5) кладёт своё переключение.
 * План — `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`,
 * задача 3; разбор оригинала — `docs/tweb/folders-tabs.md` § 1.5.
 *
 * Взято у оригинала: `StoredFolder` (`:9-17`), `folderItems` (`:55`),
 * `onClick`/`setOnClick` (`:58-59`, `:215-216`), счётчик `{count, muted}` по
 * правилу `getNotificationCountForFilter` (`:19-30` — вынесен в
 * `core/folders/folderUnreadCounts.ts`), однократная гидрация с подписками
 * (`:155-207`), фильтр «Все чаты» в списке всегда (`storages/filters.ts:24-35`,
 * `:93-98` — `prependFilters`).
 *
 * ── Три решения ─────────────────────────────────────────────────────────────
 * 1. Это ПРОЕКЦИЯ, а не второе зеркало факта. У оригинала стор сам себе
 *    источник: его пишут события `filter_update`/`filter_delete`/`filter_order`
 *    (`:180-191`). У нас определения папок уже лежат в `appState.folders`
 *    (Zustand, `stores/appState.ts`), контакты — в `foldersStore.contactIds`,
 *    диалоги — в `chatsStore.dialogs`, настройки типов — в `notifyStore`,
 *    карточки чатов — в `core/peerCache.ts`. Стор наполняется ТОЛЬКО подпиской
 *    на них, писатель ровно один — `project()`, и пишет он
 *    `setFolderItems(reconcile(...))` — так же, как `stores/peers.solid.ts`
 *    адаптирует зеркало вместо заведения своего.
 * 2. `selectedFolderId`/`selectedFolderIndex` (`:54`, `:56`) здесь НЕТ: выбранная
 *    папка — факт `foldersStore.selectedId` («Владение фактами»,
 *    `web-client/CLAUDE.md`), второго держателя быть не должно. Индекс активной
 *    вкладки владелец считает сам от своего `filterId` (свайп, `:622`).
 * 3. Счётчик — одна чистая функция `folderUnreadCounts` на оба ряда; воркерного
 *    `getFolderUnreadCount` у нас нет (отложенная задача 16).
 *
 * ── Расхождения с оригиналом ────────────────────────────────────────────────
 *  1. Порядок не сортируется здесь (`getFolderItemsInOrder`, `:32-51`, по
 *     `filter.localId`): `appState.folders` уже упорядочен единственным
 *     писателем `foldersStore.ts::applyFolders` по `pos, id` (как `ORDER BY` на
 *     бэкенде), и вторая сортировка была бы вторым правилом порядка. «Все
 *     чаты» — всегда первой: у оригинала её `localId` минимальный
 *     (`prependFilters`, `storages/filters.ts:96-98`). Позиция элемента в
 *     `folderItems` и есть наш `localId` (им позиционирует контейнеры задача 5).
 *  2. Фильтр «Все чаты» — порт `LOCAL_FILTER` (`storages/filters.ts:24-35`):
 *     пустой заголовок, флагов типов нет. Правило «всё, кроме архива»
 *     (`exclude_archived`, `:113-115`) у нашей `Folder` не выражается — его
 *     держат владельцы списка и счётчика по `id === ALL_FOLDER_ID`; сам этот
 *     фильтр в `matchesFolder` не передаётся.
 *  3. `chatsCount` (`:15`, `:97`) не заводится: единственный читатель у
 *     оригинала — кнопка «добавить чаты» пустой папки в вертикальной колонке
 *     (`foldersSidebarContent/index.tsx:180-194`), у нас она React и вне плана
 *     (отложенная задача 17).
 *  4. Счётчики пересчитываются целиком на любое движение источников, а не
 *     точечно по `dialog_flush`/`folder_unread` (`:170-178`): таких событий у
 *     главного потока нет, а зеркало диалогов — вот оно. Элементы при этом
 *     живут: `reconcile` по `id` сохраняет прокси неизменившихся папок.
 *  5. `filter_joined` (`:193-195`) и `premium_toggle` (`:197-206`) — событий на
 *     проводе нет, отложенная задача 15. `deleteFolder` со сбросом выбора
 *     (`:120-134`) — забота владельца (`selectTab(0)`, задача 5); вместе с ним
 *     не нужен и `createEffect` `:61-63`, державший `onClick()` для этих трёх
 *     мест.
 *  6. `dispose()` — наше: у оригинала стор живёт вечно (`createRoot` без
 *     выхода). Подписки на Zustand и зеркало пиров — внешние ресурсы, их
 *     снимает `dispose()`; тесты поднимают стор многократно.
 *  7. `createRoot` не нужен: у проекции нет ни `createMemo`, ни `createEffect`
 *     (см. п. 5 и решение 2), а `createStore`/`createSignal` владельца не
 *     требуют.
 */
import { createSignal } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useAppStateStore } from './appState'
import { useFoldersStore } from './foldersStore'
import { useChatsStore } from './chatsStore'
import { useNotifyStore } from './notifyStore'
import { cachedChat, subscribePeerMirror } from '../core/peerCache'
import { ALL_FOLDER_ID } from '../core/folderIds'
import { folderUnreadCounts, type FolderNotifications } from '../core/folders/folderUnreadCounts'
import type { Folder } from '../core/managers/foldersManager'

export type StoredFolder = {
  id: number
  notifications?: FolderNotifications
  filter: Folder
}

/**
 * Переключение на вкладку по индексу — то, что владелец кладёт через
 * `setOnClick(() => selectTab)` (`appDialogsManager.ts:812`). Второй параметр
 * у оригинала назван `dontAnimate` (`:58`), но уходит он в `selectTab`, где это
 * `animate` (`horizontalMenu.ts` — прокси, `args[1]`): `onClick()(0, false)`
 * значит «без анимации». Здесь назван по смыслу.
 */
export type FolderClick = (index: number, animate?: boolean) => void

/** `LOCAL_FILTER` + `generateLocalFilter(FOLDER_ID_ALL)` (`storages/filters.ts:24-35`, `:111-123`). */
const ALL_CHATS_FILTER: Folder = {
  id: ALL_FOLDER_ID,
  title: '',
  pos: 0,
  contacts: false,
  nonContacts: false,
  groups: false,
  broadcasts: false,
  excludeMuted: false,
  excludeRead: false,
  includeChats: [],
  excludeChats: [],
}

const [folderItems, setFolderItems] = createStore<StoredFolder[]>([])
const [onClick, setOnClick] = createSignal<FolderClick>()

/** Единственный писатель `folderItems`. */
function project(): void {
  const { folders } = useAppStateStore.getState()
  const counts = folderUnreadCounts(
    useChatsStore.getState().dialogs,
    folders,
    useFoldersStore.getState().contactIds,
    useNotifyStore.getState().settings,
    cachedChat,
  )
  const items: StoredFolder[] = [
    { id: ALL_FOLDER_ID, notifications: counts[ALL_FOLDER_ID], filter: ALL_CHATS_FILTER },
    ...folders.map((filter) => ({ id: filter.id, notifications: counts[filter.id], filter })),
  ]
  setFolderItems(reconcile(items, { key: 'id' }))
}

let unsubscribe: (() => void)[] | null = null

/**
 * `hydrateFilters` + `initListeners` (`:155-207`): один раз наполнить и
 * подписаться. Каждая подписка реагирует только на СВОЙ ключ — в `chatsStore`
 * ещё живут присутствие и «печатает», их движение счётчиков не меняет.
 */
function hydrate(): void {
  if (unsubscribe) return
  project()
  unsubscribe = [
    useAppStateStore.subscribe((s, prev) => { if (s.folders !== prev.folders) project() }),
    useChatsStore.subscribe((s, prev) => { if (s.dialogs !== prev.dialogs) project() }),
    useFoldersStore.subscribe((s, prev) => { if (s.contactIds !== prev.contactIds) project() }),
    useNotifyStore.subscribe((s, prev) => { if (s.settings !== prev.settings) project() }),
    // Карточка чата решает «канал или группа» — и правило типов папки, и мьют
    // типа (`folderUnreadCounts`, параметр `chatOf`); доехала позже — пересчёт.
    subscribePeerMirror(project),
  ]
}

/** Снять подписки (расхождение 6). Проекция остаётся с последним значением. */
function dispose(): void {
  unsubscribe?.forEach((off) => off())
  unsubscribe = null
}

const foldersStore = {
  folderItems,
  onClick,
  setOnClick,
  hydrate,
  dispose,
}

export default function useFolders() {
  return foldersStore
}
