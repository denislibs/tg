/**
 * Порт tweb `src/stores/fullPeers.ts` — реактивное чтение ПОЛНОЙ карточки пира
 * для Solid (Task 1, волна 3 / этап 2). См. докблок `peers.solid.ts` для общей
 * механики моста к нереактивному зеркалу — здесь та же идея, применённая к
 * ПОЛНОЙ форме.
 *
 * ── Что у нас является «полным пиром» (`PeerFull`) ──────────────────────────
 * Ответ на вопрос из плана «своего предмета нет»: предмет ЕСТЬ, он уже собран
 * и лежит в `core/chatFullCache.ts` — `type PeerFull = ChannelFull | UserFull`,
 * дословное совпадение с tweb `type PeerFull = ChatFull | UserFull`
 * (`stores/fullPeers.ts:8`). Он появился раньше этой задачи как побочный
 * продукт `useChatInfoCard`/`useShellTheme` (тема оформления чата читается из
 * ТОЙ ЖЕ полной карточки), и заполняют его сегодня ДВА разных React-хука:
 *   • группа/канал — `useChatInfoCard.ts` → `managers.groups.card(peerId)` → `.fullChat`;
 *   • пользователь — `Chat.tsx`/`useUserProfileData.ts` → `managers.privacy.profile(peerId)` → `.fullUser`.
 * `requestFullPeer` ниже — ОДНА функция вместо этих двух копий: порт
 * `appProfileManager.getProfileByPeerId`, которая точно так же ветвится по
 * `isUser(peerId)` между `usersManager.getFullUser`/`chatsManager.getFullChat`
 * (appProfileManager.ts:520-545). Второго кэша при этом не заводится —
 * `saveChatFull` пишет в ТО ЖЕ зеркало, каким уже пользуются оба React-хука и
 * колонка чата.
 *
 * ── TTL — портирован дословно, инвалидация по пушу — НЕТ ПРЕДМЕТА ──────────
 * `PEER_FULL_TTL = 3 * 60e3` (`tweb/src/lib/appManagers/constants.ts:35`) и
 * пара «таймаут до истечения + интервал на весь TTL» (`fullPeers.ts:36-43`)
 * портированы как есть — это чистая клиентская политика, бэкенда не касается.
 *
 * Событийная инвалидация оригинала (`peer_full_update`, appProfileManager.ts:104-127)
 * — ДРУГОЕ дело. У tweb её взводит ЛЕСТНИЦА серверных пушей уровня MTProto:
 * `updateChatParticipants`/`updateChatParticipantAdd/Delete/Admin`,
 * `updatePeerBlocked`, точечное сравнение фото в `chat_update`,
 * `channel_update`, и — главное — конструкторы `updateChatFull`/`updateUserFull`
 * приезжают ЦЕЛИКОМ новой полной карточкой. Наш бэкенд ничего из этого не
 * шлёт: `rt:chat_update`/`rt:user_update` несут КРАТКУЮ форму (см. `RT.chatUpdate`
 * в `core/realtime/events.ts`), выделенного push-события «полная карточка
 * изменилась» на проводе нет вовсе. Подделывать инвалидацию под эти кадры
 * (например, дёргать refresh на каждый `chat_update`) значило бы придумать
 * предмет, которого нет, — план прямо запрещает так делать («скажи, не
 * выдумывай»). Портирован только `refreshFullPeer` — публичный ручной сброс
 * оригинала (appProfileManager.ts:770-782, есть у него САМОГО, отдельно от
 * пуш-слушателей — им пользуются мутации после СВОЕГО действия, например
 * `invalidateChannelParticipants`): им может воспользоваться Task 2+ после
 * мутации профиля (редактирование чата, блокировка), когда до неё дойдёт
 * дело. Мгновенная реакция на ЧУЖУЮ (не свою) мутацию профиля остаётся
 * известным разрывом с оригиналом до TTL (максимум 3 минуты) — тем же
 * разрывом, на который и в оригинале падает `peer_full_update`, если пуш
 * потерян: TTL там backstop, а не единственный путь; у нас он единственный.
 *
 * `getCachedFullPeer` оригинала (`fullPeers.ts:60-63`, синхронное чтение без
 * подписки) не портирован отдельной функцией — эту роль уже играет
 * `core/chatFullCache.ts::cachedPeerFull`, и она же и есть геттер, которым
 * пользуется зеркало здесь; заводить второй экспорт с тем же телом было бы
 * дублированием, которое запрещает DoD-пункт 6.
 */
import { onCleanup, type Accessor } from 'solid-js'
import { startClient } from '../client/bootstrap'
import { subscribeExternal } from '../helpers/solid/subscribeExternal'
import useDynamicCachedValue from '../helpers/solid/useDynamicCachedValue'
import {
  cachedPeerFull,
  saveChatFull,
  subscribeChatFullMirror,
  chatFullMirrorVersion,
  type PeerFull,
} from '../core/chatFullCache'
import { isUser } from '../core/peers/peerId'

/** Порт `tweb/src/lib/appManagers/constants.ts:35` — чистая клиентская
 *  политика (когда считать полную карточку протухшей), бэкенда не касается. */
export const PEER_FULL_TTL = 3 * 60_000

const expirations = new Map<PeerId, number>()

/** Порт `appProfileManager.getProfileByPeerId` — одна точка входа вместо
 *  прежних двух копий (`useChatInfoCard`/`Chat.tsx`). `overwrite === false` —
 *  «принеси, если там пусто, но не обновляй TTL» (оригинал: тот же признак,
 *  `fullPeers.ts:18`, используется для мягкой первой догрузки без сброса
 *  расписания, которое, возможно, уже тикает у другого потребителя того же
 *  peerId под `useDynamicCachedValue`). */
async function requestFullPeer(peerId: PeerId, overwrite: boolean): Promise<void> {
  const managers = startClient().managers
  const full: PeerFull | null = isUser(peerId)
    ? (await managers.privacy.profile(peerId)).fullUser
    : (await managers.groups.card(peerId))?.fullChat ?? null

  if (!full) return
  if (overwrite) expirations.set(peerId, Date.now() + PEER_FULL_TTL)
  saveChatFull(peerId, full)
}

/** Порт `appProfileManager.refreshFullPeer` — ручной сброс для мутаций
 *  собственного действия (Task 2+: редактирование чата, блокировка). Не
 *  вызывается автоматически ниоткуда в этом файле — см. докблок файла про
 *  отсутствие пуш-инвалидации. */
export function refreshFullPeer(peerId: PeerId): void {
  expirations.delete(peerId)
  void requestFullPeer(peerId, true)
}

function _useFullPeer(peerId: PeerId): Accessor<PeerFull | undefined> {
  const version = subscribeExternal(subscribeChatFullMirror, chatFullMirrorVersion)

  const expiration = expirations.get(peerId)
  if (!expiration || cachedPeerFull(peerId) === undefined) {
    void requestFullPeer(peerId, false)
  }

  const delay = (expiration || 0) - Date.now()
  const timeout = delay > 0 ? setTimeout(() => void requestFullPeer(peerId, true), delay) : 0
  const interval = setInterval(() => void requestFullPeer(peerId, true), PEER_FULL_TTL)

  onCleanup(() => {
    clearInterval(interval)
    clearTimeout(timeout)
  })

  return () => {
    version()
    return cachedPeerFull(peerId)
  }
}

/**
 * Реактивная полная карточка пира — возвращает Accessor (порт `fullPeers.ts:53-58`,
 * ОДИН вызов `()`, а не два: снимает внешний слой `useDynamicCachedValue`, но не
 * внутренний — вызывающий читает актуальное значение сам, `useFullPeer(id)()`,
 * как обычный Solid-сигнал в JSX). Один общий таймер TTL на peerId
 * (`useDynamicCachedValue`) — несколько мест дерева, читающих одного и того же
 * пира (шапка профиля + секция уведомлений + …), не заводят по своему
 * `setInterval` каждое.
 */
export function useFullPeer(peerId: PeerId): Accessor<PeerFull | undefined> {
  return useDynamicCachedValue(
    () => 'useFullPeer-' + peerId,
    () => _useFullPeer(peerId),
  )()
}
