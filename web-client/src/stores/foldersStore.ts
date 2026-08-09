// Папки чатов. Сами определения папок живут в State (tweb `filtersArr`) —
// читаются с диска одним батчем на старте (client/boot.ts), поэтому табы есть
// уже в первом кадре. Здесь остаётся только UI-состояние, которое в tweb тоже
// не персистится: выбранный таб и set контактов для правил contacts/non_contacts.
import { create } from 'zustand'
import type { Folder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'
import { useAppStateKey, useAppStateStore, setAppState } from './appState'

// id псевдо-папки «Все чаты» (tweb FOLDER_ID_ALL)
export const ALL_FOLDER_ID = 0

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
  upsert: (f) => {
    const folders = useAppStateStore.getState().folders.slice()
    const idx = folders.findIndex((x) => x.id === f.id)
    if (idx === -1) folders.push(f)
    else folders[idx] = f
    setAppState('folders', folders)
  },
  remove: (id) => {
    setAppState('folders', useAppStateStore.getState().folders.filter((f) => f.id !== id))
    set((s) => (s.selectedId === id ? { selectedId: ALL_FOLDER_ID } : s))
  },
}))

/** Реактивное чтение папок — единственный способ их получить в UI. */
export function useFolders(): Folder[] {
  return useAppStateKey('folders')
}

export async function loadFolders(managers: {
  folders: { list(): Promise<Folder[]> }
  contacts: { list(): Promise<Contact[]> }
}): Promise<void> {
  // Персист тут больше НЕ читаем: State уже поднят в boot.ts до рендера.
  // Остаётся только реконсайл поверх свежими данными сети.
  try {
    setAppState('folders', await managers.folders.list())
  } catch {
    /* оффлайн — остаёмся на том, что подняли из State */
  }
  try {
    useFoldersStore.getState().setContacts((await managers.contacts.list()).map((c) => c.userId))
  } catch {
    /* без контактов правила contacts/non_contacts считают всех не-контактами */
  }
}
