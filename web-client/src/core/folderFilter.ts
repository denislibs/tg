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
  peerId: PeerId
  type: string
  unread?: number | null
  muted?: boolean
}

export function matchesFolder(item: FolderMatchable, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  if (folder.excludeChats.includes(item.peerId)) return false
  if (folder.includeChats.includes(item.peerId)) return true

  const hasTypeFlags = folder.contacts || folder.nonContacts || folder.groups || folder.broadcasts
  if (!hasTypeFlags) return false

  if (folder.excludeRead && !(item.unread != null && item.unread > 0)) return false
  if (folder.excludeMuted && item.muted) return false

  if (item.type === 'group') return folder.groups
  if (item.type === 'channel') return folder.broadcasts
  // private/saved: по контактности. Отдельного поля «собеседник» здесь больше
  // НЕТ и быть не может: ключ приватного диалога И ЕСТЬ id собеседника
  // (`core/peers/peerId.ts`) — прежняя пара `chatId` + `peerId` описывала одно
  // и то же двумя числами, и ветка контактности молча ломалась, когда второе
  // забывали передать. «Избранное» — собственный ключ зрителя, в контактах его
  // нет, и ветка отрабатывает сама.
  const isContact = contactIds.has(item.peerId)
  if (folder.nonContacts && !isContact) return true
  if (folder.contacts && isContact) return true
  return false
}

// Адаптер Chat → FolderMatchable (main-поток). Chat.id бывает нечисловым
// (draft-чаты) — эта проверка была первой строкой matchesFolder, теперь
// живёт только здесь: у Dialog.peerId (воркер) тип уже number, отбрасывать
// нечего, а общая функция про это ничего не знает.
export function chatMatchesFolder(chat: Chat, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  const peerId = Number(chat.id)
  if (!Number.isFinite(peerId)) return false // draft-чаты в папки не попадают
  return matchesFolder({ peerId, type: chat.type, unread: chat.unread, muted: chat.muted }, folder, contactIds)
}

// Адаптер Dialog → FolderMatchable (воркер, dialogsManager.getDialogs).
//
// Прежде здесь стояло предупреждение «звать matchesFolder(dialog, …) напрямую
// нельзя»: у `Dialog` не было плоского `peerId`, собеседник лежал в `peer.id`,
// и забытое поле молча выключало ветку контактности — приватные чаты
// разъезжались по папкам «Контакты»/«Не контакты» между воркером и main.
// Ловушки больше нет: ключ диалога и id собеседника — ОДНО число.
export function dialogMatchesFolder(dialog: Dialog, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  return matchesFolder(dialog, folder, contactIds)
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
