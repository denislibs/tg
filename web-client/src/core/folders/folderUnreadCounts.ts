/**
 * Счётчик непрочитанного по папкам — порт правила tweb
 * `src/stores/folders.ts:19-30` (`getNotificationCountForFilter`) и того, из
 * чего его собирает воркер оригинала: `lib/storages/dialogs.ts:482-489`
 * (`getFolderUnreadCount` — размеры трёх множеств папки) и `:731-760`
 * (`prepareFolderUnreadCountModifyingByDialog` — кто в какое множество попадает).
 *
 * Правило оригинала на одну папку:
 *   unreadCount         — чатов с непрочитанным (`getDialogUnreadCount` ≠ 0);
 *   unreadUnmutedCount  — из них незамьюченных (`isDialogUnmuted`, `:474-480`,
 *                         `respectType: true` — с глобальным мьютом типа);
 *   unreadMentionsCount — из них с непрочитанным упоминанием;
 *   count = «Все чаты» ? unreadUnmutedCount : unreadCount            (`:27`)
 *   muted = !unreadUnmutedCount && !!unreadCount && !unreadMentionsCount (`:28`)
 *
 * Одна чистая функция на оба ряда — горизонтальный (`stores/folders.solid.ts`)
 * и вертикальную колонку (`sidebarLeft/foldersSidebarContent`, через ту же проекцию);
 * второго вывода того же счётчика быть не должно.
 *
 * Расхождения с оригиналом:
 *  1. Считает главный поток по зеркалу диалогов (`useChatsStore.dialogs`), а не
 *     воркер по своему хранилищу: папочного `getFolderUnreadCount` в
 *     `dialogsManager` нет. Следствие — в счёт входят только диалоги, которые
 *     уже в зеркале (загруженные страницы). Отложенная задача 16 плана
 *     `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
 *  2. «Непрочитан» — `getDialogUnreadCount` (`appMessagesManager.ts:14233-14250`):
 *     `unread_count > 0`, у форума — число непрочитанных ТЕМ (`getForumUnreadCount`,
 *     темы не загружены — ноль); значение хранилища тем воркера приезжает
 *     зеркалом `core/dialogs/forumUnreadMirror.ts`, параметр `forumUnreadOf`.
 *     Упоминания форума считаются, только пока непрочитанные темы есть
 *     (`wasUnreadMentionsCount = wasUnreadCount ? … : 0`, `dialogs.ts:848-852`).
 *     Флага `unread_mark` на нашем проводе нет (`core/models.ts::RawDialog`).
 *  3. Принадлежность папке — та же, что у её списка
 *     (`components/autonomousDialogList/dialogs.ts::testDialogForFilter`,
 *     воркерный `dialogsManager.forFilter`): архив не входит ни в «Все чаты», ни
 *     в пользовательскую папку. У оригинала пользовательская папка может
 *     включать архив (флаг `exclude_archived` фильтра) — у нашей `Folder` такого
 *     флага нет, и счётчик обязан совпадать со списком, который он подписывает.
 *  4. Сохранённые диалоги (`isSavedDialog`, `:732-738`) не исключаются — таких
 *     диалогов (`savedDialog`) у нас нет.
 */
import { isDialogArchived, type Dialog } from '../models'
import type { Folder } from '../managers/foldersManager'
import type { NotifySettings } from '../managers/notifyManager'
import type { Chat, User } from '../peers/peer'
import { dialogMatchesFolder } from '../folderFilter'
import { isDialogMuted } from '../../stores/notifyStore'
import { ALL_FOLDER_ID } from '../folderIds'
import { isForum } from '../peers/predicates'

/** `StoredFolder.notifications` оригинала (`stores/folders.ts:11-14`). */
export interface FolderNotifications {
  count: number
  muted: boolean
}

/** Три множества папки оригинала (`dialogs.ts:60-62`) — здесь их размеры. */
interface FolderUnread {
  unread: number
  unreadUnmuted: number
  unreadMentions: number
}

/**
 * @param dialogs    зеркало диалогов главного потока
 * @param folders    пользовательские папки (`appState.folders`); «Все чаты» —
 *                   всегда, отдельной записью под `ALL_FOLDER_ID`
 * @param contactIds контакты — правилам `contacts`/`non_contacts`
 * @param notifySettings глобальные настройки по типам — правилу «замьючен»
 * @param peerOf     карточка пира из зеркала пиров (`core/peerCache.ts::cachedPeer`):
 *                   нужна правилу типов папки (группа/канал/бот) и правилу мьюта типа
 * @param forumUnreadOf число непрочитанных тем форума (`undefined` — не загружены)
 * @returns запись на «Все чаты» и на каждую папку, в том числе с нулём
 */
export function folderUnreadCounts(
  dialogs: readonly Dialog[],
  folders: readonly Folder[],
  contactIds: ReadonlySet<number>,
  notifySettings: NotifySettings,
  peerOf: (peerId: PeerId) => User | Chat | undefined,
  now = Math.floor(Date.now() / 1000),
  forumUnreadOf: (peerId: PeerId) => number | undefined = () => undefined,
): Record<number, FolderNotifications> {
  const acc = new Map<number, FolderUnread>()
  const empty = (): FolderUnread => ({ unread: 0, unreadUnmuted: 0, unreadMentions: 0 })
  acc.set(ALL_FOLDER_ID, empty())
  for (const folder of folders) acc.set(folder.id, empty())

  for (const dialog of dialogs) {
    if (isDialogArchived(dialog)) continue
    const peer = peerOf(dialog.peerId)
    const chat = peer && peer._ !== 'user' && peer._ !== 'userEmpty' ? peer : undefined
    if (!(dialogUnreadCount(dialog, chat, forumUnreadOf) > 0)) continue
    const muted = isDialogMuted(dialog, chat, notifySettings, now)
    const mention = dialog.unread_mentions_count > 0
    const add = (id: number) => {
      const it = acc.get(id)!
      ++it.unread
      if (!muted) ++it.unreadUnmuted
      if (mention) ++it.unreadMentions
    }

    add(ALL_FOLDER_ID)
    for (const folder of folders) {
      if (dialogMatchesFolder(dialog, peer, folder, contactIds, muted)) add(folder.id)
    }
  }

  const out: Record<number, FolderNotifications> = {}
  for (const [id, it] of acc) {
    out[id] = {
      count: id === ALL_FOLDER_ID ? it.unreadUnmuted : it.unread,
      muted: !it.unreadUnmuted && !!it.unread && !it.unreadMentions,
    }
  }
  return out
}

/**
 * tweb `getDialogUnreadCount` (`appMessagesManager.ts:14233-14250`): у форума —
 * число непрочитанных тем (`view_forum_as_messages` у нас нет), иначе
 * `unread_count`.
 */
export function dialogUnreadCount(
  dialog: Pick<Dialog, 'peerId' | 'unread_count'>,
  chat: Chat | undefined,
  forumUnreadOf: (peerId: PeerId) => number | undefined,
): number {
  return isForum(chat) ? forumUnreadOf(dialog.peerId) ?? 0 : dialog.unread_count
}

/**
 * `getFolderUnreadCount(FOLDER_ID_ARCHIVE, true).unreadCount` оригинала — чатов
 * архива с непрочитанным. Читают строка «Архив» (`archiveDialog.tsx:300-326`) и
 * бейдж пункта «Архив» бургера (`sidebarLeft/index.ts:230-247`). Расхождения 1 и 2
 * выше — те же: только диалоги зеркала, «непрочитан» = `unread_count > 0`.
 */
export function archiveUnreadCount(dialogs: readonly Dialog[]): number {
  let count = 0
  for (const dialog of dialogs) {
    if (isDialogArchived(dialog) && dialog.unread_count > 0) ++count
  }
  return count
}
