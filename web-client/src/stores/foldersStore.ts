// Папки чатов. Сами определения папок живут в State (tweb `filtersArr`) —
// читаются с диска одним батчем на старте (client/boot.ts), поэтому табы есть
// уже в первом кадре. Здесь остаётся только UI-состояние, которое в tweb тоже
// не персистится: выбранный таб и set контактов для правил contacts/non_contacts.
import { create } from 'zustand'
import { mapFolder, type Folder, type RawFolder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'
import { reconcileById } from '../core/store/reconcile'
import { useAppStateKey, useAppStateStore, setAppState } from './appState'
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
  remove: (id) => {
    applyFolders(useAppStateStore.getState().folders.filter((f) => f.id !== id))
    deselectIfRemoved(id)
  },
}))

/**
 * Удалённая папка не может остаться выбранной — выбор уезжает на «Все чаты».
 *
 * Правило ОДНО на оба пути удаления: локальный `remove` (своё действие) и
 * `applyFolderUpdate` (пуш `folder_update {deleted}` с другого устройства). Пока
 * второй путь его не соблюдал, у показанного списка чатов пропадал таб, но
 * оставался `selectedId`: витрина рисовала папку, которой уже нет в `order`.
 */
function deselectIfRemoved(id: number): void {
  useFoldersStore.setState((s) => (s.selectedId === id ? { selectedId: ALL_FOLDER_ID } : s))
}

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
    folders: { list(): Promise<Folder[]> }
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
      applyFolders(await managers.folders.list())
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
 * папку: `pos` присваивается один раз при вставке (`MAX(pos)+1`,
 * foldersrepo.go:72) и больше не переписывается — `Update` колонку `pos` не
 * трогает (foldersrepo.go:82), `Delete` соседей не перенумеровывает
 * (foldersrepo.go:96), эндпоинта переупорядочивания нет вовсе. Значит мутация
 * одной папки не сдвигает `pos` у остальных, и локальная пересортировка по
 * `pos, id` даёт ровно тот же порядок, что и `List` (`ORDER BY pos, id`,
 * foldersrepo.go:51). Пропуски после оффлайна закрывает догон апдейт-лога по
 * `pts` (folders.go:116).
 */
export function applyFolderUpdate(evt: FolderUpdateEvt): void {
  const prev = useAppStateStore.getState().folders
  if (evt.deleted) {
    if (evt.folder_id === undefined) return
    applyFolders(prev.filter((f) => f.id !== evt.folder_id))
    deselectIfRemoved(evt.folder_id)
    return
  }
  if (!evt.folder) return
  const incoming = mapFolder(evt.folder)
  applyFolders([...prev.filter((f) => f.id !== incoming.id), incoming])
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
