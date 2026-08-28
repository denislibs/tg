// Пины `dedupAsc` (`core/realtime/messageOps.ts`): список сообщений схлопывается
// по `dedupKey` («побеждает последний вставленный») и сортируется по
// возрастанию номера.
//
// Раньше эти пины стояли на zustand-копии окна (`stores/messagesStore`) и били
// в неё через `setWindow`/`append`/`prepend`/`appendLocal`. Копия снесена вместе
// с React-лентой (этап 7), а функция осталась и работает у живого окна —
// зеркала (`core/history/messagesMirror.ts::putMirrorPage` и `applyOp`).
// Поэтому проверки переписаны на саму функцию, порядок аргументов в них —
// тот же, что у снесённых вызовов:
//   append  = dedupAsc([...окно, ...новые]) — на пересечении побеждает НОВАЯ;
//   prepend = dedupAsc([...новые, ...окно]) — на пересечении побеждает СТАРАЯ.
//
// Чисел в адресе ОДНО (решение Р1): прежде адрес (`id`) и порядок (`seq`) были
// разными полями, и половина пинов проверяла именно их расхождение — такой
// формы больше нет.
import { describe, expect, it } from 'vitest'
import { dedupAsc, dedupKey } from './messageOps'
import { makeMessage } from '../messages/testMessage'
import { generateTempMessageId } from '../history/messageId'
import type { MessageReal, MyMessage } from '../models'

const CHAT = 11

const msg = (id: number, text = `m${id}`): MessageReal =>
  makeMessage({ id, peerId: CHAT, fromId: 1, text, date: 1_750_000_000 })

const real = (m: MyMessage): MessageReal => m as MessageReal
const textOf = (list: MyMessage[], id: number): string => real(list.find((m) => m.id === id)!).message

describe('dedupAsc — дедуп окна по номеру', () => {
  // Что ломается, если гарантия нарушена: если бы Map отдавал приоритет ПЕРВОЙ
  // вставке, в окне осталась бы «старая» версия сообщения — та, что реально
  // пришла с сервера последней, потерялась бы молча.
  it('две версии ОДНОГО номера → остаётся ПОСЛЕДНЯЯ вставленная', () => {
    const msgs = dedupAsc([msg(5, 'first'), msg(5, 'second')])
    expect(msgs).toHaveLength(1)
    expect(real(msgs[0]).message).toBe('second')
  })

  // Что ломается: без дедупа append/prepend с пересекающимся диапазоном дал бы
  // дубли бабла на экране (одно и то же сообщение дважды — например, после
  // reconnect и повторной подгрузки страницы истории).
  it('append/prepend с пересечением → без дублей, порядок по возрастанию номера', () => {
    const window = [msg(3), msg(4), msg(5)]
    // append: новые идут ПОСЛЕ окна, значит на пересечении побеждает новая.
    const appended = dedupAsc([...window, msg(5, 'server-5'), msg(6)])
    // prepend: новые идут ПЕРЕД окном, значит побеждает уже бывшее в окне.
    const both = dedupAsc([msg(1), msg(2), msg(3, 'older-page-3'), ...appended])
    expect(both.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(textOf(both, 5)).toBe('server-5')
    expect(textOf(both, 3)).toBe('m3')
  })

  // Что ломается: одиночная вставка (своя отправка, живое входящее) с уже
  // занятым номером создавала бы дубль-бабл вместо замены.
  it('вставка одного сообщения с занятым номером → замена, а не дубль', () => {
    const msgs = dedupAsc([msg(3, 'old'), msg(3, 'new')])
    expect(msgs).toHaveLength(1)
    expect(real(msgs[0]).message).toBe('new')
  })

  // Что ломается: без сортировки лента отрисовывалась бы вперемешку.
  it('вставка вперемешку → на выходе строго возрастающий номер', () => {
    const ids = dedupAsc([msg(5), msg(1), msg(3)]).map((m) => m.id)
    expect(ids).toEqual([1, 3, 5])
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1])
  })

  // Несущий инвариант 1B.1: пространства ключей не пересекаются — неподтверждённый
  // бабл ключуется по `random_id`, серверное сообщение по номеру. Иначе чужое
  // входящее с соседним номером вытеснило бы бабл из Map без ack/error.
  it('неподтверждённый бабл и серверное сообщение живут рядом', () => {
    const localId = generateTempMessageId(9)
    const pending = makeMessage({ id: localId, peerId: CHAT, fromId: 1, text: 'мой', date: 1_750_000_000 })
    pending.random_id = 'c-1'
    expect(dedupKey(pending)).toBe('c:c-1')
    expect(dedupKey(msg(9))).toBe('s:9')

    const msgs = dedupAsc([msg(9), pending])
    expect(msgs.map((m) => m.id)).toEqual([9, localId])
  })
})
