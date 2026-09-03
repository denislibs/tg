// Хэш открытого чата — пишется НА МЕСТЕ, без записи истории браузера.
//
// Порт tweb/src/lib/appImManager.ts:2578-2597 (`overrideHash`, вызов из
// `selectTab`) и tweb/src/components/appNavigationController.ts:274-288/411-423
// (сам `overrideHash` → `replaceState`). Единственный писатель этого хэша:
// собственных `history.*` здесь нет — запись отдаётся
// `appNavigationController.overrideHash`, который её и переписывает поверх
// текущей записи (в отличие от `pushHashState`, у которого своя запись на
// каждый чат — ОСТАТОК #108, см. докблок `appNavigationController.pushHashState`).
//
// ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРЕЖНЕГО `useUrlSync.hashForState`: там открытый тред
// давал суффикс `_rootMsgId` — в оригинале такой ветки в хэше НЕТ ВООБЩЕ:
// `appImManager.ts:2597` пишет `this.chat?.peerId`, то есть пир ВЕРХНЕГО
// инстанса стека чатов и только его. Уход в тред (комментарии, форум-топик)
// меняет верхний инстанс — значит меняет и адресуемый пир, но без всякого
// намёка на ветку в самой строке хэша.
import { useChatStackStore, selectActive } from '../../stores/chatStackStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { cachedChat } from '../peerCache'
import appNavigationController from './appNavigationController'

/** Хэш открытого состояния БЕЗ ведущего `#`. '' — список чатов (стек пуст). */
export function hashForChat(): string {
  const active = selectActive(useChatStackStore.getState())
  if (!active) return ''

  // Черновик (диалога ещё нет, ничего не отправлено): в стеке уже лежит
  // настоящий числовой peerId — `navigationStore.selectChat` разворачивает
  // `draft:<id>` в `stack.setPeer` при открытии. Делиться этим числом нельзя:
  // после reload по нему нечего открывать, это не диалог. Пишем `@username`,
  // если он есть у собеседника, иначе не пишем вовсе — правило дословно из
  // прежнего `useUrlSync.hashForState`.
  const nav = useNavigationStore.getState()
  if (nav.selectedId?.startsWith('draft:')) {
    return nav.draftPeer?.username ? `@${nav.draftPeer.username}` : ''
  }

  // Публичный чат/канал/группа с username → #@username (шарибельно, как tweb);
  // иначе числовой id (у private-чатов username в диалоге нет). Правило
  // дословно из прежнего `useUrlSync.hashForState` (:36-42).
  const chat = cachedChat(active.peerId)
  return chat && chat._ === 'channel' && chat.username ? `@${chat.username}` : String(active.peerId)
}

/**
 * Посчитать хэш и отдать контроллеру навигации — он единственный, кто трогает
 * историю браузера. `overrideHash` переписывает текущую запись НА МЕСТЕ
 * (`replaceState`): смена чата не создаёт новую запись истории, Back между
 * чатами не ходит — ровно как в оригинале (снятие ОСТАТКА #108).
 */
export function syncChatHash(): void {
  appNavigationController.overrideHash(hashForChat())
}

/**
 * Подписка «стек чатов → хэш». `navigationStore.selectChat` — единственный
 * писатель `chatStackStore.setPeer`/`clear` при выборе чата из списка —
 * синхронно зеркалит его в стек, поэтому подписки на один стек достаточно:
 * она же ловит открытие/закрытие треда (`setInnerPeer`/`closeTop`), которые
 * стор трогают напрямую.
 *
 * Первый снимок НЕ синхронизируется здесь нарочно: на монтировании хэш из
 * адресной строки ещё не применён к стору (`useUrlSync` делает это
 * асинхронно — резолвит @username, дожидается диалогов). Досрочный вызов
 * увидел бы пустой стек и стёр бы входящий хэш до того, как он применится.
 * Как только применение допишет стек, эта же подписка отработает сама.
 *
 * Возвращает отписку — вызывающий обязан снять её при размонтировании.
 */
export function startChatHistory(): () => void {
  return useChatStackStore.subscribe(syncChatHash)
}
