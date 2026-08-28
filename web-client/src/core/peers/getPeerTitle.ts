// Имя пира собирается НА КЛИЕНТЕ — порт `components/wrappers/getPeerTitle.ts`.
//
// ── Долг, который закрывает этот файл ───────────────────────────────────────
// `display_name` убран с провода целиком (шаг C): ни одна витрина бэкенда
// больше не склеивает «Имя Фамилия» — это денормализация ради экономии, в
// оригинале имя собирает клиент из `first_name`/`last_name`. Единственное
// исключение осталось на бэкенде — заголовок ПУБЛИЧНОЙ страницы `/u/{username}`:
// её читает аноним, у которого кэша пиров нет.
//
// Портировать имя без ФОЛБЭКОВ нельзя: у нас их не было вовсе
// (`docs/readiness/port-divergences.md:95`), и удалённый аккаунт или скрытый
// автор пересылки дали бы ПУСТОЙ узел навсегда. Правило фолбэка взято из
// оригинала дословно (`getPeerTitle.ts:63`):
//
//     пусто → пира нет ИЛИ pFlags.deleted ? 'Deleted Account'/'Deleted'
//                                         : username || ''
//
// ── Что здесь НЕ делается ───────────────────────────────────────────────────
// Это сборка СТРОКИ. Узел `.peer-title` с эмодзи, иконками verified/premium и
// подпиской на `peer_title_edit` — компонент `PeerTitle` (`components/
// peerTitle.ts` оригинала), задача следующего агента; он зовёт отсюда.
// Оборачивание в `wrapEmojiText` тоже там: строку в HTML здесь никто не
// превращает (`web-client/CLAUDE.md` — пользовательский контент не рендерится
// сырой HTML-строкой).
//
// В отличие от оригинала функция СИНХРОННАЯ: карточка пира читается из
// зеркала (`core/peerCache.ts`), которое для того и существует — императивная
// лента обязана взять имя на построении узла, а не промисом.

import type { Chat, User } from './peer'
import { HIDDEN_PEER_ID, isUser } from './peerId'
import { getChatTitle } from './predicates'

/** Фолбэки имени. В оригинале это ключи `lang.ts`; подсистемы переводов у нас
 *  нет, строки лежат по месту — как и везде в этом клиенте. */
export const DELETED_ACCOUNT_TITLE = 'Удалённый аккаунт' // 'HiddenName' → 'Deleted Account'
export const DELETED_ACCOUNT_SHORT = 'Удалён' // 'Deleted'
export const AUTHOR_HIDDEN_TITLE = 'Скрытое имя' // 'AuthorHidden'
export const AUTHOR_HIDDEN_SHORT = 'Аноним' // 'AuthorHiddenShort'
export const SAVED_MESSAGES_TITLE = 'Избранное' // 'SavedMessages'

export interface PeerTitleOptions {
  /** только имя (первое слово) — компактные места: список чатов, реакции */
  onlyFirstName?: boolean
  /** показать `@username` вместо имени */
  username?: boolean
}

/** Порт `_limitSymbols` (`helpers/string/limitSymbols.ts`) — обрезка с многоточием. */
export function limitSymbols(text: string, after: number, from = after): string {
  text = text.trim()
  if (text.length > from) return text.slice(0, after).trim() + '…'
  return text
}

/**
 * Имя пользователя — порт ветки `peerId.isUser()` (`getPeerTitle.ts:47-65`).
 * `user === undefined` («карточки ещё нет») даёт тот же фолбэк, что удалённый
 * аккаунт: ровно как в оригинале, где `!user` стоит первым в том же условии.
 */
export function getUserTitle(user: User | undefined, options: PeerTitleOptions = {}): string {
  const { onlyFirstName, username } = options
  const real = user && user._ === 'user' ? user : undefined

  let title = ''
  if (real) {
    if (username) {
      if (real.username) title = '@' + real.username
    } else {
      if (real.first_name) title += real.first_name
      if (real.last_name && (!onlyFirstName || !title)) title += ' ' + real.last_name
    }
  }

  if (!title) {
    title = !real || real.pFlags?.deleted
      ? onlyFirstName ? DELETED_ACCOUNT_SHORT : DELETED_ACCOUNT_TITLE
      : real.username ?? ''
  } else {
    title = title.trim()
  }

  return title
}

/** Заголовок чата — порт ветки `else` (`getPeerTitle.ts:66-84`). */
export function getChatTitleText(chat: Chat | undefined, options: PeerTitleOptions = {}): string {
  const { onlyFirstName, username } = options

  let title = ''
  if (username && chat && chat._ === 'channel' && chat.username) title = '@' + chat.username
  else title = getChatTitle(chat)

  if (onlyFirstName) title = title.split(' ')[0]
  return title
}

/**
 * Имя пира — порт `getPeerTitle` целиком. Разрешение «ключ → карточка»
 * остаётся у хранилища (на главном потоке `core/peerCache.ts::peerTitle`, в
 * воркере — свой кэш), поэтому карточка приходит аргументом.
 *
 * Ветвление по КЛЮЧУ, а не по карточке: `peerId` известен всегда, а карточка
 * может ещё не доехать — и тогда фолбэк обязан быть тем же, что у оригинала
 * (`!user` в условии :63), то есть «Удалённый аккаунт» у пользователя и пустая
 * строка у чата, а не одно и то же для обоих.
 */
export function getPeerTitle(
  options: PeerTitleOptions & { peerId: PeerId; peer: User | Chat | undefined; limitSymbols?: number },
): string {
  const { peerId, peer } = options
  let title: string
  if (peerId === HIDDEN_PEER_ID) title = options.onlyFirstName ? AUTHOR_HIDDEN_SHORT : AUTHOR_HIDDEN_TITLE
  else if (isUser(peerId)) title = getUserTitle(peer as User | undefined, options)
  else title = getChatTitleText(peer as Chat | undefined, options)

  if (options.limitSymbols !== undefined) title = limitSymbols(title, options.limitSymbols)
  return title
}
