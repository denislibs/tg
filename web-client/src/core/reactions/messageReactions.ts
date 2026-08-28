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
        // значение («моя первая»), поэтому считается по числу уже моих.
        ...(mine ? { chosen_order: myEmoticons(agg).length } : {}),
      })
    } else {
      if (mine && isChosen(results[i])) return null // эхо своей уже применённой
      results[i] = {
        ...results[i],
        count: results[i].count + 1,
        ...(mine && !isChosen(results[i]) ? { chosen_order: myEmoticons(agg).length } : {}),
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
  return withResults(withRecent(agg, emoji, mine ? by : undefined, 'remove'), results)
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

/** Совпадают ли агрегаты по тому, что видно в чипах. */
export function sameReactions(a: MessageReactions | undefined, b: MessageReactions | undefined): boolean {
  const ra = a?.results ?? []
  const rb = b?.results ?? []
  if (ra.length !== rb.length) return false
  for (let i = 0; i < ra.length; i++) {
    if (reactionKey(ra[i].reaction) !== reactionKey(rb[i].reaction)) return false
    if (ra[i].count !== rb[i].count || isChosen(ra[i]) !== isChosen(rb[i])) return false
  }
  return myPaidStars(a) === myPaidStars(b)
}
