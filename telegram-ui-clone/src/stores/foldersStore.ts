// Папки чатов: определения с бэка + выбранная папка (таб) + set контактов
// для матчинга правил contacts/non_contacts (tweb useFolders).
import { create } from 'zustand'
import type { Folder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'

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
  try {
    st.setFolders(await managers.folders.list())
  } catch {
    /* оффлайн — табы просто не показываются */
  }
  try {
    st.setContacts((await managers.contacts.list()).map((c) => c.userId))
  } catch {
    /* без контактов правила contacts/non_contacts считают всех не-контактами */
  }
}
