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
 * ТОЙ ЖЕ полной карточки). До Task 1.5 его заполняли ДВЕ независимые копии
 * похода в сеть — `useChatInfoCard.ts` → `groups.card` и `Chat.tsx` →
 * `privacy.profile` (НЕ `useUserProfileData.ts`: этот хук её данные не
 * читает и в зеркало не пишет вовсе, держит собственный `useState` — прежняя
 * формулировка коммита задачи 1 называла писателем его, это было неточно).
 *
 * ── Task 1.5: сведение писателей ────────────────────────────────────────────
 * `requestFullPeer` — ОДНА функция для сетевого похода: порт
 * `appProfileManager.getProfileByPeerId`, ветвится по `isUser(peerId)` между
 * `usersManager.getFullUser`/`chatsManager.getFullChat` (appProfileManager.ts:520-545).
 * DI разный по конструкции (см. докблок `useManagers.tsx`: React читает
 * менеджеры из контекста, не-React код — `startClient()`), поэтому
 * `requestFullPeer`/`ensureFullPeer` принимают `managers` параметром, а не
 * берут их сами — единственная функция остаётся ОДНОЙ и для Solid
 * (`_useFullPeer` передаёт `startClient().managers`), и для React
 * (`Chat.tsx` передаёт `useManagers()`).
 *
 * `Chat.tsx` сведена ПОЛНОСТЬЮ: её эффект для приватного чата теперь только
 * зовёт `ensureFullPeer(managers, peerId)` — ту же TTL-политику
 * (`expirations`), которой пользуется `_useFullPeer`. Заодно ушёл её
 * собственный повторный запрос `privacy.profile()`: `isBotChat` больше не
 * читает `.user` ответа профиля, а берёт `pFlags.bot` из зеркала пиров
 * (`cachedUser`, `core/peerCache.ts`) — тот же факт, который для ЭТОГО peerId
 * и так объявляет `usePeers` внутри `useChatInfoCard` (см. там), второй поход
 * за ним был чистым дублированием.
 *
 * `useChatInfoCard.ts` сведена ЧАСТИЧНО, и это НЕ то же самое, что «не
 * сведена»: она по-прежнему зовёт `managers.groups.card(peerId)` НАПРЯМУЮ, а
 * не через `requestFullPeer`, — потому что `requestFullPeer` ветвится по
 * `isUser(peerId)`, а `useChatInfoCard` вызывается для ЛЮБОГО настоящего
 * чата, включая приватный диалог и «Избранное» (их `numericChatId` —
 * положительный id собеседника/себя, `isUser` дал бы `true` и увёл бы запрос
 * на `privacy.profile`, ломая её же тест «личный диалог и Избранное» и
 * данные, которые эта ветка вообще не собирает). Задача backend это
 * подтверждает: `/chats/{id}/card` универсален по таблице `chats` (там же
 * лежат private/saved-строки) и для позитивного id молча отвечает валидной,
 * но ПУСТОЙ `channelFull` — а `Chat.tsx` для ТОГО ЖЕ peerId параллельно пишет
 * настоящий `userFull` через `ensureFullPeer`. Если бы `useChatInfoCard`
 * писала пустышку в ОБЩЕЕ зеркало (`saveChatFull`) безусловно, более
 * медленный ответ `card()` мог бы затереть настоящий профиль (в том числе
 * его `theme_emoticon` — обои чата откатились бы к дефолту). Поэтому запись
 * в общее зеркало здесь под условием `!isUser(peerId)` — см. комментарий у
 * вызова в `useChatInfoCard.ts`.
 *
 * `useChatInfoCard.ts` при этом НЕ читает `isFullPeerFresh` — она держит
 * СВОЙ тест «повторный вход в канал», по которому сеть перезапрашивается
 * БЕЗУСЛОВНО на каждый маунт (stale-while-revalidate, синхронный показ из
 * `fullCache` + ревалидация сетью, а не TTL-гейт). Её вклад в общую политику
 * — ОДНОСТОРОННИЙ: `markFullPeerFetched` после своего успешного похода
 * избавляет Solid-профиль ТОГО ЖЕ чата от повторного запроса, но не
 * наоборот — сама она чужую свежесть не спрашивает. Полностью
 * двусторонний путь (обе стороны через `ensureFullPeer`, обе гейтятся)
 * есть только у пользователя — `Chat.tsx` и `_useFullPeer` (пин —
 * `fullPeers.solid.test.ts`, describe `ensureFullPeer`).
 *
 * Второй копии сетевого похода за ПОЛНОЙ карточкой теперь нет ни для одного
 * из двух видов пира — есть по одной на каждый (`requestFullPeer` для
 * пользователя, `groups.card()` внутри `useChatInfoCard` для чата), и обе
 * пишут в одно зеркало под защитой билета (`beginPeerFullFetch`/`saveChatFull`,
 * `core/chatFullCache.ts`).
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
import { startClient, type Managers } from '../client/bootstrap'
import { subscribeExternal } from '../helpers/solid/subscribeExternal'
import useDynamicCachedValue from '../helpers/solid/useDynamicCachedValue'
import {
  beginPeerFullFetch,
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

// Единая на оба фреймворка политика свежести (Task 1.5): читают и пишут её
// и `_useFullPeer`/`ensureFullPeer` здесь, и `useChatInfoCard.ts` напрямую
// (`isFullPeerFresh`/`markFullPeerFetched` ниже) — второй карты того же
// решения не заводим.
const expirations = new Map<PeerId, number>()

/** Порт `appProfileManager.getProfileByPeerId`. `managers` — параметром, а не
 *  захватом `startClient()`: единственный вызывающий из React (`ensureFullPeer`
 *  из `Chat.tsx`) обязан идти через DI-контекст (`useManagers.tsx`), не
 *  напрямую к транспорту — см. докблок файла. `overwrite === false` —
 *  «принеси, если там пусто, но не обновляй TTL» (оригинал: тот же признак,
 *  `fullPeers.ts:18`, используется для мягкой первой догрузки без сброса
 *  расписания, которое, возможно, уже тикает у другого потребителя того же
 *  peerId под `useDynamicCachedValue`). */
async function requestFullPeer(managers: Managers, peerId: PeerId, overwrite: boolean): Promise<void> {
  const ticket = beginPeerFullFetch(peerId)
  const full: PeerFull | null = isUser(peerId)
    ? (await managers.privacy.profile(peerId)).fullUser
    : (await managers.groups.card(peerId))?.fullChat ?? null

  if (!full) return
  if (overwrite) expirations.set(peerId, Date.now() + PEER_FULL_TTL)
  saveChatFull(peerId, full, ticket)
}

/**
 * Не протухла ли лежащая карточка — вопрос, которым любой ЛЕНИВЫЙ (не
 * принудительный) писатель решает, нужен ли поход в сеть. Экспортирован
 * отдельно для `useChatInfoCard.ts` (см. докблок файла): у неё своя ручка
 * (`groups.card`, не через `requestFullPeer`), но политика свежести — та же
 * самая карта `expirations`.
 *
 * Карточка есть, а `expirations` для неё ещё не выставлен — СЧИТАЕМ свежей
 * (а не протухшей). Это НЕ порт оригинала: у tweb ленивый гвард
 * (`!expiration || !fullPeer()`) при пустом `expiration` фетчит БЕЗУСЛОВНО —
 * там это не мешает, потому что `_useFullPeer` на peerId только один живой
 * Solid-корень (`useDynamicCachedValue`) и второго независимого писателя
 * нет. У нас второй есть (React, другой DI — см. докблок файла), и именно
 * ЭТА ветка оригинала — та гонка, которую нашло ревью задачи 1: пока
 * `expirations` не выставлен (первые 3 минуты жизни ЛЮБОЙ карточки),
 * дословный `!expiration` держал бы её вечно «непротухшей по счётчику, но
 * фетчащейся заново», и второй писатель того же peerId всегда бы дублировал
 * поход. Если данные уже лежат — их достаточно, чтобы не считать поход
 * первоочередным; `expirations`, когда он всё-таки выставлен (после
 * `markFullPeerFetched`/принудительного `requestFullPeer(..., true)`),
 * по-прежнему может объявить их протухшими и вернуть периодический рефетч.
 */
export function isFullPeerFresh(peerId: PeerId): boolean {
  if (cachedPeerFull(peerId) === undefined) return false
  const expiration = expirations.get(peerId)
  return !expiration || expiration > Date.now()
}

/** Отметить peerId свежим ПОСЛЕ успешного стороннего похода в сеть — пара к
 *  `isFullPeerFresh` для писателей, идущих мимо `requestFullPeer`. */
export function markFullPeerFetched(peerId: PeerId): void {
  expirations.set(peerId, Date.now() + PEER_FULL_TTL)
}

/** Гарантирует, что карточка peerId загружена и не протухла — не дублирует
 *  поход, если это уже сделал другой потребитель того же peerId (Solid или
 *  React, см. докблок файла). Публичная точка входа для React: `Chat.tsx`
 *  зовёт её эффектом, `managers` — из `useManagers()`. */
export function ensureFullPeer(managers: Managers, peerId: PeerId): void {
  if (!isFullPeerFresh(peerId)) void requestFullPeer(managers, peerId, false)
}

/** Порт `appProfileManager.refreshFullPeer` — ручной сброс для мутаций
 *  собственного действия (Task 2+: редактирование чата, блокировка). Не
 *  вызывается автоматически ниоткуда в этом файле — см. докблок файла про
 *  отсутствие пуш-инвалидации. */
export function refreshFullPeer(peerId: PeerId): void {
  expirations.delete(peerId)
  void requestFullPeer(startClient().managers, peerId, true)
}

function _useFullPeer(peerId: PeerId): Accessor<PeerFull | undefined> {
  const version = subscribeExternal(subscribeChatFullMirror, chatFullMirrorVersion)
  const managers = startClient().managers

  ensureFullPeer(managers, peerId)

  const expiration = expirations.get(peerId)
  const delay = (expiration || 0) - Date.now()
  const timeout = delay > 0 ? setTimeout(() => void requestFullPeer(managers, peerId, true), delay) : 0
  const interval = setInterval(() => void requestFullPeer(managers, peerId, true), PEER_FULL_TTL)

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
