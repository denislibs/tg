// Пины `dedupAsc` (core/realtime/messageOps.ts): окно схлопывает список по
// НОМЕРУ через Map («побеждает последний вставленный») и сортирует по его
// возрастанию.
//
// Чисел стало ОДНО (решение Р1): прежде адрес (`id`) и порядок (`seq`) были
// разными полями, и половина этих пинов проверяла именно их расхождение —
// «два сообщения с одним seq и разными id». Такой формы больше не существует,
// поэтому пины переписаны на то, что осталось: побеждает последняя вставленная
// версия ОДНОГО И ТОГО ЖЕ номера, порядок строго по номеру.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'
import { makeMessage } from '../core/messages/testMessage'
import type { MessageReal, MyMessage } from '../core/models'

const CHAT = 11

const msg = (id: number, text = `m${id}`): MessageReal =>
  makeMessage({ id, peerId: CHAT, fromId: 1, text, date: 1_750_000_000 })

const real = (m: MyMessage): MessageReal => m as MessageReal

function bubbles() {
  return useMessagesStore.getState().byKey[winKey(CHAT)].msgs
}

describe('messagesStore: пины дедупа окна по номеру (dedupAsc)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
  })

  // Что ломается, если гарантия нарушена: если бы Map отдавал приоритет ПЕРВОЙ
  // вставке, в окне после setWindow осталась бы «старая» версия сообщения —
  // та, что реально пришла с сервера последней, потерялась бы молча.
  it('setWindow: две версии ОДНОГО номера → остаётся ПОСЛЕДНЯЯ вставленная', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT), {
      msgs: [msg(5, 'first'), msg(5, 'second')], reachedTop: true, reachedBottom: true,
    })
    const msgs = bubbles()
    expect(msgs).toHaveLength(1)
    expect(real(msgs[0]).message).toBe('second')
  })

  // Что ломается: без дедупа append/prepend с пересекающимся диапазоном дал бы
  // дубли бабла на экране (одно и то же сообщение дважды — например, после
  // reconnect и повторной подгрузки страницы истории).
  it('append/prepend с пересечением → без дублей, порядок по возрастанию номера', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(3), msg(4), msg(5)], reachedTop: false, reachedBottom: true })
    // append: dedupAsc([...w.msgs, ...msgs]) — новые идут ПОСЛЕ окна, значит на
    // пересечении побеждает новая версия (append несёт более свежую).
    store.append(winKey(CHAT), [msg(5, 'server-5'), msg(6)], true)
    // prepend: dedupAsc([...msgs, ...w.msgs]) — новые идут ПЕРЕД окном, значит
    // на пересечении побеждает уже бывшее в окне (обратная асимметрия).
    store.prepend(winKey(CHAT), [msg(1), msg(2), msg(3, 'older-page-3')], true)
    const msgs = bubbles()
    expect(msgs.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(real(msgs.find((m) => m.id === 5)!).message).toBe('server-5')
    expect(real(msgs.find((m) => m.id === 3)!).message).toBe('m3')
  })

  // Что ломается: appendLocal вставляет одно сообщение; без дедупа повторная
  // вставка с уже занятым номером создавала бы дубль-бабл вместо замены.
  it('appendLocal с уже существующим номером → замена, а не дубль', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(3, 'old')], reachedTop: true, reachedBottom: true })
    store.appendLocal(winKey(CHAT), msg(3, 'new'))
    const msgs = bubbles()
    expect(msgs).toHaveLength(1)
    expect(real(msgs[0]).message).toBe('new')
  })

  // Что ломается: без сортировки лента отрисовывалась бы вперемешку.
  it('вставка вперемешку → на выходе строго возрастающий номер', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(5), msg(1), msg(3)], reachedTop: true, reachedBottom: true })
    const ids = bubbles().map((m) => m.id)
    expect(ids).toEqual([1, 3, 5])
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1])
  })
})
