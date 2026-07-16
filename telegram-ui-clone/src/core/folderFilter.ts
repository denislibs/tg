// Попадает ли чат в папку — порт tweb filters.testDialogForFilter
// (src/lib/storages/filters.ts:203): exclude-список → нет; include-список → да;
// без флагов типов → нет; затем exclude_read/exclude_muted и флаги типов.
import type { Chat } from '../data'
import type { Folder } from './managers/foldersManager'

export function matchesFolder(chat: Chat, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  const chatId = Number(chat.id)
  if (!Number.isFinite(chatId)) return false // draft-чаты в папки не попадают

  if (folder.excludeChats.includes(chatId)) return false
  if (folder.includeChats.includes(chatId)) return true

  const hasTypeFlags = folder.contacts || folder.nonContacts || folder.groups || folder.broadcasts
  if (!hasTypeFlags) return false

  if (folder.excludeRead && !(chat.unread != null && chat.unread > 0)) return false
  if (folder.excludeMuted && chat.muted) return false

  if (chat.type === 'group') return folder.groups
  if (chat.type === 'channel') return folder.broadcasts
  // private/saved: по контактности (saved — собственный peer, не контакт)
  const isContact = chat.peerId != null && contactIds.has(chat.peerId)
  if (folder.nonContacts && !isContact) return true
  if (folder.contacts && isContact) return true
  return false
}

// Счётчики для подзаголовка строки папки (tweb chatFolders.tsx:60-88):
// «N чатов», «N каналов», «N групп», соединённые « и ».
export function folderCounts(chats: Chat[], folder: Folder, contactIds: ReadonlySet<number>): { chats: number; channels: number; groups: number } {
  let c = 0, ch = 0, g = 0
  for (const chat of chats) {
    if (!matchesFolder(chat, folder, contactIds)) continue
    if (chat.type === 'channel') ch++
    else if (chat.type === 'group') g++
    else c++
  }
  return { chats: c, channels: ch, groups: g }
}
