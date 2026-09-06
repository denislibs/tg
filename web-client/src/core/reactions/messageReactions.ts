// src/core/reactions/messageReactions.ts
//
// Агрегат реакций сообщения — конструктор `messageReactions` схемы, а не
// плоский список чипов.
//
// Что было и почему это дефект. Модель держала
// `reactions: {emoji, count, mine, recent}[]` плюс ОТДЕЛЬНОЕ поле
// `starReaction: {total, mine}`, а провод и в сообщении, и в кадре
// `updateMessageReactions` нёс объединение. Проекция стоила трёх вещей сразу:
//
//   • `emoji: string` не выражает `reactionCustomEmoji{document_id}` — кастомная
//     реакция в такую модель не помещается вовсе;
//   • `mine: boolean` теряет `chosen_order` — у оригинала это ПОРЯДКОВЫЙ номер
//     среди моих реакций (премиум ставит несколько), а «не поставил» выражено
//     отсутствием параметра, поэтому ноль там значащий;
//   • платная ⭐-реакция ехала отдельным полем, хотя своего кадра у неё нет: на
//     проводе это ВТОРОЙ конструктор объединения `Reaction` (`reactionPaid`) в
//     том же векторе `results`, а мой вклад — `top_reactors` с `pFlags.my`.
//
// Здесь собраны операции над агрегатом: дельта своего клика, слияние
// абсолютного агрегата из кадра со своим выбором и предикаты для чипов.

import type { MessageReactions, ReactionCount, Reaction } from '../models'
import { getPeerId, isUser } from '../peers/peerId'

/**
 * Может ли зритель получить СПИСОК реагировавших этого сообщения —
 * `messages.getMessageReactionsList`.
 *
 * Порт терма `canViewList` (tweb `components/chat/reactionContextMenu.ts:95`
 * `!!message.reactions?.pFlags.can_see_list || message.peerId.isUser()`); тот же
 * терм слово в слово стоит ещё в двух местах оригинала —
 * `components/chat/contextMenu.ts:404-407` (открывать ли меню чипа) и
 * `components/chat/reactions.ts:305-306` (аватарки вместо числа в чипе).
 *
 * Ответ ОДИН на клиента и живёт здесь, потому что термов у него два и они из
 * разных источников: право в группе объявляет СЕРВЕР флагом `can_see_list`, а
 * личку договаривает КЛИЕНТ по ключу пира — в личке флага не бывает вовсе
 * (`domain/reaction.go::CanSeeReactionsList` на бэкенде ставит его только
 * группе). Разъехаться этим двум термам по копиям нельзя: копия, забывшая
 * личку, молча отключила бы список в личных чатах.
 */
export function canViewReactionsList(agg: MessageReactions | undefined, peerId: PeerId): boolean {
  return !!agg?.pFlags?.can_see_list || isUser(peerId)
}

/** Ключ чипа: у эмодзи-реакции это сам эмодзи, у платной — сам конструктор. */
export function reactionKey(r: Reaction): string {
  return r._ === 'reactionPaid' ? 'reactionPaid' : r.emoticon
}

/** «Моя» — это НАЛИЧИЕ `chosen_order`, а не его истинность: ноль там значит
 *  «моя первая», и склеивать его с «не моя» нельзя. */
export function isChosen(c: ReactionCount): boolean {
  return c.chosen_order !== undefined
}

/** Чип платной ⭐-реакции, если он есть в векторе. */
export function paidCount(agg: MessageReactions | undefined): ReactionCount | undefined {
  return agg?.results.find((c) => c.reaction._ === 'reactionPaid')
}

/** Мой вклад звёздами: он лежит в `top_reactors` с `pFlags.my`, потому что в
 *  `reactionCount` помещается только «моя или нет», а не сколько. */
export function myPaidStars(agg: MessageReactions | undefined): number {
  return (agg?.top_reactors ?? []).find((x) => x.pFlags?.my)?.count ?? 0
}

/** Сумма всех счётчиков агрегата (порог «аватары вместо числа» у tweb считается
 *  по ней, а не по одному чипу). */
export function totalReactions(agg: MessageReactions | undefined): number {
  return (agg?.results ?? []).reduce((sum, c) => sum + c.count, 0)
}

/** Последние реагировавшие ЭТОЙ реакцией — знаковые ключи пиров. Вектор
 *  `recent_reactions` один на агрегат, поэтому фильтруется по самой реакции. */
export function recentOf(agg: MessageReactions | undefined, reaction: Reaction): PeerId[] {
  const key = reactionKey(reaction)
  return (agg?.recent_reactions ?? [])
    .filter((x) => reactionKey(x.reaction) === key)
    .map((x) => getPeerId(x.peer_id))
}

/** Есть ли на сообщении чип с этим эмодзи (чей угодно) — фильтр тегов «Избранного». */
export function hasReactionEmoticon(agg: MessageReactions | undefined, emoticon: string): boolean {
  return (agg?.results ?? []).some((c) => c.reaction._ === 'reactionEmoji' && c.reaction.emoticon === emoticon)
}

/** Есть ли МОЯ реакция этим эмодзи. */
export function hasMyReaction(agg: MessageReactions | undefined, emoji: string): boolean {
  const c = (agg?.results ?? []).find((x) => x.reaction._ === 'reactionEmoji' && x.reaction.emoticon === emoji)
  return !!c && isChosen(c)
}

/** Все МОИ эмодзи-реакции (в порядке `chosen_order`). */
export function myEmoticons(agg: MessageReactions | undefined): string[] {
  return (agg?.results ?? [])
    .filter((c) => isChosen(c) && c.reaction._ === 'reactionEmoji')
    .sort((a, b) => (a.chosen_order ?? 0) - (b.chosen_order ?? 0))
    .map((c) => (c.reaction as { emoticon: string }).emoticon)
}

/**
 * Сколько реакций ставит ОДИН пользователь на ОДНОМ сообщении.
 *
 * У оригинала это не константа: значение приходит конфигурацией приложения
 * (`help.getAppConfig`, ключи `reactions_user_max_default` /
 * `reactions_user_max_premium`) и читается через `getLimit('reactions')` —
 * tweb `src/lib/appManagers/apiManagerMethods.ts:369-395`, строка `:375`.
 * Понятия appConfig у нас нет вовсе (ни ручки на бэке, ни кэша на клиенте),
 * поэтому здесь зашиты дефолтные значения Telegram; когда appConfig появится,
 * лимит должен приехать из него, а не отсюда.
 *
 * Те же два числа держит СЕРВЕР (`backend/internal/usecase/chat/reaction.go`) —
 * он и есть источник истины: клиент лишь не обещает невозможного.
 */
export const REACTIONS_USER_MAX_DEFAULT = 1
export const REACTIONS_USER_MAX_PREMIUM = 3

/** Лимит своих реакций по подписке (порт `getLimit('reactions', isPremium)`). */
export function reactionsUserLimit(premium: boolean): number {
  return premium ? REACTIONS_USER_MAX_PREMIUM : REACTIONS_USER_MAX_DEFAULT
}

/**
 * Мои реакции, которые ВЫТЕСНЯЕТ постановка `emoji`, — самые старые сверх
 * лимита, в порядке от старейшей.
 *
 * Порт `appReactionsManager.ts:733-738`: свои реакции берутся по `chosen_order`,
 * ставящаяся из них исключается (`splice(chosenReactionIdx, 1)`), а хвост за
 * пределом лимита снимается — `unsetReactions.push(...chosenReactions.splice(
 * limit - +(chosenReactionIdx === -1)))`. Снимается молча: тоста об упёршемся
 * лимите нет ни в `chat.ts:1457`, ни в `components/chat/reactions.ts` (там
 * гасится ДРУГОЙ лимит — `reactions_uniq_max`, `reactionsMenu.ts:250-254`).
 */
/*
 * ОГОВОРКА о нашем проводе: `chosen_order` приезжает НУЛЁМ у всех моих
 * реакций (backend `internal/domain/mtmessage.go` — колонки порядка в витрине
 * нет), поэтому после перезагрузки страницы «самая старая» здесь вырождается
 * в порядок чипов. Серверное вытеснение при этом точное (оно читает
 * `reactions.created_at`), и разойтись они могут только у премиума.
 *
 * Кадр расхождение НЕ ЛЕЧИТ: он приводит к серверному СОСТАВ чипов, но не
 * пометку «моя» — `chosen_order` пер-зрительский, в общем теле кадра его нет,
 * и `mergeReactions` берёт мой выбор из предыдущего состояния, то есть из уже
 * разошедшегося. Снятый сервером чип исчезнет, а снятый локально останется в
 * ленте чужим на вид, пока по нему не кликнут снова или не перезагрузят
 * историю. Долг: backend/backlogs/reaction-chosen-order-on-wire.md.
 */
export function excessChosenReactions(
  agg: MessageReactions | undefined,
  emoji: string,
  limit: number,
): string[] {
  const others = myEmoticons(agg).filter((e) => e !== emoji) // старейшие первыми
  const excess = others.length - (limit - 1) // место под ставящуюся
  return excess > 0 ? others.slice(0, excess) : []
}

/**
 * Следующий `chosen_order` — НА ЕДИНИЦУ БОЛЬШЕ максимального из моих (порт
 * `appReactionsManager.ts:832-833`: `chosenReactions[0].chosen_order + 1`, где
 * массив отсортирован по убыванию).
 *
 * Не «сколько моих»: после вытеснения номера могут идти не подряд, и счётчик
 * выдал бы новой реакции номер уже занятый — две реакции с одним порядком
 * означают, что «самая старая» перестаёт быть определена.
 */
function nextChosenOrder(agg: MessageReactions | undefined): number {
  const orders = (agg?.results ?? []).filter(isChosen).map((c) => c.chosen_order!)
  return orders.length ? Math.max(...orders) + 1 : 0
}

/**
 * Перенумерация моих `chosen_order` подряд с нуля после снятия — порт
 * `appReactionsManager.ts:749-752` (`reactionCount.chosen_order =
 * chosenReactionsLength - 1 - idx`). Без неё в наборе остаются дыры, и
 * следующая постановка считает «самой старой» не ту.
 */
function renumberChosen(results: ReactionCount[]): ReactionCount[] {
  const orders = results.filter(isChosen).map((c) => c.chosen_order!).sort((a, b) => a - b)
  if (!orders.length) return results
  const rank = new Map(orders.map((o, i) => [o, i]))
  return results.map((c) => (isChosen(c) ? { ...c, chosen_order: rank.get(c.chosen_order!)! } : c))
}

const EMPTY: MessageReactions = { _: 'messageReactions', results: [] }

function withResults(agg: MessageReactions | undefined, results: ReactionCount[]): MessageReactions | undefined {
  if (!results.length && !(agg?.top_reactors?.length)) return undefined
  return { ...(agg ?? EMPTY), _: 'messageReactions', results }
}

/**
 * Кто и где кликнул по реакции.
 *
 * Ключ зрителя и ключ ЧАТА ездят парой, потому что оптимистичный
 * `recent_reactions` требует обоих: чей пир дописать — знает первый, а можно ли
 * его дописывать вообще — только второй.
 */
export interface ReactionClick {
  /** Ключ ЗРИТЕЛЯ: его пир встаёт в `recent_reactions` первым. */
  me: PeerId
  /** Ключ ЧАТА, где стоит сообщение. */
  peerId: PeerId
}

/**
 * Дельта СВОЕГО клика (count±1 по эмодзи) — общая для главного стора
 * (оптимистичный клик + эхо) и воркер-кэша (SSOT). Единственная реализация,
 * чтобы стор и воркер не разошлись.
 *
 * Возвращает `null`, когда применять нечего (эхо своего уже применённого
 * действия), чтобы вызывающий не пересобирал сообщение зря.
 */
export function reactionDelta(
  agg: MessageReactions | undefined,
  emoji: string,
  action: 'add' | 'remove',
  mine: boolean,
  /** Кто и ГДЕ кликнул. Не задан — оптимистичного `recent_reactions` нет вовсе
   *  (эхо чужого клика, тест кэш-методов). */
  by?: ReactionClick,
): MessageReactions | undefined | null {
  const results = [...(agg?.results ?? [])]
  const i = results.findIndex((c) => c.reaction._ === 'reactionEmoji' && c.reaction.emoticon === emoji)

  if (action === 'add') {
    if (i < 0) {
      results.push({
        _: 'reactionCount',
        reaction: { _: 'reactionEmoji', emoticon: emoji },
        count: 1,
        // Порядок моих реакций: новая становится последней. Ноль — значащее
        // значение («моя первая»), поэтому нумерация идёт от максимума уже моих.
        ...(mine ? { chosen_order: nextChosenOrder(agg) } : {}),
      })
    } else {
      if (mine && isChosen(results[i])) return null // эхо своей уже применённой
      results[i] = {
        ...results[i],
        count: results[i].count + 1,
        ...(mine && !isChosen(results[i]) ? { chosen_order: nextChosenOrder(agg) } : {}),
      }
    }
    return withResults(withRecent(agg, emoji, mine ? by : undefined, 'add'), results)
  }

  if (i < 0) return null
  if (mine && !isChosen(results[i])) return null // эхо своего уже применённого снятия
  const next: ReactionCount = { ...results[i], count: results[i].count - 1 }
  if (mine) delete next.chosen_order
  if (next.count <= 0) results.splice(i, 1)
  else results[i] = next
  return withResults(
    withRecent(agg, emoji, mine ? by : undefined, 'remove'),
    mine ? renumberChosen(results) : results,
  )
}

/**
 * Свежие реагировавшие: свой пир первым, дублей нет, не больше трёх.
 *
 * Вектор `recent_reactions` — ТОТ ЖЕ поимённый список реагировавших, урезанный
 * до трёх, и там, где зрителю не положено знать, КТО реагировал, его не
 * существует: у оригинала свой пир дописывается внутри
 * `if(reactions.recent_reactions)` (tweb `appReactionsManager.ts:840-856`), а
 * сам вектор заводится только при `canSeeList` (`:718-725`
 * `recent_reactions: canSeeList ? [] : undefined`, `:836-838`).
 *
 * Права на это два ответа не заводится: спрашивается `canViewReactionsList` —
 * тот же предикат, которым гейтится запрос списка (`useMessageActions`) и
 * аватарки вместо числа в чипе (`components/chat/reactions.ts`). Без гейта свой
 * клик в вещательном канале порождал бы вектор, которого сервер туда не шлёт, и
 * пункт меню `views` мигал бы до прихода кадра (`contextMenu.ts:799`, порт
 * tweb `contextMenu.ts:1256-1257`).
 *
 * РАСХОЖДЕНИЕ, названное намеренно: у оригинала терм здесь шире на
 * `!isBroadcast` (`:718-720`), потому что он ФАБРИКУЕТ отсутствующий флаг
 * `can_see_list` для агрегата, которого сервер ещё не присылал (`:721-730`).
 * Мы флаг не фабрикуем, поэтому на ПЕРВОЙ реакции в группе (агрегата нет —
 * флага нет) свой пир в вектор не попадает: чип покажет число и сменится на
 * аватарку с кадром. Фабрикация флага требует вида чата в воркере и по промаху
 * кэша чатов отвечала бы «не канал» — то есть открывала бы ровно ту течь,
 * которую этот гейт закрывает.
 */
function withRecent(
  agg: MessageReactions | undefined,
  emoji: string,
  by: ReactionClick | undefined,
  action: 'add' | 'remove',
): MessageReactions | undefined {
  if (by === undefined || !canViewReactionsList(agg, by.peerId)) return agg
  const rest = (agg?.recent_reactions ?? []).filter(
    (x) => !(getPeerId(x.peer_id) === by.me && reactionKey(x.reaction) === emoji),
  )
  // Снятие ВЫЧЁРКИВАЕТ строку из вектора, а не заводит его: у оригинала splice
  // тоже стоит под `if(reactions.recent_reactions)` (`:705-711`).
  if (action === 'remove') return agg?.recent_reactions ? { ...agg, recent_reactions: rest } : agg
  const mineEntry = {
    _: 'messagePeerReaction' as const,
    peer_id: { _: 'peerUser' as const, user_id: by.me },
    date: 0,
    reaction: { _: 'reactionEmoji' as const, emoticon: emoji },
  }
  return { ...(agg ?? EMPTY), recent_reactions: [mineEntry, ...rest].slice(0, 3) }
}

/**
 * АБСОЛЮТНЫЙ агрегат из кадра поверх своего выбора.
 *
 * Тело кадра одно на всех получателей и потому помечено `pFlags.min`: моего
 * `chosen_order` в нём нет и быть не может — как нет и моего вклада звёздами
 * (`top_reactors` с `pFlags.my`). Оба сохраняются из предыдущего состояния, всё
 * остальное берётся из кадра как есть.
 */
export function mergeReactions(
  prev: MessageReactions | undefined,
  next: MessageReactions | undefined,
): MessageReactions | undefined {
  if (!next) return undefined
  const chosen = new Map<string, number>()
  for (const c of prev?.results ?? []) {
    if (isChosen(c)) chosen.set(reactionKey(c.reaction), c.chosen_order!)
  }
  const results = next.results.map((c) => {
    const order = chosen.get(reactionKey(c.reaction))
    return order === undefined ? c : { ...c, chosen_order: order }
  })

  // Мой вклад звёздами описывает ПЛАТНЫЙ ЧИП: не стало чипа — не стало и вклада.
  // Иначе агрегат без `reactionPaid` тащил бы за собой `top_reactors`, то есть
  // утверждал бы половину того, чего в нём уже нет.
  const myReactor = paidCount(next) ? (prev?.top_reactors ?? []).find((x) => x.pFlags?.my) : undefined
  const top = next.top_reactors?.some((x) => x.pFlags?.my)
    ? next.top_reactors
    : myReactor
      ? [...(next.top_reactors ?? []), myReactor]
      : next.top_reactors

  if (!results.length) return undefined
  const merged: MessageReactions = { ...next, results }
  if (top?.length) merged.top_reactors = top
  else delete merged.top_reactors
  // `min` — свойство ТЕЛА КАДРА («пер-зрительской части здесь нет»), а не
  // состояния сообщения: слияние её только что вернуло, и оставленный флаг
  // сделал бы слитый агрегат отличным от такого же, собранного локальной
  // дельтой, — то есть каждое эхо своего клика выглядело бы изменением.
  if (merged.pFlags?.min) {
    const { min: _min, ...pFlags } = merged.pFlags
    merged.pFlags = pFlags
  }
  return merged
}

/**
 * Платная ⭐-реакция из ОТВЕТА ручки: и агрегат (`reactionPaid` в `results`), и
 * мой вклад (`messageReactor` с `pFlags.my` в `top_reactors`).
 *
 * Ответ ручки — единственное место, где мой вклад вообще приезжает: в кадре его
 * нет и быть не может (тело одно на всех получателей).
 */
export function setPaidReaction(
  agg: MessageReactions | undefined,
  total: number,
  mine: number,
): MessageReactions | undefined {
  const rest = (agg?.results ?? []).filter((c) => c.reaction._ !== 'reactionPaid')
  const results = total > 0
    ? [{ _: 'reactionCount' as const, reaction: { _: 'reactionPaid' as const }, count: total }, ...rest]
    : rest
  const others = (agg?.top_reactors ?? []).filter((x) => !x.pFlags?.my)
  const top = mine > 0
    ? [...others, { _: 'messageReactor' as const, pFlags: { my: true as const }, count: mine }]
    : others
  if (!results.length && !top.length) return undefined
  const out: MessageReactions = { ...(agg ?? EMPTY), _: 'messageReactions', results }
  if (top.length) out.top_reactors = top
  else delete out.top_reactors
  return out
}

/**
 * Совпадают ли агрегаты по тому, что ВИДНО В ЧИПАХ: состав и порядок чипов,
 * числа, мой выбор, аватарки реагировавших, мой вклад звёздами и
 * `can_see_list` — право, которым ряд решает «аватарки или число».
 *
 * `reactions_as_tags` НЕ сравнивается, хотя поле в модели объявлено: у
 * оригинала им чип рисуется тегом (tweb `components/chat/reactions.ts:149-156`),
 * а у нас его не читает ни один рендерер и не производит бэкенд (прямая
 * оговорка — `backend/internal/domain/mtmessage.go:971`): самочат рисует те же
 * чипы, что любой чат, а имена тегов живут отдельной панелью
 * (`components/conversation/SavedTagsPanel.tsx`). Сравнивать по нему значило
 * бы утверждать, что в чипе видно то, чего в нём нет; вернётся сюда вместе с
 * портом формы чипа-тега.
 *
 * Служебного `pFlags.min` здесь нет намеренно: это свойство ТЕЛА КАДРА, а не
 * состояния сообщения, и в чипе оно не видно ничем.
 *
 * `date` записи `recent_reactions` тоже не сравнивается: в чипе рисуется пир, а
 * не время, и на нашем проводе оно всегда ноль (backend
 * `internal/domain/messagewire.go:296`).
 */
export function sameReactions(a: MessageReactions | undefined, b: MessageReactions | undefined): boolean {
  const ra = a?.results ?? []
  const rb = b?.results ?? []
  if (ra.length !== rb.length) return false
  for (let i = 0; i < ra.length; i++) {
    if (reactionKey(ra[i].reaction) !== reactionKey(rb[i].reaction)) return false
    if (ra[i].count !== rb[i].count || isChosen(ra[i]) !== isChosen(rb[i])) return false
  }
  const pa = a?.recent_reactions ?? []
  const pb = b?.recent_reactions ?? []
  if (pa.length !== pb.length) return false
  for (let i = 0; i < pa.length; i++) {
    if (getPeerId(pa[i].peer_id) !== getPeerId(pb[i].peer_id)) return false
    if (reactionKey(pa[i].reaction) !== reactionKey(pb[i].reaction)) return false
  }
  if (!!a?.pFlags?.can_see_list !== !!b?.pFlags?.can_see_list) return false
  return myPaidStars(a) === myPaidStars(b)
}
