// Зеркало непрочитанного ФОРУМОВ на главном потоке — для счётчиков папок,
// бейджа «назад» и бейджа приложения.
//
// У tweb непрочитанное форума в счётчиках — число непрочитанных тем, а не
// сообщений: `getDialogUnreadCount` (appMessagesManager.ts:14233-14250) берёт
// `dialogsStorage.getForumUnreadCount` (dialogs.ts:2229-2258), пока темы не
// загружены — ноль, и сам вызов запускает загрузку. Этим значением пользуются
// счётчики папок (`prepareFolderUnreadCountModifyingByDialog`, dialogs.ts:840-880).
//
// Расхождение: у tweb счётчики папок считает воркер (`dialogsStorage`), у нас —
// главный поток по зеркалу диалогов (`core/folders/folderUnreadCounts.ts`,
// расхождение 1). Поэтому значение хранилища тем воркера
// (`forumTopicsStorage.getForumUnreadCount`) приезжает сюда операцией
// `forumUnread` (`rt:forum_topic_op`), а для форума, о котором зеркало ещё не
// знает, вопрос задаётся владельцу один раз (у tweb — тем же вызовом).
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'
import { forumHasUnmuted, type ForumUnreadCount } from './forumTopic'
import type { Dialog } from '../models'
import { cachedChat } from '../peerCache'
import { isForum } from '../peers/predicates'

const counts = new Map<PeerId, ForumUnreadCount>()
const asked = new Set<PeerId>()
const listeners = new Set<() => void>()
let fetcher: ((peerId: PeerId) => Promise<ForumUnreadCount | undefined>) | undefined

function emit(): void {
  for (const listener of listeners) listener()
}

/** Значение владельца для форума (`undefined` — темы ещё не загружены). */
export function applyForumUnread(peerId: PeerId, unread: ForumUnreadCount | undefined): void {
  if (unread) counts.set(peerId, unread)
  else {
    // темы сброшены (форум выключили) — следующий вопрос снова к владельцу
    counts.delete(peerId)
    asked.delete(peerId)
  }
  emit()
}

/**
 * tweb `getForumUnreadCount` для счётчиков: число непрочитанных тем; не
 * загружено — `undefined` (счётчик берёт ноль), и владелец получает вопрос,
 * который запускает загрузку (ответ придёт операцией `forumUnread`).
 */
export function getForumUnread(peerId: PeerId): ForumUnreadCount | undefined {
  const value = counts.get(peerId)
  if (!value && fetcher && !asked.has(peerId)) {
    asked.add(peerId)
    void fetcher(peerId).then((unread) => { if (unread) applyForumUnread(peerId, unread) }).catch(() => asked.delete(peerId))
  }
  return value
}

/**
 * «Непрочитан и не заглушён» — членство в `unreadUnmutedPeerIds` папки «Все»
 * (tweb `dialogs.ts:840-880`, `:925-934`): у форума — есть непрочитанная тема
 * (`getDialogUnreadCount`, :14233-14250) и среди них незаглушённая
 * (`hasUnmuted`); у остальных — `unread_count` и мьют диалога (`dialogMuted`).
 */
export function isDialogUnreadUnmuted(dialog: Pick<Dialog, 'peerId' | 'unread_count'>, dialogMuted: () => boolean): boolean {
  if (isForum(cachedChat(dialog.peerId))) {
    const unread = getForumUnread(dialog.peerId)
    return !!unread?.count && forumHasUnmuted(unread, dialogMuted)
  }
  return !!dialog.unread_count && !dialogMuted()
}

export function subscribeForumUnread(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Смена сессии и тесты. */
export function resetForumUnreadMirror(): void {
  counts.clear()
  asked.clear()
  emit()
}

let registered = false

/** Подписка на операции хранилища тем — из `client/realtimeBridge.ts`. */
export function registerForumUnreadMirror(getForumUnreadCount: (peerId: PeerId) => Promise<ForumUnreadCount | undefined>): void {
  fetcher = getForumUnreadCount
  if (registered) return
  registered = true
  rootScope.addEventListener(RT.forumTopicOp, ({ ops }) => {
    for (const op of ops) {
      if (op.op === 'forumUnread') applyForumUnread(op.peerId, op.unread)
    }
  })
  rootScope.addEventListener(RT.loggingOut, resetForumUnreadMirror)
  rootScope.addEventListener(RT.loggedIn, resetForumUnreadMirror)
}
