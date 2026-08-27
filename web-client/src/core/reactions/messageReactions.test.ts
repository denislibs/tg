import { describe, expect, it } from 'vitest'

import type { MessageReactions } from '../models'
import {
  hasMyReaction, isChosen, mergeReactions, myEmoticons, myPaidStars, reactionDelta,
  recentOf, sameReactions, setPaidReaction, totalReactions,
} from './messageReactions'

const emoji = (emoticon: string) => ({ _: 'reactionEmoji' as const, emoticon })
const count = (emoticon: string, n: number, chosen?: number) => ({
  _: 'reactionCount' as const, reaction: emoji(emoticon), count: n,
  ...(chosen !== undefined ? { chosen_order: chosen } : {}),
})
const agg = (over: Partial<MessageReactions> = {}): MessageReactions =>
  ({ _: 'messageReactions', results: [], ...over })

describe('агрегат реакций', () => {
  // «Моя» — это НАЛИЧИЕ chosen_order, а не его истинность: ноль там значит
  // «моя первая», и склеивать его с «не моя» нельзя. Ровно на этом ломалась
  // плоская проекция с `mine: boolean`.
  it('chosen_order = 0 это «моя», а не «не моя»', () => {
    expect(isChosen(count('👍', 1, 0))).toBe(true)
    expect(isChosen(count('👍', 1))).toBe(false)
    expect(hasMyReaction(agg({ results: [count('👍', 1, 0)] }), '👍')).toBe(true)
  })

  // Вектор `recent_reactions` ОДИН на агрегат: чип выбирает из него свои.
  // Автором реакции может быть и канал — отсюда знаковый ключ, а не user_id.
  it('recentOf выводит знаковые ключи пиров и фильтрует по самой реакции', () => {
    const a = agg({
      results: [count('👍', 2), count('🔥', 1)],
      recent_reactions: [
        { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 7 }, date: 0, reaction: emoji('👍') },
        { _: 'messagePeerReaction', peer_id: { _: 'peerChannel', channel_id: 8 }, date: 0, reaction: emoji('👍') },
        { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 9 }, date: 0, reaction: emoji('🔥') },
      ],
    })
    expect(recentOf(a, emoji('👍'))).toEqual([7, -8])
    expect(recentOf(a, emoji('🔥'))).toEqual([9])
  })

  // Платный чип лежит в ТОМ ЖЕ векторе, поэтому и в сумму входит наравне.
  it('totalReactions считает платный чип вместе с эмодзи-чипами', () => {
    expect(totalReactions(agg({
      results: [count('👍', 2), { _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 50 }],
    }))).toBe(52)
  })

  it('мой вклад звёздами берётся из top_reactors с pFlags.my', () => {
    expect(myPaidStars(agg({ top_reactors: [
      { _: 'messageReactor', count: 100 },
      { _: 'messageReactor', pFlags: { my: true }, count: 30 },
    ] }))).toBe(30)
  })
})

// Ключ ЧАТА в кликах ниже: личка это ключ собеседника (положительный), группа и
// вещательный канал — отрицательные, и различает их только флаг `can_see_list`.
const DM = 42
const CHAT = -100

describe('reactionDelta — свой клик', () => {
  it('первая реакция получает chosen_order 0 и свой пир в recent', () => {
    const next = reactionDelta(undefined, '👍', 'add', true, { me: 7, peerId: DM })!
    expect(next.results).toEqual([{ _: 'reactionCount', reaction: emoji('👍'), count: 1, chosen_order: 0 }])
    expect(recentOf(next, emoji('👍'))).toEqual([7])
  })

  // Порядок моих реакций — то, ради чего `mine` перестала быть булевой.
  it('вторая моя реакция получает следующий порядковый номер', () => {
    const first = reactionDelta(undefined, '👍', 'add', true)!
    const second = reactionDelta(first, '🔥', 'add', true)!
    expect(myEmoticons(second)).toEqual(['👍', '🔥'])
  })

  it('снятие убирает chosen_order и сам чип, когда счётчик обнулился', () => {
    const withMine = reactionDelta(undefined, '👍', 'add', true, { me: 7, peerId: DM })!
    const removed = reactionDelta(withMine, '👍', 'remove', true, { me: 7, peerId: DM })
    expect(removed).toBeUndefined()
  })

  it('чужая реакция считается, но моей не становится', () => {
    const next = reactionDelta(agg({ results: [count('👍', 1, 0)] }), '👍', 'add', false)!
    expect(next.results[0].count).toBe(2)
    expect(isChosen(next.results[0])).toBe(true) // моя осталась моей
  })

  // Эхо своего уже применённого действия — no-op, чтобы вызывающий не
  // пересобирал сообщение зря.
  it('эхо своего уже применённого действия возвращает null', () => {
    expect(reactionDelta(agg({ results: [count('👍', 1, 0)] }), '👍', 'add', true)).toBeNull()
    expect(reactionDelta(agg({ results: [count('👍', 1)] }), '👍', 'remove', true)).toBeNull()
  })
})

// Вектор `recent_reactions` — тот же поимённый список реагировавших, урезанный
// до трёх. В вещательном канале его не существует (реакции там анонимны, сервер
// вектора не шлёт), и оптимистика не вправе дописать туда себя: пункт меню
// `views` гейтится ровно термом `recent_reactions?.length`
// (`components/chat/contextMenu.ts:799`, порт tweb `contextMenu.ts:1256-1257`),
// и мигнул бы после своего клика до прихода кадра.
//
// Эталон: tweb `appReactionsManager.ts:718-725` строит локальный агрегат как
// `recent_reactions: canSeeList ? [] : undefined`, а свой пир дописывает внутри
// `if(reactions.recent_reactions)` (`:836-856`).
describe('reactionDelta — оптимистичный recent гейтится правом видеть список', () => {
  it('в вещательном канале свой клик вектора не порождает', () => {
    const next = reactionDelta(undefined, '👍', 'add', true, { me: 7, peerId: CHAT })!
    expect(next.recent_reactions).toBeUndefined()
    expect(recentOf(next, emoji('👍'))).toEqual([])
    // Сам чип при этом ставится: гейт закрывает поимённый список, а не реакцию.
    expect(next.results[0].count).toBe(1)
    expect(isChosen(next.results[0])).toBe(true)
  })

  it('в группе с правом (can_see_list) — порождает, свой пир первым', () => {
    const before = agg({ results: [count('👍', 1)], pFlags: { can_see_list: true } })
    const next = reactionDelta(before, '👍', 'add', true, { me: 7, peerId: CHAT })!
    expect(recentOf(next, emoji('👍'))).toEqual([7])
  })

  it('в личке — порождает без всякого флага: право там договаривает ключ пира', () => {
    const next = reactionDelta(undefined, '👍', 'add', true, { me: 7, peerId: DM })!
    expect(recentOf(next, emoji('👍'))).toEqual([7])
  })

  // Снятие ВЫЧЁРКИВАЕТ строку, а не заводит вектор: пустой `recent_reactions: []`
  // — то же утверждение «список есть», просто нулевой длины. У оригинала splice
  // тоже стоит под `if(reactions.recent_reactions)` (tweb `:705-711`).
  it('снятие не заводит вектор там, где его не было', () => {
    const before = agg({ results: [count('👍', 2, 0)] })
    const next = reactionDelta(before, '👍', 'remove', true, { me: 7, peerId: DM })!
    expect(next.recent_reactions).toBeUndefined()
  })

  it('снятие в личке вычёркивает свой пир из вектора', () => {
    const withMine = reactionDelta(agg({ results: [count('👍', 1)] }), '👍', 'add', true, { me: 7, peerId: DM })!
    const next = reactionDelta(withMine, '👍', 'remove', true, { me: 7, peerId: DM })!
    expect(recentOf(next, emoji('👍'))).toEqual([])
  })
})

describe('mergeReactions — абсолютный агрегат кадра', () => {
  // Тело кадра одно на всех получателей (`pFlags.min`): моего выбора в нём нет
  // и быть не может.
  it('мой chosen_order сохраняется, счётчики берутся из кадра', () => {
    const prev = agg({ results: [count('👍', 1, 0)] })
    const frame = agg({ results: [count('👍', 5), count('🔥', 2)] })
    const next = mergeReactions(prev, frame)!
    expect(next.results[0].count).toBe(5)
    expect(isChosen(next.results[0])).toBe(true)
    expect(isChosen(next.results[1])).toBe(false)
  })

  it('мой вклад звёздами переживает кадр', () => {
    const prev = agg({ top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 30 }] })
    const frame = agg({
      results: [{ _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 50 }],
      top_reactors: [{ _: 'messageReactor', count: 20 }],
    })
    expect(myPaidStars(mergeReactions(prev, frame))).toBe(30)
  })

  it('пустой агрегат кадра снимает реакции целиком', () => {
    expect(mergeReactions(agg({ results: [count('👍', 1)] }), undefined)).toBeUndefined()
  })
})

describe('setPaidReaction — ответ ручки', () => {
  // Ответ ручки — единственное место, где мой вклад вообще приезжает.
  it('кладёт чип reactionPaid и мой вклад, не трогая эмодзи-чипы', () => {
    const next = setPaidReaction(agg({ results: [count('👍', 1, 0)] }), 50, 30)!
    expect(next.results.map((c) => c.reaction._)).toEqual(['reactionPaid', 'reactionEmoji'])
    expect(myPaidStars(next)).toBe(30)
    expect(isChosen(next.results[1])).toBe(true)
  })
})

describe('sameReactions', () => {
  it('различает счётчик, состав и мой вклад звёздами', () => {
    expect(sameReactions(agg({ results: [count('👍', 1)] }), agg({ results: [count('👍', 1)] }))).toBe(true)
    expect(sameReactions(agg({ results: [count('👍', 1)] }), agg({ results: [count('👍', 2)] }))).toBe(false)
    expect(sameReactions(agg({ results: [count('👍', 1)] }), agg({ results: [count('👍', 1, 0)] }))).toBe(false)
    expect(sameReactions(
      agg({ top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 1 }] }),
      agg({ top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 2 }] }),
    )).toBe(false)
  })
})
