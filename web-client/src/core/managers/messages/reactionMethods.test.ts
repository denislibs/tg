// src/core/managers/messages/reactionMethods.test.ts
//
// ПРОВОДКА своего клика по реакции: что именно менеджер отдаёт дельте.
//
// Здесь пинится не арифметика агрегата (её эталон —
// `core/reactions/messageReactions.test.ts`), а то, что владелец SSOT вообще
// СООБЩАЕТ дельте, кто кликнул и где. Пятый параметр `reactionDelta` однажды уже
// сгнил молча: `applyLocalDelta` перестал его передавать, оптимистичный
// `recent_reactions` исчез во всех чатах разом, и ни один из 3850 тестов этого
// не увидел — агрегат покрыт своими тестами, но они вызывают `reactionDelta`
// напрямую и того, что менеджер ей ДАЁТ, оттуда не видно.
import { describe, expect, it } from 'vitest'

import { newMessagesManager } from '../messagesManager'
import { RT } from '../../realtime/events'
import { generateMessageId } from '../../history/messageId'
import { makeRawMessage } from '../../messages/testMessage'
import type { MessageOp } from '../../realtime/messageOps'
import { myEmoticons } from '../../reactions/messageReactions'
import type { MessageReactions, RawMessage } from '../../models'
import type { RestClient } from '../../net/restClient'

const cid = generateMessageId
const ME = 7
/** Личка: ключ диалога это ключ СОБЕСЕДНИКА (положительный). */
const DM = 42
/** Группа и вещательный канал — оба отрицательные; различает их `can_see_list`. */
const CHAT = -100

const like: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
}

function managerWith(peerId: PeerId, reactions?: MessageReactions, premium = false) {
  const wire = { ...makeRawMessage({ id: 2, peerId, fromId: 5, text: 'm2' }), ...(reactions ? { reactions } : {}) }
  // `calls` — что менеджер отправил НА ПРОВОД. Нужен отдельным ответом: правило
  // лимита обещает, что вытеснение стоит клиенту нисколько (весь набор держит
  // сам POST), и проверить это по агрегату нельзя — он одинаков и с лишними
  // запросами, и без них.
  const calls: string[] = []
  const rest = {
    get: async () => ({ messages: [wire as RawMessage], count: 1 }),
    post: async (url: string) => { calls.push(`POST ${url}`); return {} },
    del: async (url: string) => { calls.push(`DELETE ${url}`); return {} },
  } as unknown as RestClient
  const ops: MessageOp[] = []
  const mgr = newMessagesManager({
    rest,
    getMeId: () => ME,
    getMePremium: () => premium,
    broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) },
  })
  return { mgr, ops, calls }
}

/** Агрегат, объявленный окну последней операцией своего клика. */
function declared(ops: MessageOp[]): MessageReactions | undefined {
  const last = ops[ops.length - 1]
  return last && last.op === 'patch' ? (last.fields.reactions as MessageReactions | undefined) : undefined
}

describe('messages.react — свой пир в recent_reactions', () => {
  it('в личке свой клик кладёт себя в вектор ДО ответа сервера', async () => {
    const { mgr, ops } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    expect(declared(ops)?.recent_reactions).toEqual([{
      _: 'messagePeerReaction',
      peer_id: { _: 'peerUser', user_id: ME },
      date: 0,
      reaction: { _: 'reactionEmoji', emoticon: '👍' },
    }])
  })

  it('в группе с правом видеть список — тоже', async () => {
    const { mgr, ops } = managerWith(CHAT, { ...like, pFlags: { can_see_list: true } })
    await mgr.getHistory({ peerId: CHAT, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(CHAT, cid(2), '👍')
    expect(declared(ops)?.recent_reactions?.map((r) => r.peer_id)).toEqual([{ _: 'peerUser', user_id: ME }])
  })

  // Вещательный канал: реакции там анонимны, вектора сервер не шлёт, и пункт
  // меню `views` гейтится ровно `recent_reactions?.length`
  // (`components/chat/contextMenu.ts:799`) — выдумав вектор, свой клик заставил
  // бы пункт мигнуть до прихода кадра.
  it('в вещательном канале вектора не появляется, а чип всё равно ставится', async () => {
    const { mgr, ops } = managerWith(CHAT, like)
    await mgr.getHistory({ peerId: CHAT, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(CHAT, cid(2), '👍')
    const agg = declared(ops)
    expect(agg?.recent_reactions).toBeUndefined()
    expect(agg?.results[0].count).toBe(2)
    expect(agg?.results[0].chosen_order).toBe(0)
  })
})

/** Тело кадра реакций: абсолютный агрегат БЕЗ пер-зрительской части (`min`) —
 *  ровно то, что сервер шлёт всем членам чата, включая автора клика. */
const frame = (peerId: PeerId, results: MessageReactions['results'], recent: PeerId[] = []) => ({
  _: 'updateMessageReactions' as const,
  peer: peerId > 0 ? { _: 'peerUser' as const, user_id: peerId } : { _: 'peerChannel' as const, channel_id: -peerId },
  msg_id: 2,
  reactions: {
    _: 'messageReactions' as const,
    results,
    ...(recent.length ? {
      recent_reactions: recent.map((id) => ({
        _: 'messagePeerReaction' as const,
        peer_id: { _: 'peerUser' as const, user_id: id },
        date: 0,
        reaction: { _: 'reactionEmoji' as const, emoticon: '👍' },
      })),
    } : {}),
    pFlags: { min: true as const },
  },
})

// ЛИМИТ своих реакций (порт tweb appReactionsManager.ts:733-751). Пинится
// РЕЗУЛЬТАТ — что объявлено окну после клика, — а не то, что и сколько раз
// позвалось внутри.
describe('messages.react — лимит своих реакций', () => {
  it('без премиума вторая реакция вытесняет первую', async () => {
    const { mgr, ops } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    ops.length = 0

    await mgr.react(DM, cid(2), '🔥')
    const agg = declared(ops)
    expect(myEmoticons(agg)).toEqual(['🔥'])
    // Чип вытесненной уходит целиком: он держался единственным голосом — моим.
    expect(agg?.results.map((c) => (c.reaction as { emoticon: string }).emoticon)).toEqual(['🔥'])
    // Вытеснение и постановка — ОДНА операция окна: два объявления пересобрали
    // бы ряд реакций дважды.
    expect(ops.length).toBe(1)
  })

  it('с премиумом три уживаются, а четвёртая вытесняет самую старую', async () => {
    const { mgr, ops } = managerWith(DM, undefined, true)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    for (const e of ['❤', '🔥', '🥰']) await mgr.react(DM, cid(2), e)
    expect(myEmoticons(declared(ops))).toEqual(['❤', '🔥', '🥰'])

    await mgr.react(DM, cid(2), '👏')
    expect(myEmoticons(declared(ops))).toEqual(['🔥', '🥰', '👏'])
  })

  // Вытеснение стоит клиенту НИСКОЛЬКО запросов: снятие лишней реакции идёт
  // только в SSOT. У оригинала весь набор едет одним `messages.sendReaction`
  // (appReactionsManager.ts:948-951), у нас серверную половину правила держит
  // сам POST (backend usecase/chat/reaction.go::evictExcessReactions) — DELETE
  // на вытесненную был бы вторым кадром реакции всему чату на один клик.
  it('вытеснение не порождает ни одного лишнего запроса', async () => {
    const { mgr, calls } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    calls.length = 0

    await mgr.react(DM, cid(2), '🔥')
    expect(calls).toEqual([`POST /chats/${DM}/messages/2/reactions`])
  })

  // «ИЗБРАННОЕ»: реакция на своё же сообщение — это ТЕГ (признак `peerId ===
  // myId`, порт tweb contextMenu.ts:1660), а теги наш сервер из-под лимита
  // выводит (backend usecase/chat/reaction.go::isSavedTag). Вытеснив здесь,
  // клиент обещал бы то, чего сервер не делает.
  it('в «Избранном» теги не вытесняются — их лимит не ограничивает', async () => {
    const { mgr, ops } = managerWith(ME)
    await mgr.getHistory({ peerId: ME, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(ME, cid(2), '👍')
    await mgr.react(ME, cid(2), '🔥')
    expect(myEmoticons(declared(ops))).toEqual(['👍', '🔥'])
  })

  it('чужой чип вытеснением не трогается — уходит только мой голос', async () => {
    const { mgr, ops } = managerWith(DM, { ...like, results: [{ ...like.results[0], count: 3 }] })
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    await mgr.react(DM, cid(2), '🔥')
    const agg = declared(ops)
    expect(myEmoticons(agg)).toEqual(['🔥'])
    expect(agg?.results.find((c) => (c.reaction as { emoticon: string }).emoticon === '👍')?.count).toBe(3)
  })
})

// ЭХО СВОЕГО КЛИКА. Кадр реакции сервер шлёт всем членам чата, включая автора
// клика (backend internal/usecase/chat/reaction.go), и пока слияние всегда
// возвращало новый объект, окно получало ВТОРУЮ операцию — то есть ряд реакций
// пересобирался второй раз через 10-130 мс после первого, выбрасывая из
// документа узел чипа с летящим вокруг него эффектом.
describe('messages.cacheReaction — эхо своего клика', () => {
  it('кадр, описывающий уже применённое состояние, не порождает ни одной операции', async () => {
    const { mgr, ops } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    ops.length = 0

    const produced = mgr.cacheReaction(frame(DM, [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }], [ME]))
    expect(produced).toEqual([])
    expect(ops).toEqual([])
  })

  it('кадр с ЧУЖИМ кликом операцию порождает', async () => {
    const { mgr } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')

    const produced = mgr.cacheReaction(frame(DM, [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }], [ME]))
    expect(produced.length).toBe(1)
    expect((produced[0] as { fields: { reactions: MessageReactions } }).fields.reactions.results[0].count).toBe(2)
  })

  // Мой выбор кадр не несёт (`pFlags.min`) — и пропуск обновления не должен его
  // терять: состояние в SSOT остаётся прежним ровно потому, что оно уже верное.
  it('пропущенный кадр не снимает мой chosen_order', async () => {
    const { mgr } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '👍')
    mgr.cacheReaction(frame(DM, [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }], [ME]))

    // Следующий кадр (уже с чужим кликом) читает SSOT — и мой выбор в нём цел.
    const after = mgr.cacheReaction(frame(DM, [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }], [ME]))
    expect(myEmoticons((after[0] as { fields: { reactions: MessageReactions } }).fields.reactions)).toEqual(['👍'])
  })
})
