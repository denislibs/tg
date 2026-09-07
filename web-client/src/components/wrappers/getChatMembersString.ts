// Подпись «N подписчиков / N участников» — порт tweb
// `components/wrappers/getChatMembersString.ts` (:9-22) и хвоста
// `appImManager.getChatStatus` (:3086-3119), который дописывает к ней «N
// онлайн».
//
// ── Зачем отдельный файл ────────────────────────────────────────────────────
// У оригинала ЭТОТ вопрос задаётся ровно в одном месте, и оттуда его берут и
// шапка чата, и строки списков. У нас он был раздвоен, причём двумя разными
// способами сразу:
//
//   • `components/SearchView.tsx:447-456` считал его ПРАВИЛЬНО — ключами
//     `Subscribers`/`Members` через `tArgs`;
//   • `components/Chat.tsx:865-873` — РУССКИМ ЛИТЕРАЛОМ (`${members}
//     подписчиков`), мимо словаря вовсе.
//
// Отсюда и «разнобой языка»: на браузере с локалью `en-US` подписи опроса шли
// по-английски (они через ядро), а шапка чата — по-русски. Язык при этом
// выбирался ОДИН (`I18n.lastRequestedLangCode`, `lib/langPack.ts:239`) — вторым
// «источником» был сам литерал, который ядра не спрашивает.
//
// Заодно литерал терял две вещи, которых у оригинала нет: склонение («1
// подписчиков») и разбивку по тысячам.
//
// ── Форма: строка, а не узел ────────────────────────────────────────────────
// Оригинал отдаёт `HTMLElement` (`i18n(key, args)`), потому что живёт в
// императивном мире и обновляет узел на месте. Оба наших вызывающих —
// компоненты, и подпись у них строка: реактивность даёт `useI18nStore`
// (подписан на `language_apply`), а форматтер приезжает параметром — тот же
// приём, каким уже был написан `chatResultSubtitle` в `SearchView.tsx`.
import { isBroadcast } from '@core/peers/predicates'
import type { Chat } from '@core/peers/peer'
import type { LangPackKey } from '@/lang'
import { join } from '@lib/langPack'
import numberThousandSplitter from '@helpers/number/numberThousandSplitter'

/** Форматтер ядра, каким его отдаёт `useI18nStore` (`tArgs`). */
export type MembersStringFormatter = (key: LangPackKey, args: (string | number)[]) => string

/**
 * Порт `getParticipantsCount` оригинала в применимом объёме.
 *
 * Число участников есть только у `channel`/`chat`; у `*Forbidden` его нет ПО
 * СХЕМЕ, а не «равно нулю». Ветка `chatFull` оригинала (`getChatMembersString.ts:11-12`)
 * предмета не имеет: полной карточки чата в этом слое у нас нет, а
 * `participants_count` приезжает уже в самом `Chat`.
 */
export function getParticipantsCount(chat: Chat | undefined): number {
  return chat && (chat._ === 'channel' || chat._ === 'chat') ? chat.participants_count ?? 0 : 0
}

/**
 * `N подписчиков` / `N участников` — порт `_getChatMembersString` (:9-21).
 *
 * Два правила оригинала, которых не было у литерала:
 *   • `count = count || 1` (:18) — нуля участников не бывает: в чате есть как
 *     минимум тот, кто его создал, а ноль в `participants_count` значит «поле
 *     ещё не приехало». Именно этот ноль и показывала шапка («0 подписчиков»);
 *   • число едет разбитым по тысячам (:21).
 */
export function getChatMembersString(chat: Chat | undefined, tArgs: MembersStringFormatter): string {
  const count = getParticipantsCount(chat) || 1
  const key: LangPackKey = isBroadcast(chat) ? 'Subscribers' : 'Members'
  return tArgs(key, [numberThousandSplitter(count)])
}

/**
 * Та же подпись плюс «N онлайн» — порт `getChatStatus` (:3096-3110).
 *
 * Гейт оригинала — `onlines > 1`, а НЕ `> 0`: единица это ты сам, и писать
 * «1 онлайн» в чате, который ты открыл, значит показывать константу.
 *
 * Разделитель берётся у ядра тем же `join(elements, false)` (:3105), что и у
 * оригинала: перечисление — тоже локализованная строка
 * (`AutoDownloadSettings.Delimeter`), а не зашитая запятая.
 */
export function getChatStatusString(
  chat: Chat | undefined,
  onlines: number,
  tArgs: MembersStringFormatter,
): string {
  const subtitle = getChatMembersString(chat, tArgs)
  if (onlines <= 1) return subtitle
  return join([subtitle, tArgs('OnlineCount', [numberThousandSplitter(onlines)])], false, true)
}
