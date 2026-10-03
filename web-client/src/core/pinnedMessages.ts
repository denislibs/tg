// Закреплённые сообщения пира — порт закрепной части tweb `appMessagesManager`
// (812502980): `getPinnedMessage` `:6803-6825`, `getPinnedMessagesCount`/`MaxId`
// `:6830-6836`, `updatePinnedMessage` `:6838-6856`, `unpinAllMessages` `:6858-6890`,
// `hidePinnedMessages` `:6784-6794`, `resetPinnedMessagesCache` `:14290-14313`; ключ —
// tweb `utils/messages/getPinnedMessagesKey.ts`. Пачка П-5 волны 7 (Б-19).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Живёт на главном потоке, а не в менеджере воркера: у нашего бэкенда нет поиска с
//     фильтром `inputMessagesFilterPinned` (`offsetId`/`backLimit`/`offsetIdOffset`), есть
//     только весь список закрепов чата — `GET /chats/{id}/pins` (`managers.messages.listPins`).
//     Список кэшируется здесь целиком; страница «вокруг номера» (`getPinnedHistory`) режется
//     из него, поэтому её `count`/`offsetIdOffset` точные, а `loadedTop`/`loadedBottom`
//     плашки сводятся с первой же загрузки.
//  2. Сами сообщения закрепов лежат в этом кэше (`getPinnedMessageByMid`): закреп может быть
//     вне окна ленты, а хранилища сообщений пира, как `messagesStorage` tweb, на главном
//     потоке нет — окно (`messagesMirror`) держит только загруженную страницу.
//  3. Закрепы — на весь чат: `listPins` не знает темы форума, ключ с `threadId` различает
//     только скрытие плашки (`hiddenPinnedMessages`).
//  4. `unpinAllMessages` — открепление по одному (`DELETE …/pin` на каждый закреп):
//     ручки `messages.unpinAllMessages` у бэкенда нет. `silent`/`pm_oneside` закрепления
//     сервер не принимает — у `updatePinnedMessage` они без предмета.
//  5. Кадр `updatePinnedMessages` (`rt:pin_message`) переводится в `peer_pinned_messages`
//     здесь (`onPinnedMessagesUpdate`, зовёт `client/realtime/refetchSubscriber.ts`), а не в
//     воркере: кэш, который сбрасывает кадр, живёт на главном потоке (расхождение 1).
import rootScope from '@lib/rootScope'
import { setAppState, useAppStateStore } from '@stores/appState'
import { hasRightsPeer } from './peerCache'
import { isUser } from './peers/peerId'
import type { MyMessage } from './models'

export type PinnedMessagesManagers = {
  messages: {
    listPins(peerId: number): Promise<MyMessage[]>
    pin(peerId: number, msgId: number): Promise<void>
    unpin(peerId: number, msgId: number): Promise<void>
  }
}

/** tweb `appPeersManager.canPinMessage` (`appPeersManager.ts:38-40`) */
export function canPinMessage(peerId: PeerId) {
  return isUser(peerId) || hasRightsPeer(peerId, 'pin_messages')
}

/** tweb `getPinnedMessagesKey.ts` */
export function getPinnedMessagesKey(peerId: PeerId, threadId?: number) {
  return peerId + (threadId ? '_' + threadId : '')
}

type PinnedEntry = {
  promise?: Promise<PinnedEntry>,
  /** новейший закреп первым (tweb: история фильтра — по убыванию номера) */
  messages?: MyMessage[],
  maxId?: number,
  count?: number
}

const pinnedMessages: { [key: string]: PinnedEntry } = {}

function loadPinned(managers: PinnedMessagesManagers, peerId: PeerId, threadId?: number): Promise<PinnedEntry> {
  const p = pinnedMessages[getPinnedMessagesKey(peerId, threadId)] ??= {}
  if(p.promise) return p.promise
  else if(p.messages) return Promise.resolve(p)

  const promise = p.promise = managers.messages.listPins(peerId).then((messages) => {
    // сброшен кадром, пока шёл запрос, — ответ устарел, его место займёт новый запрос
    if(pinnedMessages[getPinnedMessagesKey(peerId, threadId)] !== p) {
      return loadPinned(managers, peerId, threadId)
    }

    p.messages = messages.slice().sort((a, b) => b.id - a.id)
    p.count = p.messages.length
    p.maxId = p.messages[0]?.id
    return p
  }).finally(() => {
    if(p.promise === promise) delete p.promise
  })

  return promise
}

/** tweb `getPinnedMessage` `:6803-6825` */
export function getPinnedMessage(managers: PinnedMessagesManagers, peerId: PeerId, threadId?: number): Promise<{ maxId?: number, count: number }> {
  return loadPinned(managers, peerId, threadId).then((p) => ({ maxId: p.maxId, count: p.count ?? 0 }))
}

/** tweb `:6830-6832` */
export function getPinnedMessagesCount(peerId: PeerId, threadId?: number) {
  return pinnedMessages[getPinnedMessagesKey(peerId, threadId)]?.count
}

/** tweb `:6834-6836` */
export function getPinnedMessagesMaxId(peerId: PeerId, threadId?: number) {
  return pinnedMessages[getPinnedMessagesKey(peerId, threadId)]?.maxId
}

/** Расхождение 2: сообщение закрепа из кэша списка. */
export function getPinnedMessageByMid(peerId: PeerId, mid: number, threadId?: number): MyMessage | undefined {
  return pinnedMessages[getPinnedMessagesKey(peerId, threadId)]?.messages?.find((message) => message.id === mid)
}

export type PinnedHistoryResult = {
  /** номера по убыванию, как `history` у tweb `getHistory` */
  history: number[],
  count: number,
  offsetIdOffset: number
}

/**
 * Страница закрепов вокруг `offsetId` — роль `appMessagesManager.getHistory({inputFilter:
 * {_: 'inputMessagesFilterPinned'}, offsetId, limit, backLimit, needRealOffsetIdOffset})`
 * (tweb `pinnedMessage.tsx:429-436`). Расхождение 1: режется из всего списка.
 * `offsetIdOffset` — сколько закрепов новее `offsetId` (смысл MTProto).
 */
export async function getPinnedHistory(managers: PinnedMessagesManagers, options: {
  peerId: PeerId,
  threadId?: number,
  offsetId: number,
  limit: number,
  backLimit?: number
}): Promise<PinnedHistoryResult> {
  const p = await loadPinned(managers, options.peerId, options.threadId)
  const mids = p.messages!.map((message) => message.id)
  // первый закреп не новее `offsetId` — с него идёт «старее», `backLimit` берёт новее него
  let index = options.offsetId ? mids.findIndex((mid) => mid <= options.offsetId) : 0
  if(index === -1) index = mids.length
  const start = Math.max(0, index - (options.backLimit ?? 0))
  return {
    history: mids.slice(start, index + options.limit),
    count: mids.length,
    offsetIdOffset: index,
  }
}

/** Закрепы как сообщения, новейший первым — страница экрана закрепов (`ChatType.Pinned`). */
export function getPinnedMessages(managers: PinnedMessagesManagers, peerId: PeerId, threadId?: number): Promise<MyMessage[]> {
  return loadPinned(managers, peerId, threadId).then((p) => p.messages!)
}

/** tweb `:6838-6856` — расхождение 4. */
export function updatePinnedMessage(managers: PinnedMessagesManagers, peerId: PeerId, mid: number, unpin?: boolean) {
  return unpin ? managers.messages.unpin(peerId, mid) : managers.messages.pin(peerId, mid)
}

/** tweb `:6858-6890` — расхождение 4. */
export async function unpinAllMessages(managers: PinnedMessagesManagers, peerId: PeerId, threadId?: number): Promise<boolean> {
  const messages = await getPinnedMessages(managers, peerId, threadId)
  await Promise.all(messages.map((message) => managers.messages.unpin(peerId, message.id).catch(() => {})))
  return true
}

/** tweb `:6784-6794` */
export async function hidePinnedMessages(managers: PinnedMessagesManagers, peerId: PeerId, threadId?: number) {
  const pinned = await getPinnedMessage(managers, peerId, threadId)
  const key = getPinnedMessagesKey(peerId, threadId)
  setAppState('hiddenPinnedMessages', { ...useAppStateStore.getState().hiddenPinnedMessages, [key]: pinned.maxId ?? 0 })
  rootScope.dispatchEventSingle('peer_pinned_hidden', { peerId, threadId, maxId: pinned.maxId ?? 0 })
}

/** Скрыта ли плашка закрепа пира пользователем (tweb `appState.hiddenPinnedMessages[key]`). */
export function isPinnedMessagesHidden(peerId: PeerId, threadId?: number) {
  return !!useAppStateStore.getState().hiddenPinnedMessages[getPinnedMessagesKey(peerId, threadId)]
}

/**
 * tweb `resetPinnedMessagesCache` `:14290-14313` — сброс кэша и скрытия плашки пира (все
 * ключи, включая тематические) и объявление `peer_pinned_messages`.
 */
export function onPinnedMessagesUpdate(peerId: PeerId, mids: number[], pinned: boolean) {
  for(const key in pinnedMessages) {
    if(+key === peerId || key.startsWith(peerId + '_')) {
      delete pinnedMessages[key]
    }
  }

  const hidden = useAppStateStore.getState().hiddenPinnedMessages
  const keys = Object.keys(hidden).filter((key) => +key === peerId || key.startsWith(peerId + '_'))
  if(keys.length) {
    const next = { ...hidden }
    keys.forEach((key) => delete next[key])
    setAppState('hiddenPinnedMessages', next)
  }

  rootScope.dispatchEventSingle('peer_pinned_messages', { peerId, mids, pinned })
}

/** Только для тестов. */
export function resetPinnedMessagesCache() {
  for(const key in pinnedMessages) delete pinnedMessages[key]
}
