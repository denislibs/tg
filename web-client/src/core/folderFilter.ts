// Попадает ли элемент в папку — порт tweb filters.testDialogForFilter
// (src/lib/storages/filters.ts:203): exclude-список → нет; include-список → да;
// без флагов типов → нет; затем exclude_read/exclude_muted и флаги типов.
//
// Структурный тип по фактически используемым полям: main-поток (Chat, вью-
// модель) и воркер (Dialog) оба удовлетворяют FolderMatchable через тонкие
// адаптеры на местах вызова — реализация правил папок ровно одна (см.
// folderFilter.test.ts), иначе один и тот же чат попадал бы в разные папки
// на разных экранах.
import type { Chat as ChatVM } from '../data'
import type { Dialog } from './models'
import type { Chat } from './peers/peer'
import { isAnyGroup, isBroadcast } from './peers/predicates'
import type { Folder } from './managers/foldersManager'
import { isPeerMuted } from './dialogs/notifySettings'

export type FolderMatchable = {
  peerId: PeerId
  /**
   * Вид чата — ДВА ПРЕДИКАТА, а не строка `type` (решение Р8 разбора диалогов).
   * Строку с провода сняли: в схеме вид выражают конструктор пира и флаги
   * `Chat`, а «супергруппа это канал или группа» из строки не выводилось вовсе —
   * вопрос задавали заново в каждом файле.
   */
  isGroup: boolean
  isBroadcast: boolean
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

  if (item.isBroadcast) return folder.broadcasts
  if (item.isGroup) return folder.groups
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
export function chatMatchesFolder(chat: ChatVM, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  const peerId = Number(chat.id)
  if (!Number.isFinite(peerId)) return false // draft-чаты в папки не попадают
  // Вью-модельный `ChatType` остаётся строкой (её ~80 сравнений не трогаются);
  // вид ВЫВЕДЕН один раз — в `dialogToChat`, здесь только перевод в предикаты.
  return matchesFolder(
    { peerId, isGroup: chat.type === 'group', isBroadcast: chat.type === 'channel', unread: chat.unread, muted: chat.muted },
    folder, contactIds,
  )
}

/**
 * Адаптер Dialog → FolderMatchable (воркер, `dialogsManager.getDialogs`).
 *
 * Второй аргумент — КАРТОЧКА ЧАТА (или `undefined` у приватного диалога и когда
 * её ещё нет): вид чата с провода снят, и отвечают на него те же предикаты, что
 * и везде (`core/peers/predicates.ts`). Заглушённость считается по СРОКУ —
 * `notify_settings.mute_until`, — а не по булеву полю строки; правило типов
 * чатов поверх этого накладывает витрина (`useDialogListSource`).
 */
export function dialogMatchesFolder(
  dialog: Dialog,
  chat: Chat | undefined,
  folder: Folder,
  contactIds: ReadonlySet<number>,
  muted = isPeerMuted(dialog.notify_settings, Math.floor(Date.now() / 1000)),
): boolean {
  return matchesFolder(
    {
      peerId: dialog.peerId,
      isGroup: isAnyGroup(dialog.peerId, chat),
      isBroadcast: isBroadcast(chat),
      unread: dialog.unread_count,
      muted,
    },
    folder, contactIds,
  )
}

// Счётчики для подзаголовка строки папки (tweb chatFolders.tsx:60-88):
// «N чатов», «N каналов», «N групп», соединённые « и ».
export function folderCounts(chats: ChatVM[], folder: Folder, contactIds: ReadonlySet<number>): { chats: number; channels: number; groups: number } {
  let c = 0, ch = 0, g = 0
  for (const chat of chats) {
    if (!chatMatchesFolder(chat, folder, contactIds)) continue
    if (chat.type === 'channel') ch++
    else if (chat.type === 'group') g++
    else c++
  }
  return { chats: c, channels: ch, groups: g }
}
