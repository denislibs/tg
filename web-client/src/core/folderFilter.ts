// Попадает ли элемент в папку — порт tweb filters.testDialogForFilter
// (src/lib/storages/filters.ts:203): exclude-список → нет; include-список → да;
// без флагов типов → нет; затем exclude_read/exclude_muted и флаги типов.
//
// Структурный тип по фактически используемым полям: main-поток (Chat, вью-
// модель) и воркер (Dialog) оба удовлетворяют FolderMatchable через тонкие
// адаптеры на местах вызова — реализация правил папок ровно одна (см.
// folderFilter.test.ts), иначе один и тот же чат попадал бы в разные папки
// на разных экранах.
import type { Chat } from '../data'
import type { Dialog } from './models'
import type { Folder } from './managers/foldersManager'

export type FolderMatchable = {
  chatId: number
  type: string
  unread?: number | null
  muted?: boolean
  peerId?: number | null
}

export function matchesFolder(item: FolderMatchable, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  if (folder.excludeChats.includes(item.chatId)) return false
  if (folder.includeChats.includes(item.chatId)) return true

  const hasTypeFlags = folder.contacts || folder.nonContacts || folder.groups || folder.broadcasts
  if (!hasTypeFlags) return false

  if (folder.excludeRead && !(item.unread != null && item.unread > 0)) return false
  if (folder.excludeMuted && item.muted) return false

  if (item.type === 'group') return folder.groups
  if (item.type === 'channel') return folder.broadcasts
  // private/saved: по контактности (saved — собственный peer, не контакт)
  const isContact = item.peerId != null && contactIds.has(item.peerId)
  if (folder.nonContacts && !isContact) return true
  if (folder.contacts && isContact) return true
  return false
}

// Адаптер Chat → FolderMatchable (main-поток). Chat.id бывает нечисловым
// (draft-чаты) — эта проверка была первой строкой matchesFolder, теперь
// живёт только здесь: у Dialog.chatId (воркер) тип уже number, отбрасывать
// нечего, а общая функция про это ничего не знает.
export function chatMatchesFolder(chat: Chat, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  const chatId = Number(chat.id)
  if (!Number.isFinite(chatId)) return false // draft-чаты в папки не попадают
  return matchesFolder({ chatId, type: chat.type, unread: chat.unread, muted: chat.muted, peerId: chat.peerId }, folder, contactIds)
}

// Адаптер Dialog → FolderMatchable (воркер, dialogsManager.getDialogs).
//
// ЗВАТЬ `matchesFolder(dialog, …)` НАПРЯМУЮ НЕЛЬЗЯ: у `Dialog` нет плоского
// `peerId` — собеседник приватного чата лежит в `peer.id` (models.ts), — а поле
// `FolderMatchable.peerId` опционально, поэтому такой вызов пройдёт тайпчек
// МОЛЧА и ветка контактности всегда даст `isContact === false`: приватные чаты
// разъедутся по папкам «Контакты»/«Не контакты» между воркером и main. Маппинг
// тот же, что уже делает витрина — `core/dialogToChat.ts:117` (`peerId: d.peer?.id`).
export function dialogMatchesFolder(dialog: Dialog, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  return matchesFolder(
    { chatId: dialog.chatId, type: dialog.type, unread: dialog.unread, muted: dialog.muted, peerId: dialog.peer?.id },
    folder,
    contactIds,
  )
}

// Счётчики для подзаголовка строки папки (tweb chatFolders.tsx:60-88):
// «N чатов», «N каналов», «N групп», соединённые « и ».
export function folderCounts(chats: Chat[], folder: Folder, contactIds: ReadonlySet<number>): { chats: number; channels: number; groups: number } {
  let c = 0, ch = 0, g = 0
  for (const chat of chats) {
    if (!chatMatchesFolder(chat, folder, contactIds)) continue
    if (chat.type === 'channel') ch++
    else if (chat.type === 'group') g++
    else c++
  }
  return { chats: c, channels: ch, groups: g }
}
