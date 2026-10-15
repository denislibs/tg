// src/core/chatFullCache.ts
//
// ПОЛНЫЕ карточки пиров на главном потоке — `channelFull` у чата, `userFull` у
// человека. Порт `appProfileManager.chatsFull` / `usersFull`: у оригинала
// полные формы лежат ОТДЕЛЬНО от кратких (`appChatsManager.chats`), потому что
// приезжают отдельным запросом и переживают закрытие экрана.
//
// Раньше эта Map жила приватной переменной внутри `core/hooks/useChatInfoCard.ts`
// (снесён с React-шапкой чата на К-3) и умела только чаты. Вынесена сюда, потому что у полной карточки появился
// ВТОРОЙ читатель вне экрана информации: тема оформления чата. Её место в схеме
// — `chatFull`/`userFull.theme_emoticon` (решение Р7 разбора диалогов), в строке
// `dialog` поля нет вовсе, а читают её колонка чата (`components/Chat.tsx`) и
// обои шелла (`core/hooks/useShellTheme.ts`).
//
// Зеркало, а не второй источник: единственные писатели —
// `stores/fullPeers.solid.ts::requestFullPeer`
// (`groups.card`/`privacy.profile` по `isUser`, дедуплицирован Task 1.5 —
// см. докблок того файла), плюс проектор кадра `chat_theme_update`. Механика
// подписки — та же, что у `core/peerCache.ts`: счётчик версии +
// `useSyncExternalStore`, потому что снимок это КОЛЛЕКЦИЯ, а не значение по ключу.
//
// Чего здесь нет: краткой формы пира (она в `core/peerCache.ts`, владелец —
// воркерный `peersManager`) и похода в сеть. Карточка сюда попадает только
// тогда, когда её и так загрузили ради экрана.
import type { BotCommand, BotInfo, ChannelFull, UserFull } from './peers/peer'
import { isUser, toUserId } from './peers/peerId'

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
 * Порт tweb `appProfileManager.canViewStatistics` (appProfileManager.ts:1235-1247):
 * статистику чата можно смотреть, если в ЗАГРУЖЕННОЙ полной карточке стоит
 * `pFlags.can_view_stats`. Проверки `stats_dc` нет — реквизит MTProto не
 * производится (дата-центр один). Потребители — пункт «Статистика» меню ⋮
 * шапки (`chat/topbar.ts`) и меню поста (`chat/contextMenu.ts`).
 */
export function canViewStatistics(peerId: PeerId): boolean {
  if (isUser(peerId)) return false

  const chatFull = fullMirror.get(peerId)
  if (chatFull?._ !== 'channelFull') return false

  return !!chatFull.pFlags?.can_view_stats
}

/**
 * Билет на поход в сеть за полной карточкой peerId — взять ПЕРЕД вызовом
 * менеджера, передать в `saveChatFull`. Несколько писателей одного peerId
 * (сегодня — `stores/fullPeers.solid.ts` и `chat/reactions.ts`) могут запустить перекрывающиеся
 * походы; без билета медленный, но начатый РАНЬШЕ ответ мог бы прилететь
 * ПОЗЖЕ и затереть карточку, которую уже применил более новый запрос
 * (ревью задачи 1, п.2 — «проверить защиту от устаревшего ответа»).
 */
export function beginPeerFullFetch(peerId: PeerId): number {
  const ticket = (latestFetch.get(peerId) ?? 0) + 1
  latestFetch.set(peerId, ticket)
  fetching.add(peerId)
  return ticket
}

/** Поход за карточкой peerId не удался: кадры, которые копились для его ответа
 *  (`pendingBotCommands`), ему не нужны. Устаревший билет игнорируется — идёт
 *  более новый поход. */
export function endPeerFullFetch(peerId: PeerId, ticket: number): void {
  if (latestFetch.get(peerId) !== ticket) return
  fetching.delete(peerId)
  pendingBotCommands.delete(peerId)
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
  if (ticket !== undefined) {
    full = withPendingBotCommands(peerId, full, ticket)
    fetching.delete(peerId)
  }
  const prev = fullMirror.get(peerId)
  if (prev && JSON.stringify(prev) === JSON.stringify(full)) return
  fullMirror.set(peerId, full)
  bump()
}

/**
 * Кадры `updateBotCommands`, пришедшие, пока шёл поход за карточкой. Ответ,
 * начатый ДО кадра, собран до него и принёс бы прежние команды; ответ, начатый
 * ПОСЛЕ, уже содержит кадр. Различает их билет: кадр запоминает последний
 * выданный на пира билет, и его команды ложатся только в ответ с билетом не
 * больше этого. Порт `applyCachedBotCommands` tweb (`appProfileManager.ts:149`,
 * `:452-465`): там кэш команд живёт в состоянии и применяется ко всякой
 * сохраняемой карточке; здесь кадр запоминается только пока в пути поход за
 * карточкой (`fetching`), потому что сервер рассылает кадр не всем (предел
 * рассылки) и вечный кэш откатил бы свежую карточку.
 */
const fetching = new Set<PeerId>() // пиры, за карточкой которых идёт поход
const pendingBotCommands = new Map<PeerId, Map<number, { commands: BotCommand[]; ticket: number }>>()

function withPendingBotCommands(peerId: PeerId, full: PeerFull, ticket: number): PeerFull {
  const frames = pendingBotCommands.get(peerId)
  if (!frames) return full
  pendingBotCommands.delete(peerId)
  let out = full
  for (const [botId, f] of frames) {
    if (f.ticket < ticket) continue
    out = patchBotCommands(out, peerId, botId, f.commands) ?? out
  }
  return out
}

/** Карточка с командами бота `botId`; `undefined` — менять нечего (бота в карточке
 *  нет либо команды те же). Порт `appProfileManager.applyBotCommands` (`:425-450`). */
function patchBotCommands(full: PeerFull, peerId: PeerId, botId: number, commands: BotCommand[]): PeerFull | undefined {
  const same = (info: BotInfo) => JSON.stringify(info.commands ?? []) === JSON.stringify(commands)
  if (full._ === 'userFull') {
    const info = full.bot_info
    // У бота bot_info может не назвать себя: тогда бот — сам пир карточки.
    if (!info || (info.user_id ?? toUserId(peerId)) !== botId || same(info)) return undefined
    return { ...full, bot_info: { ...info, commands } }
  }
  if (!full.bot_info?.some((info) => info.user_id === botId && !same(info))) return undefined
  return { ...full, bot_info: full.bot_info.map((info) => info.user_id === botId ? { ...info, commands } : info) }
}

/**
 * Кадр `updateBotCommands` (событие `bot_commands`): команды бота `botId`
 * в закэшированной карточке `peerId` меняются на месте, карточка не
 * перечитывается — tweb `onUpdateBotCommands` (`appProfileManager.ts:1560-1569`).
 * Карточки нет — патчить нечего, команды приедут вместе с ней; если за ней идёт
 * поход в сеть, кадр запоминается (см. `pendingBotCommands`).
 */
export function applyBotCommands(peerId: PeerId, botId: number, commands: BotCommand[]): void {
  if (fetching.has(peerId)) {
    const frames = pendingBotCommands.get(peerId) ?? new Map()
    frames.set(botId, { commands, ticket: latestFetch.get(peerId) ?? 0 })
    pendingBotCommands.set(peerId, frames)
  }

  const prev = fullMirror.get(peerId)
  const next = prev && patchBotCommands(prev, peerId, botId, commands)
  if (!next) return
  fullMirror.set(peerId, next)
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

/**
 * Событие `peer_block` (своя или чужая вкладка заблокировала пира): tweb
 * `appProfileManager.onUpdatePeerBlocked` (`:1506-1532`) правит `pFlags.blocked`
 * той же `userFull`, из которой его читают пункты «Заблокировать»/«Разблокировать»
 * меню ⋮ шапки. Карточки нет — патчить нечего, флаг приедет вместе с ней.
 */
export function applyPeerBlocked(peerId: PeerId, blocked: boolean | undefined): void {
  const prev = fullMirror.get(peerId)
  if (prev?._ !== 'userFull' || !!prev.pFlags?.blocked === !!blocked) return
  const pFlags = { ...prev.pFlags }
  if (blocked) pFlags.blocked = true
  else delete pFlags.blocked
  fullMirror.set(peerId, { ...prev, pFlags })
  bump()
}

/** Смена аккаунта: карточки прошлой сессии чужие (та же причина, что у
 *  `resetPeerMirror`). */
export function resetChatFullMirror(): void {
  pendingBotCommands.clear()
  fetching.clear()
  if (!fullMirror.size) return
  fullMirror.clear()
  bump()
}
