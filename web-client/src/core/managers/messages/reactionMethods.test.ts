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

function managerWith(peerId: PeerId, reactions?: MessageReactions) {
  const wire = { ...makeRawMessage({ id: 2, peerId, fromId: 5, text: 'm2' }), ...(reactions ? { reactions } : {}) }
  const rest = {
    get: async () => ({ messages: [wire as RawMessage], count: 1 }),
    post: async () => ({}),
    del: async () => ({}),
  } as unknown as RestClient
  const ops: MessageOp[] = []
  const mgr = newMessagesManager({
    rest,
    getMeId: () => ME,
    broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) },
  })
  return { mgr, ops }
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
