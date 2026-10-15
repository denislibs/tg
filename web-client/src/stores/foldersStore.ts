// Папки чатов. Сами определения папок живут в State (tweb `filtersArr`) —
// читаются с диска одним батчем на старте (client/boot.ts), поэтому табы есть
// уже в первом кадре. Здесь остаётся только UI-состояние, которое в tweb тоже
// не персистится: выбранный таб и set контактов для правил contacts/non_contacts.
import { create } from 'zustand'
import { mapFolder, type Folder, type RawFolder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'
import { reconcileById } from '../core/store/reconcile'
import { useAppStateKey, useAppStateStore, setAppState, setAppStates } from './appState'
// Обе константы id папок живут в core/folderIds.ts: их читают и main, и воркер
// (`dialogsManager.getDialogs({filterId})`), второй копии значения быть не должно.
import { ALL_FOLDER_ID } from '../core/folderIds'

interface FoldersUiState {
  selectedId: number
  contactIds: Set<number>
  select: (id: number) => void
  setContacts: (ids: number[]) => void
  upsert: (f: Folder) => void
  remove: (id: number) => void
}

export const useFoldersStore = create<FoldersUiState>((set) => ({
  selectedId: ALL_FOLDER_ID,
  contactIds: new Set(),
  select: (selectedId) => set({ selectedId }),
  setContacts: (ids) => set({ contactIds: new Set(ids) }),
  // Локальное применение ответа REST на create/update — тем же путём, что и
  // снимок из realtime: порядок берётся из `pos`, ссылки соседей сохраняются.
  upsert: (f) => {
    applyFolders([...useAppStateStore.getState().folders.filter((x) => x.id !== f.id), f])
  },
  // Выбор при удалении папки здесь НЕ сбрасывается: писатель `selectedId` один —
  // владелец папок (`lib/appDialogsManager.ts`, `selectFolderByIndex`). Удаление
  // АКТИВНОЙ папки — любым путём, локальным `remove` или пушем
  // `applyFolderUpdate` — он видит подпиской на состав папок: снимает её
  // контейнер и переключает на «Все чаты» (`selectTab(0)`, расхождение 6 его
  // шапки; у tweb — `deleteFolder`, `stores/folders.ts:120-134`).
  remove: (id) => {
    applyFolders(useAppStateStore.getState().folders.filter((f) => f.id !== id))
  },
}))

/** Реактивное чтение папок — единственный способ их получить в UI. */
export function useFolders(): Folder[] {
  return useAppStateKey('folders')
}

/**
 * Порт tweb `FiltersStorage.getDialogFilters` (lib/storages/filters.ts:475-484).
 *
 * Cache-first: папки уже в памяти (подняты из State в boot.ts) — сеть НЕ дёргаем.
 * В tweb это `if (keys.length > PREPENDED_FILTERS && !overwrite) return ...` —
 * список папок меняется редко, и сервер сам присылает апдейт, когда что-то
 * изменилось. Опрашивать его на каждом старте незачем.
 *
 * `overwrite: true` — единственный путь к сети при непустой памяти; его зовут
 * места, где локальное состояние заведомо разъехалось с сервером (откат
 * неудавшегося удаления, вступление в папку по ссылке).
 */
export async function loadFolders(
  managers: {
    folders: { list(): Promise<{ folders: Folder[]; allChatsPos: number }> }
    contacts: { list(): Promise<Contact[]> }
    // Этап 2 (пагинация диалогов): те же контакты нужны владельцу списка —
    // правила папок `contacts`/`non_contacts` он считает сам, в воркере
    // (`dialogsManager.getDialogs({filterId})`). Один источник, два
    // потребителя; второго загрузчика контактов не заводим.
    dialogs: { setContactIds(ids: number[]): Promise<void> }
  },
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<void> {
  // Персист тут НЕ читаем: State уже поднят в boot.ts до рендера.
  if (!useAppStateStore.getState().folders.length || overwrite) {
    try {
      const { folders, allChatsPos } = await managers.folders.list()
      applyFolders(folders)
      applyAllChatsPos(allChatsPos)
    } catch {
      /* оффлайн — остаёмся на том, что подняли из State */
    }
  }
  // Контакты обновляем всегда: они нужны правилам contacts/non_contacts и
  // меняются независимо от папок.
  try {
    const ids = (await managers.contacts.list()).map((c) => c.userId)
    useFoldersStore.getState().setContacts(ids)
    // Владелец списка диалогов фильтрует папки в воркере — те же контакты
    // (см. докблок параметра `dialogs` выше). Именно `await`, а не
    // fire-and-forget: провалившийся RPC обязан попасть в тот же catch, что и
    // провалившийся `/contacts`, — иначе воркер молча остался бы без контактов,
    // а вызывающий считал бы, что доставил их.
    await managers.dialogs.setContactIds(ids)
  } catch {
    /* Оффлайн/упавший RPC: контакты не доехали. Правила contacts/non_contacts
     * от этого не начинают врать — владелец знает, что контактов ЕЩЁ НЕ БЫЛО,
     * и отдаёт для такой папки пустую страницу (скелетоны), а не список, где
     * все считаются не-контактами (см. contactsKnown в dialogsManager.ts).
     * Повтор — ближайший `loadFolders` (бутстрап вкладки, deep-link, откат
     * удаления папки); отдельного ретрая этот этап не заводит. */
  }
}

/** Кадр `folder_update`: снимок папки либо признак удаления (backend folders.go:154/166/174). */
export interface FolderUpdateEvt {
  folder?: RawFolder
  folder_id?: number
  deleted?: boolean
}

/**
 * Применить пуш сервера БЕЗ похода в сеть.
 *
 * tweb на `updateDialogFilters` вынужден перезапрашивать весь список
 * (filters.ts:167) — апдейт MTProto самих фильтров не несёт. Наш бэкенд шлёт
 * абсолютный снимок папки (`folderJSON`, folders.go:94-102), поэтому round trip
 * не нужен: снимок кладём в State тем же реконсайлом.
 *
 * Почему одного снимка достаточно, хотя `emitFolderUpdate` шлётся только на ОДНУ
 * папку: `pos` присваивается при вставке (`MAX(pos)+1`, foldersrepo.go) и
 * переписывается только перестановкой (`Reorder`), которая едет отдельным
 * апдейтом `updateDialogFilterOrder` (`applyOrder` ниже). `Update` колонку
 * `pos` не трогает, `Delete` соседей не перенумеровывает. Значит мутация одной
 * папки не сдвигает `pos` у остальных, и локальная пересортировка по `pos, id`
 * даёт ровно тот же порядок, что и `List` (`ORDER BY pos, id`). Пропуски после
 * оффлайна закрывает догон апдейт-лога по `pts`.
 */
export function applyFolderUpdate(evt: FolderUpdateEvt): void {
  const prev = useAppStateStore.getState().folders
  if (evt.deleted) {
    if (evt.folder_id === undefined) return
    applyFolders(prev.filter((f) => f.id !== evt.folder_id))
    return
  }
  if (!evt.folder) return
  const incoming = mapFolder(evt.folder)
  applyFolders([...prev.filter((f) => f.id !== incoming.id), incoming])
}

/**
 * Порядок папок: `updateDialogFilterOrder` с другого устройства и свой
 * `messages.updateDialogFiltersOrder` (tweb `onUpdateDialogFilterOrder`,
 * `lib/storages/filters.ts:179-199`, :424-433). `order` — id папок, `0` —
 * «Все чаты». Перечисленные папки встают первыми в этом порядке, остальные —
 * следом в прежнем (так же их ставит сервер, `FoldersRepo.Reorder`); id,
 * которых клиент не знает, пропускаются. Место «Все чаты» — индекс `0` в
 * `order`; без `0` оно не меняется. Идемпотентно: эхо своего действия ничего
 * не перерисовывает и не пишет на диск.
 *
 * Архив tweb вставляет в порядок вторым (`:184-186`) — у нас архив не папка
 * (`core/folderIds.ts`), эта вставка не переносится.
 */
export function applyOrder(order: number[]): void {
  const prev = useAppStateStore.getState().folders
  const byId = new Map(prev.map((f) => [f.id, f]))
  const seq: Folder[] = []
  for (const id of order) {
    const f = byId.get(id)
    if (f) { seq.push(f); byId.delete(id) }
  }
  for (const f of prev) if (byId.has(f.id)) seq.push(f)
  const sorted = seq.map((f, pos) => (f.pos === pos ? f : { ...f, pos }))
  const r = reconcileById(prev, sorted, (f) => f.id)
  const allIdx = order.indexOf(ALL_FOLDER_ID)
  const allChanged = allIdx >= 0 && useAppStateStore.getState().allChatsPos !== allIdx
  // Одной записью: два прохода подписчиков (проекция папок пересчитывает
  // непрочитанное по всем диалогам) показали бы состояние наполовину.
  if (r.changed && allChanged) setAppStates({ folders: r.list, allChatsPos: allIdx })
  else if (r.changed) setAppState('folders', r.list)
  else if (allChanged) setAppState('allChatsPos', allIdx)
}

function applyAllChatsPos(pos: number): void {
  if (useAppStateStore.getState().allChatsPos !== pos) setAppState('allChatsPos', pos)
}

/** Текущий порядок в виде `order`: id папок, `0` («Все чаты») на сохранённом месте. */
function currentOrder(): number[] {
  const { folders, allChatsPos } = useAppStateStore.getState()
  const order = folders.map((f) => f.id)
  order.splice(Math.min(allChatsPos, order.length), 0, ALL_FOLDER_ID)
  return order
}

// ── Свои перестановки ───────────────────────────────────────────────────────
// tweb применяет порядок по успеху запроса (`filters.ts:424-433`) и двигает DOM
// вкладки сам. Список вкладки у нас рисуется из модели, поэтому порядок
// применяется сразу, а запросы идут ОДИН ЗА ДРУГИМ в порядке действий (параллельные
// POST могли бы лечь на сервер наоборот). Сервер шлёт кадр и сессии-автору; пока
// свои запросы в пути, кадры не применяются, а запоминается последний: кадры идут
// в порядке коммитов, и последний — итоговое состояние сервера (своё эхо или
// чужая перестановка). Когда очередь опустела, последний кадр применяется, если
// он не эхо своей перестановки. Остаточное окно: эхо приходит ПОЗЖЕ ответа (разные
// соединения) — строки на миг возвращаются к более раннему своему порядку, эхо
// последней перестановки сводит их обратно. Точное решение — pts ответа (бэклог).
let queue: Promise<void> = Promise.resolve()
let inflight = 0
/** Порядок, подтверждённый сервером (откат при отказе). */
let confirmed: number[] = []
let deferred: number[] | undefined
/** Свои порядки текущей пачки: устаревшее эхо своей же перестановки не применяется. */
const ownKeys = new Set<string>()

type OrderManagers = Parameters<typeof loadFolders>[0] & { folders: { updateOrder(order: number[]): Promise<void> } }

/** Своя перестановка: применить сразу и отправить в очередь. */
export function sendOrder(managers: OrderManagers, order: number[]): Promise<void> {
  if (inflight === 0) confirmed = currentOrder()
  applyOrder(order)
  const applied = currentOrder()
  ++inflight
  ownKeys.add(order.join(','))
  const run = queue
    .then(() => managers.folders.updateOrder(order))
    .then(() => { confirmed = applied }, async () => {
      // Откат к последнему подтверждённому порядку — без сети, затем сверка с
      // сервером. Если следом в очереди ждёт ещё перестановка, она сама
      // приведёт сервер к нужному порядку: откатывать под ней нечего.
      if (inflight > 1) return
      applyOrder(confirmed)
      await loadFolders(managers, { overwrite: true })
    })
    .finally(() => {
      if (--inflight > 0) return
      const last = deferred
      deferred = undefined
      // Эхо СВОЕЙ перестановки (не последней) пришло раньше ответа на последнюю:
      // применять его значило бы дёрнуть строки назад. Чужой кадр применяется.
      const echo = last && ownKeys.has(last.join(','))
      ownKeys.clear()
      if (last && !echo) applyOrder(last)
    })
  queue = run.catch(() => {})
  return run
}

/** Сбросить очередь — только для тестов. */
export function resetOrderQueue(): void {
  queue = Promise.resolve()
  inflight = 0
  confirmed = []
  deferred = undefined
  ownKeys.clear()
}

/** Кадр `updateDialogFilterOrder` с сервера (в том числе эхо своего действия). */
export function applyOrderFrame(order: number[] | null | undefined): void {
  const list = order ?? []
  if (inflight > 0) {
    deferred = list
    return
  }
  applyOrder(list)
}

/**
 * Единственный путь изменения списка папок. Реконсайл вместо подмены:
 * неизменившиеся папки сохраняют ссылки, а совпавший с памятью ответ не даёт ни
 * перерисовки, ни записи в IDB. Порядок — как у бэкенда: `ORDER BY pos, id`.
 */
function applyFolders(incoming: Folder[]): void {
  const prev = useAppStateStore.getState().folders
  const sorted = incoming.slice().sort((a, b) => a.pos - b.pos || a.id - b.id)
  const r = reconcileById(prev, sorted, (f) => f.id)
  if (r.changed) setAppState('folders', r.list)
}
