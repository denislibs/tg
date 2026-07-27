// Папки чатов: определения с бэка + выбранная папка (таб) + set контактов
// для матчинга правил contacts/non_contacts (tweb useFolders).
import { create } from 'zustand'
import type { Folder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'
import { saveFolders as savePersistedFolders, loadFolders as loadPersistedFolders } from '../core/store/persist'

// id псевдо-папки «Все чаты» (tweb FOLDER_ID_ALL)
export const ALL_FOLDER_ID = 0

interface FoldersState {
  folders: Folder[]
  selectedId: number // ALL_FOLDER_ID = «Все чаты»
  contactIds: Set<number>
  loaded: boolean
  setFolders: (f: Folder[]) => void
  select: (id: number) => void
  upsert: (f: Folder) => void
  remove: (id: number) => void
  setContacts: (ids: number[]) => void
}

export const useFoldersStore = create<FoldersState>((set) => ({
  folders: [],
  selectedId: ALL_FOLDER_ID,
  contactIds: new Set(),
  loaded: false,
  setFolders: (folders) => set({ folders, loaded: true }),
  select: (selectedId) => set({ selectedId }),
  upsert: (f) =>
    set((s) => {
      const idx = s.folders.findIndex((x) => x.id === f.id)
      const folders = s.folders.slice()
      if (idx === -1) folders.push(f)
      else folders[idx] = f
      return { folders }
    }),
  remove: (id) =>
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? ALL_FOLDER_ID : s.selectedId,
    })),
  setContacts: (ids) => set({ contactIds: new Set(ids) }),
}))

export async function loadFolders(managers: {
  folders: { list(): Promise<Folder[]> }
  contacts: { list(): Promise<Contact[]> }
}): Promise<void> {
  const st = useFoldersStore.getState()
  // offline-first: показать персистнутые папки сразу (табы слева не пропадают
  // офлайн), сеть реконсайлит поверх. Пре-гидрация только при пустом сторе.
  if (!st.loaded) {
    const cached = await loadPersistedFolders()
    if (cached.length) st.setFolders(cached)
  }
  try {
    st.setFolders(await managers.folders.list())
  } catch {
    /* оффлайн — остаёмся на персистнутых папках */
  }
  try {
    st.setContacts((await managers.contacts.list()).map((c) => c.userId))
  } catch {
    /* без контактов правила contacts/non_contacts считают всех не-контактами */
  }
}

// Подписка на стор: дебаунсом персистит папки (загрузка + мутации upsert/remove),
// чтобы следующий старт/офлайн показал табы мгновенно. Вызывать один раз.
export function startFoldersPersist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = useFoldersStore.getState().folders
  useFoldersStore.subscribe((s) => {
    if (s.folders === last) return
    last = s.folders
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (useFoldersStore.getState().loaded) void savePersistedFolders(useFoldersStore.getState().folders)
    }, 800)
  })
}
