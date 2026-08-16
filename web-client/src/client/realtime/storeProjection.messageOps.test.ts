// Stage 1B.2 (Task 4): проектор переигрывает операции воркера (RT.messageOp)
// вместо самостоятельного разбора кадра RT.newMessage. Гейт-паттерн
// (registerStoreProjection один раз в beforeAll + dispatchEventSingle) — как в
// storeProjection.pending.test.ts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import type { Message } from '../../core/models'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 50
const THREAD = 60
const ME = 1
const OTHER = 2

function bubbles(key: string) {
  return useMessagesStore.getState().byKey[key]?.msgs ?? []
}

function msg(over: Partial<Message> & { id: number; seq: number }): Message {
  return {
    chatId: CHAT, senderId: OTHER, type: 'text', text: `m${over.seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-10T12:00:00Z', threadRootId: null,
    ...over,
  }
}

describe('storeProjection — RT.messageOp переигрывается поверх окна', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
  })

  // Что ломается, если гарантия нарушена: если бы APPLY[RT.messageOp] не звал
  // applyOps (или звал не тот стор-метод), операция воркера не попадала бы в
  // окно вовсе — сообщение не появилось бы на экране без ручного applyIncoming.
  it('insert-операция → сообщение появилось в основном окне', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 501, seq: 1 }) }] })
    expect(bubbles(winKey(CHAT)).map((m) => m.id)).toEqual([501])
  })

  // Что ломается: если бы applyOps не делал слияние с оптимистикой по clientId
  // (напр. вызывал бы «сырую» вставку без applyOp), эхо своей отправки легло бы
  // ВТОРЫМ элементом рядом с оптимистичным баблом — дубль на экране, вместо
  // одного элемента с серверным id и сохранённым clientId/localUrl.
  it('insert сливается с оптимистикой по clientId — один элемент, localUrl сохранён', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    // Неотправленный бабл кладёт операция владельца; localUrl приезжает на нём
    // же обычным полем (blob-URL минтит воркер в messages.sendFile).
    st.appendLocal(winKey(CHAT), msg({ id: -1, seq: 1, senderId: ME, type: 'photo', text: 'photo', clientId: 'c-op', localUrl: 'blob:local-1' }))
    const echo = msg({ id: 700, seq: 5, senderId: ME, type: 'photo', text: 'photo', clientId: 'c-op' })
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: echo }] })
    const list = bubbles(winKey(CHAT))
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(700)
    expect(list[0].clientId).toBe('c-op')
    expect(list[0].localUrl).toBe('blob:local-1')
  })

  // Что ломается: если бы applyOp('insert') не делал ack-then-echo дедуп по id
  // (та же семантика, что была в applyIncoming), повторная insert-операция с уже
  // сверенным id создала бы дубль-бабл вместо no-op.
  it('ack-then-echo: сначала операция ack, затем insert с тем же id → без дубля', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    // ack от владельца — это insert уже сверенного сообщения на месте бабла.
    st.appendLocal(winKey(CHAT), msg({ id: -1, seq: 1, senderId: ME, text: 'hi', clientId: 'c-ack' }))
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 900, seq: 50, senderId: ME, text: 'hi', clientId: 'c-ack' }) }],
    })
    expect(bubbles(winKey(CHAT))).toHaveLength(1)
    const echo = msg({ id: 900, seq: 50, senderId: ME, text: 'hi', clientId: 'c-ack' })
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: echo }] })
    const list = bubbles(winKey(CHAT))
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(900)
    expect(list[0].seq).toBe(50)
  })

  // Что ломается: если бы APPLY[RT.messageOp] применял ВСЕ операции к одному
  // (неверному) ключу, а не к op.key, тред-сообщение попало бы не в то окно —
  // либо в основное вместо треда, либо вообще потерялось бы.
  it('операция с ключом окна треда → сообщение в окне треда, основное не тронуто', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT, THREAD), { msgs: [], reachedTop: true, reachedBottom: true })
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT, THREAD), msg: msg({ id: 800, seq: 3, threadRootId: THREAD }) }],
    })
    expect(bubbles(winKey(CHAT, THREAD)).map((m) => m.id)).toEqual([800])
    expect(useMessagesStore.getState().byKey[winKey(CHAT)]).toBeUndefined()
  })

  // Требование задачи: applyIncoming остаётся публичным API стора (тесты им
  // пользуются), но обработчик RT.newMessage больше не должен его звать — это
  // единственный путь вставки/дедупа теперь у applyOps (через RT.messageOp).
  it('applyIncoming НЕ вызывается на RT.newMessage', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    const spy = vi.spyOn(useMessagesStore.getState(), 'applyIncoming')
    const evt: NewMessageEvt = {
      chat_id: CHAT, msg_id: 999, seq: 9, sender_id: OTHER, type: 'text', text: 'hello',
      media_id: null, created_at: '2026-08-10T12:00:10Z',
    }
    // В реальности RT.messageOp летит первым (см. workerCore.ts:routeNewMessage) —
    // воспроизводим тот же порядок, чтобы окно уже содержало сообщение к
    // моменту RT.newMessage (иначе резолв превью ответа отдельного теста ниже
    // не нашёл бы вставленное сообщение).
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 999, seq: 9 }) }] })
    rootScope.dispatchEventSingle(RT.newMessage, evt)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  // Резолв превью ответа (не покрыт операцией — в кадре только reply_to_id, не
  // текст/тип/автор оригинала): RT.newMessage после RT.messageOp докладывает
  // .replyTo на уже вставленное сообщение, найдя оригинал в загруженном окне.
  it('RT.newMessage докладывает превью ответа на уже вставленное операцией сообщение', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [msg({ id: 1, seq: 1, senderId: OTHER, text: 'original' })], reachedTop: true, reachedBottom: true })
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 2, seq: 2, replyToId: 1 }) }],
    })
    const evt: NewMessageEvt = {
      chat_id: CHAT, msg_id: 2, seq: 2, sender_id: OTHER, type: 'text', text: 'reply',
      media_id: null, created_at: '2026-08-10T12:00:10Z', reply_to_id: 1,
    }
    rootScope.dispatchEventSingle(RT.newMessage, evt)
    const inserted = bubbles(winKey(CHAT)).find((m) => m.id === 2)
    expect(inserted?.replyTo?.msgId).toBe(1)
    expect(inserted?.replyTo?.text).toBe('original')
  })
})
