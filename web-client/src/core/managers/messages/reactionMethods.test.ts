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
import type { Chat } from '../../peers/peer'

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

/** `limit` — то, что вернул бы конфиг приложения (`reactions_user_max_*`): 1 без подписки, 3 с подпиской;
 *  `null` — конфига нет. */
function managerWith(peerId: PeerId, reactions?: MessageReactions, limit: number | null = 1) {
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
    getReactionsLimit: async () => limit ?? undefined,
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
    const { mgr, ops } = managerWith(DM, undefined, 3)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    for (const e of ['❤', '🔥', '🥰']) await mgr.react(DM, cid(2), e)
    expect(myEmoticons(declared(ops))).toEqual(['❤', '🔥', '🥰'])

    await mgr.react(DM, cid(2), '👏')
    expect(myEmoticons(declared(ops))).toEqual(['🔥', '🥰', '👏'])
  })

  // Число берётся из конфига приложения, а не из зашитой константы: лимит 2 (в
  // зашитых 1/3 такого нет) пускает две реакции, третья вытесняет старейшую.
  it('лимит приходит из конфига: при 2 две уживаются, третья вытесняет первую', async () => {
    const { mgr, ops } = managerWith(DM, undefined, 2)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    for (const e of ['❤', '🔥']) await mgr.react(DM, cid(2), e)
    expect(myEmoticons(declared(ops))).toEqual(['❤', '🔥'])

    await mgr.react(DM, cid(2), '🥰')
    expect(myEmoticons(declared(ops))).toEqual(['🔥', '🥰'])
  })

  // Конфига нет (первый запуск без сети) — числа нет, локально никого не
  // вытесняем: сервер вытеснит сам, кадр приведёт ряд к его составу.
  it('конфига нет — локального вытеснения нет', async () => {
    const { mgr, ops } = managerWith(DM, undefined, null)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.react(DM, cid(2), '❤')
    await mgr.react(DM, cid(2), '🔥')
    expect(myEmoticons(declared(ops))).toEqual(['❤', '🔥'])
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

// Порт tweb onUpdateMessageReactions (:10552-10604), часть про бейдж ❤:
// спрашивается ДО применения кадра, решает по `recent_reactions[].pFlags.unread`
// кадра против прежнего состояния сообщения.
describe('messages.unreadReactionsChange', () => {
  const peerReaction = (unread: boolean) => ({
    _: 'messagePeerReaction' as const,
    ...(unread ? { pFlags: { unread: true as const } } : {}),
    peer_id: { _: 'peerUser' as const, user_id: 9 }, date: 0,
    reaction: { _: 'reactionEmoji' as const, emoticon: '👍' },
  })
  const evt = (peerId: PeerId, msgId: number, reactions: MessageReactions) =>
    ({ _: 'updateMessageReactions' as const, peer: { _: 'peerUser' as const, user_id: peerId }, msg_id: msgId, reactions })
  const withRecent = (unread: boolean | null): MessageReactions =>
    ({ ...like, ...(unread === null ? {} : { recent_reactions: [peerReaction(unread)] }) })
  /** Сообщение 2 — МОЁ (`out`), с уже лежащим агрегатом `prev`. */
  function mine(prev?: MessageReactions) {
    const wire = { ...makeRawMessage({ id: 2, peerId: DM, fromId: ME, out: true, text: 'моё' }), ...(prev ? { reactions: prev } : {}) }
    const rest = { get: async () => ({ messages: [wire as RawMessage], count: 1 }) } as unknown as RestClient
    return newMessagesManager({ rest, getMeId: () => ME })
  }

  it('сообщения в памяти нет — перечитать строку', async () => {
    const mgr = mine()
    expect(mgr.unreadReactionsChange(evt(DM, 2, withRecent(true)))).toBe('reload')
  })

  it('на моём сообщении появилась непрочитанная — true, прочитана — false', async () => {
    const fresh = mine()
    await fresh.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    expect(fresh.unreadReactionsChange(evt(DM, 2, withRecent(true)))).toBe(true)

    const unread = mine(withRecent(true))
    await unread.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    expect(unread.unreadReactionsChange(evt(DM, 2, withRecent(false)))).toBe(false)
    expect(unread.unreadReactionsChange(evt(DM, 2, withRecent(true)))).toBeUndefined()
  })

  // У оригинала `isUnread` здесь `undefined`, и modifyCachedMentionsAndSave
  // такой знак пропускает (:9345-9347) — бейдж правит строка с сервера.
  it('кадр без recent_reactions у непрочитанного — бейдж не трогается', async () => {
    const mgr = mine(withRecent(true))
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    expect(mgr.unreadReactionsChange(evt(DM, 2, withRecent(null)))).toBeUndefined()
  })

  it('чужое сообщение — бейдж не трогается', async () => {
    const { mgr } = managerWith(DM)
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    expect(mgr.unreadReactionsChange(evt(DM, 2, withRecent(true)))).toBeUndefined()
  })
  // min-кадр (общее тело всем участникам, кадр правки) флага `unread` не несёт.
  // Без переноса флага из прежнего состояния он читался бы как «прочитано» —
  // −1 у автора на чужой кадр.
  it('min-кадр без unread у непрочитанного — бейдж не трогается', async () => {
    const mgr = mine(withRecent(true))
    await mgr.getHistory({ peerId: DM, offsetId: 0, addOffset: 0, limit: 40 })
    const frame = { ...withRecent(false), pFlags: { min: true as const } }
    expect(mgr.unreadReactionsChange(evt(DM, 2, frame))).toBeUndefined()
  })

  // Кадр реакции в группе уходит КАЖДОМУ участнику, и min-кадр бейджа не
  // двигает: перечитывать строку ради него — запрос на участника.
  it('min-кадр по сообщению не в памяти — строку не перечитывать', () => {
    const mgr = mine()
    const frame = { ...withRecent(false), pFlags: { min: true as const } }
    expect(mgr.unreadReactionsChange(evt(DM, 2, frame))).toBeUndefined()
  })
})

// Порт tweb `appMessagesManager.readMessages` (:9519-9612) и `readMentions`
// (:9614-9650). Увиденное содержимое: упоминания уходят в `readMessageContents`
// (WS `read_media`), а при горящем бейдже («@» или ❤ — `hadUnreadMentions`/
// `hadUnreadReactions`, :9564-9566) следом идёт `messages.readMentions|
// readReactions` с темой форума; ответ `affectedHistory` двигает курсор
// (`updatePts`) и обнуляет счётчик ТОГО, что вернул бы `getAnyDialog(peerId,
// threadId)` — темы или диалога. Родителя ответ не трогает.
describe('messages.readMessages / readMentions', () => {
  const unreadLike: MessageReactions = {
    ...like,
    recent_reactions: [{
      _: 'messagePeerReaction', pFlags: { unread: true },
      peer_id: { _: 'peerUser', user_id: 9 }, date: 0,
      reaction: { _: 'reactionEmoji', emoticon: '👍' },
    }],
  }
  const GROUP = -100
  const FORUM = -50
  const forumChat = { _: 'channel', id: 50, title: 'Ф', pFlags: { megagroup: true, forum: true } } as unknown as Chat
  const mention = { mentioned: true, media_unread: true } as const

  interface Spies {
    posts: string[]
    markMediaRead: [number, number[]][]
    localFrames: unknown[]
    cleared: [number, number | undefined, boolean][]
    pts: [number, number][]
  }
  async function setup(opts: {
    peerId: PeerId
    raw: Record<string, unknown>
    badge: { mentions: number; reactions: number } | undefined
    replies?: { _?: string; pts: number; pts_count: number; offset: number }[]
  }) {
    const spies: Spies = { posts: [], markMediaRead: [], localFrames: [], cleared: [], pts: [] }
    const replies = [...(opts.replies ?? [{ pts: 11, pts_count: 1, offset: 0 }])]
    const wire = { ...makeRawMessage({ id: 2, peerId: opts.peerId, fromId: 9, out: false, text: 'm' }), ...opts.raw }
    const rest = {
      get: async () => ({ messages: [wire as RawMessage], count: 1 }),
      post: async (url: string) => { spies.posts.push(url); return { _: 'messages.affectedHistory', ...(replies.shift() ?? { pts: 0, pts_count: 0, offset: 0 }) } },
    } as unknown as RestClient
    const badges: { peerId: number; threadId: number | undefined }[] = []
    const mgr = newMessagesManager({
      rest,
      getMeId: () => ME,
      getPeer: (id) => (id === FORUM ? forumChat : undefined),
      getUnreadBadge: (peerId, threadId) => { badges.push({ peerId, threadId }); return opts.badge },
      clearUnreadBadge: (peerId, threadId, isReaction) => { spies.cleared.push([peerId, threadId, isReaction]) },
      applyLocalPts: (pts, count) => { spies.pts.push([pts, count]) },
      markMediaRead: (peerId, ids) => { spies.markMediaRead.push([peerId, ids]) },
      applyLocalMediaRead: (frame) => { spies.localFrames.push(frame) },
    })
    await mgr.getHistory({ peerId: opts.peerId, offsetId: 0, addOffset: 0, limit: 40 })
    return { mgr, spies, badges }
  }

  it('увидено непрочитанное упоминание, «@» горит: read_media и POST mentions/read', async () => {
    const { mgr, spies } = await setup({ peerId: GROUP, raw: { pFlags: mention }, badge: { mentions: 1, reactions: 0 } })
    await mgr.readMessages(GROUP, [cid(2)])
    expect(spies.markMediaRead).toEqual([[GROUP, [2]]])
    expect(spies.posts).toEqual([`/chats/${GROUP}/mentions/read`])
    expect(spies.localFrames).toHaveLength(1) // processLocalUpdate(updateReadMessagesContents)
    expect(spies.pts).toEqual([[11, 1]])
    expect(spies.cleared).toEqual([[GROUP, undefined, false]])
  })

  it('«@» уже не горит — read_media уходит, readMentions нет', async () => {
    const { mgr, spies } = await setup({ peerId: GROUP, raw: { pFlags: mention }, badge: { mentions: 0, reactions: 0 } })
    await mgr.readMessages(GROUP, [cid(2)])
    expect(spies.markMediaRead).toEqual([[GROUP, [2]]])
    expect(spies.posts).toEqual([])
  })

  it('увидено моё сообщение с непрочитанной реакцией, ❤ горит: POST reactions/read и обнуление ❤', async () => {
    const { mgr, spies } = await setup({ peerId: DM, raw: { out: true, pFlags: { out: true }, reactions: unreadLike }, badge: { mentions: 0, reactions: 1 } })
    await mgr.readMessages(DM, [cid(2)])
    expect(spies.posts).toEqual([`/chats/${DM}/reactions/read`])
    expect(spies.markMediaRead).toEqual([]) // реакция — не содержимое
    expect(spies.cleared).toEqual([[DM, undefined, true]])
  })

  it('❤ не горит или непрочитанных реакций нет — запроса нет', async () => {
    const off = await setup({ peerId: DM, raw: { pFlags: { out: true }, reactions: unreadLike }, badge: { mentions: 0, reactions: 0 } })
    await off.mgr.readMessages(DM, [cid(2)])
    expect(off.spies.posts).toEqual([])
    const none = await setup({ peerId: DM, raw: { pFlags: { out: true }, reactions: like }, badge: { mentions: 0, reactions: 3 } })
    await none.mgr.readMessages(DM, [cid(2)])
    expect(none.spies.posts).toEqual([])
  })

  it('форум: тема берётся из сообщения — гейт и запрос по теме, обнуляется тема, не родитель', async () => {
    const { mgr, spies, badges } = await setup({
      peerId: FORUM,
      raw: { pFlags: mention, reply_to: { _: 'messageReplyHeader', pFlags: { forum_topic: true }, reply_to_msg_id: 10 } },
      badge: { mentions: 2, reactions: 0 },
      replies: [{ pts: 13, pts_count: 3, offset: 0 }],
    })
    await mgr.readMessages(FORUM, [cid(2)])
    expect(badges[0]).toEqual({ peerId: FORUM, threadId: cid(10) })
    expect(spies.posts).toEqual([`/chats/${FORUM}/mentions/read?top_msg_id=10`])
    expect(spies.pts).toEqual([[13, 3]])
    expect(spies.cleared).toEqual([[FORUM, cid(10), false]])
  })

  it('General форума: top_msg_id = 1', async () => {
    const { mgr, spies } = await setup({ peerId: FORUM, raw: { pFlags: mention }, badge: { mentions: 1, reactions: 0 } })
    await mgr.readMessages(FORUM, [cid(2)])
    expect(spies.posts).toEqual([`/chats/${FORUM}/mentions/read?top_msg_id=1`])
  })

  it('pts_count = 0 — местный updatePts не применяется, счётчик всё равно обнуляется', async () => {
    const { mgr, spies } = await setup({ peerId: GROUP, raw: { pFlags: mention }, badge: { mentions: 1, reactions: 0 }, replies: [{ pts: 5, pts_count: 0, offset: 0 }] })
    await mgr.readMessages(GROUP, [cid(2)])
    expect(spies.pts).toEqual([])
    expect(spies.cleared).toEqual([[GROUP, undefined, false]])
  })

  it('offset > 0 — запрос повторяется, обнуление один раз в конце', async () => {
    const { mgr, spies } = await setup({
      peerId: GROUP, raw: { pFlags: mention }, badge: { mentions: 1, reactions: 0 },
      replies: [{ pts: 5, pts_count: 1, offset: 1 }, { pts: 6, pts_count: 1, offset: 0 }],
    })
    await mgr.readMentions(GROUP)
    expect(spies.posts).toEqual([`/chats/${GROUP}/mentions/read`, `/chats/${GROUP}/mentions/read`])
    expect(spies.pts).toEqual([[5, 1], [6, 1]])
    expect(spies.cleared).toEqual([[GROUP, undefined, false]])
  })

  it('упоминание и реакция вместе: оба follow-up, у каждого свой счётчик', async () => {
    const { mgr, spies } = await setup({
      peerId: GROUP, raw: { pFlags: { ...mention, out: true }, reactions: unreadLike }, badge: { mentions: 1, reactions: 1 },
      replies: [{ pts: 5, pts_count: 1, offset: 0 }, { pts: 6, pts_count: 1, offset: 0 }],
    })
    await mgr.readMessages(GROUP, [cid(2)])
    expect([...spies.posts].sort((a, b) => a.localeCompare(b))).toEqual([`/chats/${GROUP}/mentions/read`, `/chats/${GROUP}/reactions/read`])
    expect(spies.cleared.map((c) => c[2]).sort((a, b) => Number(a) - Number(b))).toEqual([false, true])
  })
})
