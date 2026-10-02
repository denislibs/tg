// Попадает ли элемент в папку — порт tweb filters.testDialogForFilter
// (src/lib/storages/filters.ts:203-270): exclude-список → нет; include-список →
// да; затем exclude_read/exclude_muted и флаги типов: у чата — broadcasts/groups,
// у пользователя — сначала bots (бот решается ТОЛЬКО им), потом
// non_contacts/contacts. Ни один флаг не сработал — нет.
//
// Структурный тип по фактически используемым полям: main-поток (Chat, вью-
// модель) и воркер (Dialog) оба удовлетворяют FolderMatchable через тонкие
// адаптеры на местах вызова — реализация правил папок ровно одна (см.
// folderFilter.test.ts), иначе один и тот же чат попадал бы в разные папки
// на разных экранах.
import type { Chat as ChatVM } from '../data'
import type { Dialog } from './models'
import type { Chat, User } from './peers/peer'
import { isAnyGroup, isBot, isBroadcast } from './peers/predicates'
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
  /** Собеседник — бот (`appUsersManager.isBot`); у чата всегда `false`. */
  isBot?: boolean
  unread?: number | null
  /** Непрочитанные упоминания — исключение из правила `excludeMuted`. */
  unreadMentions?: number | null
  muted?: boolean
}

export function matchesFolder(item: FolderMatchable, folder: Folder, contactIds: ReadonlySet<number>): boolean {
  if (folder.excludeChats.includes(item.peerId)) return false
  if (folder.includeChats.includes(item.peerId)) return true

  if (folder.excludeRead && !(item.unread != null && item.unread > 0)) return false
  // tweb :240 — заглушённый с непрочитанным упоминанием из папки не выпадает.
  if (folder.excludeMuted && item.muted && !(item.unreadMentions && item.unread)) return false

  if (item.isBroadcast) return folder.broadcasts
  if (item.isGroup) return folder.groups
  // tweb :258-261 — бот решается ТОЛЬКО флагом bots, контактность его не берёт.
  if (item.isBot) return folder.bots
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
    {
      peerId, isGroup: chat.type === 'group', isBroadcast: chat.type === 'channel', isBot: !!chat.isBot,
      unread: chat.unread, unreadMentions: chat.unreadMentions, muted: chat.muted,
    },
    folder, contactIds,
  )
}

/**
 * Адаптер Dialog → FolderMatchable (воркер, `dialogsManager.getDialogs`).
 *
 * Второй аргумент — КАРТОЧКА ПИРА из кэша (`cachedPeer`; `undefined`, пока её
 * нет): вид чата с провода снят, и отвечают на него те же предикаты, что и
 * везде (`core/peers/predicates.ts`); у пользователя из неё читается `bot`. Заглушённость считается по СРОКУ —
 * `notify_settings.mute_until`, — а не по булеву полю строки; правило типов
 * чатов поверх этого накладывает список папки (`components/autonomousDialogList/dialogs.ts::testDialogForFilter`).
 */
export function dialogMatchesFolder(
  dialog: Dialog,
  peer: User | Chat | undefined,
  folder: Folder,
  contactIds: ReadonlySet<number>,
  muted = isPeerMuted(dialog.notify_settings, Math.floor(Date.now() / 1000)),
): boolean {
  const chat = peer && peer._ !== 'user' && peer._ !== 'userEmpty' ? peer : undefined
  return matchesFolder(
    {
      peerId: dialog.peerId,
      isGroup: isAnyGroup(dialog.peerId, chat),
      isBroadcast: isBroadcast(chat),
      isBot: isBot(peer),
      unread: dialog.unread_count,
      unreadMentions: dialog.unread_mentions_count,
      muted,
    },
    folder, contactIds,
  )
}
