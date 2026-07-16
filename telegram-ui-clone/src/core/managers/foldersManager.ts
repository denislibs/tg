import type { RestClient } from '../net/restClient'

// Папка чатов (tweb DialogFilter): флаги типов + точечные include/exclude
// списки chat_id. Сопоставление диалога папке — core/folderFilter.ts.
export interface Folder {
  id: number
  title: string
  pos: number
  contacts: boolean
  nonContacts: boolean
  groups: boolean
  broadcasts: boolean
  excludeMuted: boolean
  excludeRead: boolean
  includeChats: number[]
  excludeChats: number[]
}

export type FolderInput = Omit<Folder, 'id' | 'pos'>

interface RawFolder {
  id: number
  title: string
  pos: number
  contacts: boolean
  non_contacts: boolean
  groups: boolean
  broadcasts: boolean
  bots: boolean
  exclude_muted: boolean
  exclude_read: boolean
  include_chats: number[]
  exclude_chats: number[]
}

const mapFolder = (r: RawFolder): Folder => ({
  id: r.id,
  title: r.title,
  pos: r.pos,
  contacts: r.contacts,
  nonContacts: r.non_contacts,
  groups: r.groups,
  broadcasts: r.broadcasts,
  excludeMuted: r.exclude_muted,
  excludeRead: r.exclude_read,
  includeChats: r.include_chats ?? [],
  excludeChats: r.exclude_chats ?? [],
})

const toRaw = (f: FolderInput) => ({
  title: f.title,
  contacts: f.contacts,
  non_contacts: f.nonContacts,
  groups: f.groups,
  broadcasts: f.broadcasts,
  bots: false,
  exclude_muted: f.excludeMuted,
  exclude_read: f.excludeRead,
  include_chats: f.includeChats,
  exclude_chats: f.excludeChats,
})

export function newFoldersManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'put' | 'del'> }) {
  return {
    async list(): Promise<Folder[]> {
      const r = await rest.get<{ folders: RawFolder[] }>('/me/folders')
      return (r.folders ?? []).map(mapFolder)
    },
    async create(f: FolderInput): Promise<Folder> {
      return mapFolder(await rest.post<RawFolder>('/me/folders', toRaw(f)))
    },
    async update(id: number, f: FolderInput): Promise<Folder> {
      return mapFolder(await rest.put<RawFolder>(`/me/folders/${id}`, toRaw(f)))
    },
    async del(id: number): Promise<void> {
      await rest.del(`/me/folders/${id}`)
    },
  }
}

export type FoldersManager = ReturnType<typeof newFoldersManager>
