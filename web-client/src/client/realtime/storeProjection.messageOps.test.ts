// Stage 1B.2 (Task 4): проектор переигрывает операции воркера (RT.messageOp)
// вместо самостоятельного разбора кадра RT.newMessage. Гейт-паттерн
// (registerStoreProjection один раз в beforeAll + dispatchEventSingle) — как в
// storeProjection.pending.test.ts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import type { MessageReal, MyMessage } from '../../core/models'
import { generateMessageId, generateTempMessageId } from '../../core/history/messageId'
import { makeMessage, makeRawMessage } from '../../core/messages/testMessage'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 50
const THREAD = 60
const ME = 1
const OTHER = 2

function bubbles(key: string) {
  return useMessagesStore.getState().byKey[key]?.msgs ?? []
}

/** Номер в КЛИЕНТСКОМ пространстве — окно живёт только в нём. */
const cid = generateMessageId

function msg(id: number, over: Partial<MessageReal> = {}): MyMessage {
  return {
    ...makeMessage({ id, peerId: CHAT, fromId: OTHER, text: `m${id}`, date: 1_754_827_200 }),
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
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(501)) }] })
    expect(bubbles(winKey(CHAT)).map((m) => m.id)).toEqual([cid(501)])
  })

  // Что ломается: если бы applyOps не делал слияние с оптимистикой по random_id
  // (напр. вызывал бы «сырую» вставку без applyOp), эхо своей отправки легло бы
  // ВТОРЫМ элементом рядом с оптимистичным баблом — дубль на экране, вместо
  // одного элемента с серверным номером и сохранённым random_id/localUrl.
  it('insert сливается с оптимистикой по random_id — один элемент, localUrl сохранён', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    // Неотправленный бабл кладёт операция владельца; localUrl приезжает на нём
    // же обычным полем (blob-URL минтит воркер в messages.sendFile). Номер у
    // него ДРОБНЫЙ — назначен клиентом (`generateTempMessageId`).
    st.appendLocal(winKey(CHAT), msg(generateTempMessageId(cid(0)), {
      fromId: ME, message: 'photo', random_id: 'c-op', localUrl: 'blob:local-1',
    }))
    const echo = msg(cid(700), { fromId: ME, message: 'photo', random_id: 'c-op' })
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: echo }] })
    const list = bubbles(winKey(CHAT))
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cid(700))
    expect(list[0].random_id).toBe('c-op')
    expect((list[0] as MessageReal).localUrl).toBe('blob:local-1')
  })

  // Что ломается: если бы applyOp('insert') не делал ack-then-echo дедуп по id
  // (та же семантика, что была в applyIncoming), повторная insert-операция с уже
  // сверенным id создала бы дубль-бабл вместо no-op.
  it('ack-then-echo: сначала операция ack, затем insert с тем же id → без дубля', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    // ack от владельца — это insert уже сверенного сообщения на месте бабла.
    st.appendLocal(winKey(CHAT), msg(generateTempMessageId(cid(0)), { fromId: ME, message: 'hi', random_id: 'c-ack' }))
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(900), { fromId: ME, message: 'hi', random_id: 'c-ack' }) }],
    })
    expect(bubbles(winKey(CHAT))).toHaveLength(1)
    const echo = msg(cid(900), { fromId: ME, message: 'hi', random_id: 'c-ack' })
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: echo }] })
    const list = bubbles(winKey(CHAT))
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cid(900))
  })

  // Что ломается: если бы APPLY[RT.messageOp] применял ВСЕ операции к одному
  // (неверному) ключу, а не к op.key, тред-сообщение попало бы не в то окно —
  // либо в основное вместо треда, либо вообще потерялось бы.
  it('операция с ключом окна треда → сообщение в окне треда, основное не тронуто', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT, THREAD), { msgs: [], reachedTop: true, reachedBottom: true })
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT, THREAD), msg: msg(cid(800), {
        reply_to: { _: 'messageReplyHeader', reply_to_top_id: THREAD },
      }) }],
    })
    expect(bubbles(winKey(CHAT, THREAD)).map((m) => m.id)).toEqual([cid(800)])
    expect(useMessagesStore.getState().byKey[winKey(CHAT)]).toBeUndefined()
  })

  // Требование задачи: applyIncoming остаётся публичным API стора (тесты им
  // пользуются), но обработчик RT.newMessage больше не должен его звать — это
  // единственный путь вставки/дедупа теперь у applyOps (через RT.messageOp).
  //
  // Прежде рядом стоял ещё один тест — «RT.newMessage докладывает превью
  // ответа». Его предмет ИСЧЕЗ: `reply_to` стало ССЫЛКОЙ
  // (`messageReplyHeader`), превью строит рендерер, разрешив номер в своём
  // окне, и точечного `replace` на главном потоке (единственного исключения из
  // правила «окно правят только операции воркера») больше нет — вместе с
  // исключением в web-client/CLAUDE.md.
  it('applyIncoming НЕ вызывается на RT.newMessage', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    const spy = vi.spyOn(useMessagesStore.getState(), 'applyIncoming')
    const evt: NewMessageEvt = {
      _: 'updateNewMessage',
      message: {
        ...makeRawMessage({ id: 999, peerId: CHAT, fromId: OTHER, text: 'hello', date: 1_754_827_210 }),
      },
    }
    // В реальности RT.messageOp летит первым (см. workerCore.ts:routeNewMessage) —
    // воспроизводим тот же порядок.
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(999)) }] })
    rootScope.dispatchEventSingle(RT.newMessage, evt)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})