// «Печатает» — ДВА конструктора, и ключ чата берётся из разных мест: в личном
// чате пир это сам печатающий (`updateUserTyping` ключа пира не несёт вовсе), в
// группе адрес чата и автор — разные параметры (`updateChannelUserTyping`).
//
// Пин держит именно вывод ключа: перепутать эти два места легко, а увидеть
// последствие («печатает» садится не в тот чат) — только глазами.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { generateMessageId } from '../../core/history/messageId'
import { useChatsStore } from '../../stores/chatsStore'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — «печатает»', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => { useChatsStore.setState({ typing: {} }) })

  it('личный чат: ключ чата — сам печатающий', () => {
    rootScope.dispatchEventSingle(RT.typing, {
      _: 'updateUserTyping',
      user_id: 7,
      action: { _: 'sendMessageRecordAudioAction' },
    })

    const chat = useChatsStore.getState().typing[7]
    expect(chat?.[7]?.action).toEqual({ _: 'sendMessageRecordAudioAction' })
  })

  it('группа: ключ чата из channel_id (со знаком), автор — из from_id', () => {
    rootScope.dispatchEventSingle(RT.typing, {
      _: 'updateChannelUserTyping',
      channel_id: 5,
      from_id: { _: 'peerUser', user_id: 9 },
      action: { _: 'sendMessageTypingAction' },
    })

    // Ключ группы отрицательный — тот же вывод, что у getPeerId(peerChannel).
    const chat = useChatsStore.getState().typing[-5]
    expect(chat?.[9]?.action).toEqual({ _: 'sendMessageTypingAction' })
    // В чат с ключом самого канала (положительным) индикатор попасть не должен.
    expect(useChatsStore.getState().typing[5]).toBeUndefined()
  })

  // tweb appProfileManager.ts:1408-1420: печать кладётся ровно в ОДИН ключ
  // `peerId[_threadId]`; threadId — клиентский номер (generateMessageId).
  it('top_msg_id: печать в теме — только в тредовом ключе, ключ чата не задет', () => {
    rootScope.dispatchEventSingle(RT.typing, {
      _: 'updateChannelUserTyping',
      channel_id: 5,
      top_msg_id: 12,
      from_id: { _: 'peerUser', user_id: 9 },
      action: { _: 'sendMessageTypingAction' },
    })

    const state = useChatsStore.getState().typing
    expect(state[`-5_${generateMessageId(12)}`]?.[9]?.action).toEqual({ _: 'sendMessageTypingAction' })
    expect(state[-5]).toBeUndefined()
  })

  it('кадр без top_msg_id не попадает в тредовый ключ', () => {
    rootScope.dispatchEventSingle(RT.typing, {
      _: 'updateChannelUserTyping',
      channel_id: 5,
      from_id: { _: 'peerUser', user_id: 9 },
      action: { _: 'sendMessageTypingAction' },
    })

    const keys = Object.keys(useChatsStore.getState().typing)
    expect(keys).toEqual(['-5'])
  })

  it('личка: updateUserTyping с top_msg_id — тредовый ключ, не ключ чата', () => {
    rootScope.dispatchEventSingle(RT.typing, {
      _: 'updateUserTyping',
      user_id: 7,
      top_msg_id: 3,
      action: { _: 'sendMessageTypingAction' },
    })

    const state = useChatsStore.getState().typing
    expect(state[`7_${generateMessageId(3)}`]?.[7]).toBeDefined()
    expect(state[7]).toBeUndefined()
  })

  it('печать в двух темах одного чата — независимые ключи', () => {
    for (const top of [5, 7]) {
      rootScope.dispatchEventSingle(RT.typing, {
        _: 'updateChannelUserTyping',
        channel_id: 5,
        top_msg_id: top,
        from_id: { _: 'peerUser', user_id: 9 },
        action: { _: 'sendMessageTypingAction' },
      })
    }

    expect(Object.keys(useChatsStore.getState().typing).sort()).toEqual([
      `-5_${generateMessageId(5)}`, `-5_${generateMessageId(7)}`,
    ].sort())
  })

  // TTL тредового ключа гасит именно его (таймер по ключу+автору), ключ чата не трогает;
  // опустевший набор уходит из стора вместе с ключом (tweb appProfileManager.ts:1450-1452).
  it('TTL: каждый ключ гаснет по своему таймеру, опустевший исчезает из стора', () => {
    vi.useFakeTimers()
    try {
      for (const top of [undefined, 12]) {
        rootScope.dispatchEventSingle(RT.typing, {
          _: 'updateChannelUserTyping',
          channel_id: 5,
          ...(top ? { top_msg_id: top } : {}),
          from_id: { _: 'peerUser', user_id: 9 },
          action: { _: 'sendMessageTypingAction' },
        })
        if (top === undefined) vi.advanceTimersByTime(4000)
      }
      // чат поставлен 4 с назад (гаснет через 2 с), тема — только что
      vi.advanceTimersByTime(2500)
      const keys = Object.keys(useChatsStore.getState().typing)
      expect(keys).toEqual([`-5_${generateMessageId(12)}`])
      vi.advanceTimersByTime(4000)
      expect(useChatsStore.getState().typing).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })
})
