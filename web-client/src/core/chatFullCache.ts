// src/core/chatFullCache.ts
//
// ПОЛНЫЕ карточки пиров на главном потоке — `channelFull` у чата, `userFull` у
// человека. Порт `appProfileManager.chatsFull` / `usersFull`: у оригинала
// полные формы лежат ОТДЕЛЬНО от кратких (`appChatsManager.chats`), потому что
// приезжают отдельным запросом и переживают закрытие экрана.
//
// Раньше эта Map жила приватной переменной внутри `core/hooks/useChatInfoCard.ts`
// и умела только чаты. Вынесена сюда, потому что у полной карточки появился
// ВТОРОЙ читатель вне экрана информации: тема оформления чата. Её место в схеме
// — `chatFull`/`userFull.theme_emoticon` (решение Р7 разбора диалогов), в строке
// `dialog` поля нет вовсе, а читают её колонка чата (`components/Chat.tsx`) и
// обои шелла (`core/hooks/useShellTheme.ts`).
//
// Зеркало, а не второй источник: единственные писатели — `useChatInfoCard`
// (`groups.card`, только для настоящих чатов/каналов — см. `saveChatFull` и
// комментарий у вызова) и `stores/fullPeers.solid.ts::requestFullPeer`
// (`groups.card`/`privacy.profile` по `isUser`, дедуплицирован Task 1.5 —
// см. докблок того файла), плюс проектор кадра `chat_theme_update`. Механика
// подписки — та же, что у `core/peerCache.ts`: счётчик версии +
// `useSyncExternalStore`, потому что снимок это КОЛЛЕКЦИЯ, а не значение по ключу.
//
// Чего здесь нет: краткой формы пира (она в `core/peerCache.ts`, владелец —
// воркерный `peersManager`) и похода в сеть. Карточка сюда попадает только
// тогда, когда её и так загрузили ради экрана.
import type { ChannelFull, UserFull } from './peers/peer'

export type PeerFull = ChannelFull | UserFull

const fullMirror = new Map<PeerId, PeerFull>()
let version = 0
const subs = new Set<() => void>()
// Билет последнего похода в сеть на peerId (Task 1.5: защита от гонки, найденная
// ревью задачи 1 — см. докблок `saveChatFull`).
const latestFetch = new Map<PeerId, number>()

export function subscribeChatFullMirror(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

export function chatFullMirrorVersion(): number {
  return version
}

const bump = (): void => { ++version; subs.forEach((f) => f()) }

/** Синхронное чтение на рендере; `undefined` — карточку ещё не загружали. */
export function cachedPeerFull(peerId: PeerId): PeerFull | undefined {
  return fullMirror.get(peerId)
}

/**
 * Тема оформления пира — `theme_emoticon` его полной карточки. Пустая строка и
 * незагруженная карточка отвечают одинаково (`undefined`): «темы нет».
 *
 * Карточка к моменту чтения может быть ещё не загружена — тогда колонка чата
 * первый кадр рисуется глобальной темой и перекрашивается, когда карточка
 * приедет. Подпирать это отдельным запросом за темой нельзя (разбор, решение
 * Р7): второй источник того же факта.
 */
export function cachedPeerTheme(peerId: PeerId): string | undefined {
  return fullMirror.get(peerId)?.theme_emoticon || undefined
}

/**
 * Билет на поход в сеть за полной карточкой peerId — взять ПЕРЕД вызовом
 * менеджера, передать в `saveChatFull`. Несколько писателей одного peerId
 * (сегодня — `useChatInfoCard` и `stores/fullPeers.solid.ts`, при живом
 * Solid-профиле рядом с открытым чатом) могут запустить перекрывающиеся
 * походы; без билета медленный, но начатый РАНЬШЕ ответ мог бы прилететь
 * ПОЗЖЕ и затереть карточку, которую уже применил более новый запрос
 * (ревью задачи 1, п.2 — «проверить защиту от устаревшего ответа»).
 */
export function beginPeerFullFetch(peerId: PeerId): number {
  const ticket = (latestFetch.get(peerId) ?? 0) + 1
  latestFetch.set(peerId, ticket)
  return ticket
}

/**
 * Билет ещё не перекрыт более новым походом за той же карточкой — тот же
 * вопрос, каким `saveChatFull` гейтит СВОЮ запись, вынесен отдельной функцией
 * ради `core/profilePhoneCache.ts` (Task 2 профиля на Solid): телефон
 * приходит В ТОЙ ЖЕ сетевой паре, что и `fullUser` (`privacy.profile()`,
 * `stores/fullPeers.solid.ts::requestFullPeer`), и обязан гаситься ТОЙ ЖЕ
 * гонкой — заводить вторую карту билетов под тот же поход означало бы два
 * источника истины про «какой ответ последний».
 */
export function isFetchTicketCurrent(peerId: PeerId, ticket?: number): boolean {
  return ticket === undefined || ticket === latestFetch.get(peerId)
}

/**
 * Положить загруженную карточку. Совпавшая с лежащей подписчиков не будит.
 *
 * `ticket` — билет из `beginPeerFullFetch`, взятый непосредственно перед
 * походом в сеть. Ответ с билетом, который уже не последний выданный на этот
 * peerId (кто-то запросил карточку заново, пока этот ответ летел),
 * отбрасывается молча — иначе устаревший, но задержавшийся сетью ответ
 * переписал бы более свежую карточку. Без билета (`undefined`) пишет
 * безусловно — источникам без гонки похода в сеть (прямые вызовы тестов,
 * `applyChatTheme` рядом) билет ни к чему.
 */
export function saveChatFull(peerId: PeerId, full: PeerFull, ticket?: number): void {
  if (!isFetchTicketCurrent(peerId, ticket)) return
  const prev = fullMirror.get(peerId)
  if (prev && JSON.stringify(prev) === JSON.stringify(full)) return
  fullMirror.set(peerId, full)
  bump()
}

/**
 * Кадр `chat_theme_update`: тема сменилась (другое устройство/вкладка либо
 * собеседник — тема общая для обеих сторон). Патчим ТУ ЖЕ карточку, а не
 * заводим рядом второе хранилище тем; карточки ещё нет — патчить нечего,
 * тема приедет вместе с ней.
 */
export function applyChatTheme(peerId: PeerId, themeId: string): void {
  const prev = fullMirror.get(peerId)
  if (!prev || (prev.theme_emoticon ?? '') === themeId) return
  fullMirror.set(peerId, { ...prev, theme_emoticon: themeId })
  bump()
}

/** Смена аккаунта: карточки прошлой сессии чужие (та же причина, что у
 *  `resetPeerMirror`). */
export function resetChatFullMirror(): void {
  if (!fullMirror.size) return
  fullMirror.clear()
  bump()
}
