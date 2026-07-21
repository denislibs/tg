// applyWebPage: догоняющий кадр web_page_update патчит сообщение карточкой
// превью во всех окнах чата (основное + тред), чужие чаты не трогает.
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'
import { mapMessage, type RawMessage } from '../core/models'

const raw = (id: number, chatId = 5): RawMessage => ({
  id, chat_id: chatId, seq: id, sender_id: 1, type: 'text', text: `m${id}`,
  reply_to_id: null, media_id: null, created_at: '2026-07-01T00:00:00Z',
})

const wp = { siteName: 'Example', title: 'Заголовок', description: 'Описание', url: 'https://example.com', imageUrl: 'https://example.com/og.png' }

describe('messagesStore.applyWebPage', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(winKey(5), {
      msgs: [mapMessage(raw(1)), mapMessage(raw(2))],
      reachedTop: true, reachedBottom: true,
    })
    useMessagesStore.getState().setWindow(winKey(5, 1), {
      msgs: [mapMessage(raw(2))],
      reachedTop: true, reachedBottom: true,
    })
    useMessagesStore.getState().setWindow(winKey(7), {
      msgs: [mapMessage(raw(2, 7))],
      reachedTop: true, reachedBottom: true,
    })
  })

  it('patches the message in every window of the chat', () => {
    useMessagesStore.getState().applyWebPage(5, 2, wp)
    const main = useMessagesStore.getState().byKey[winKey(5)].msgs
    const thread = useMessagesStore.getState().byKey[winKey(5, 1)].msgs
    expect(main.find((m) => m.id === 2)?.webPage).toEqual(wp)
    expect(thread.find((m) => m.id === 2)?.webPage).toEqual(wp)
    // Соседние сообщения и чужой чат не тронуты.
    expect(main.find((m) => m.id === 1)?.webPage).toBeUndefined()
    expect(useMessagesStore.getState().byKey[winKey(7)].msgs[0].webPage).toBeUndefined()
  })

  it('keeps references stable for untouched messages', () => {
    const before = useMessagesStore.getState().byKey[winKey(5)].msgs
    useMessagesStore.getState().applyWebPage(5, 2, wp)
    const after = useMessagesStore.getState().byKey[winKey(5)].msgs
    expect(after[0]).toBe(before[0]) // id 1 не менялся → тот же ref
    expect(after[1]).not.toBe(before[1]) // id 2 получил превью → новый ref
  })

  it('is a no-op for an unknown message', () => {
    const before = useMessagesStore.getState().byKey
    useMessagesStore.getState().applyWebPage(5, 999, wp)
    expect(useMessagesStore.getState().byKey).toBe(before)
  })
})
