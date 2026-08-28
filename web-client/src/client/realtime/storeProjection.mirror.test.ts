// Проводка зеркала окон: проектор применяет пачку операций `RT.messageOp` к
// ЕДИНСТВЕННОЙ копии окна на главном потоке — `core/history/messagesMirror`,
// которую синхронно читает императивная лента.
//
// Раньше копий было две (zustand `messagesStore` для React-ленты + зеркало), и
// главным пином здесь было их СХОЖДЕНИЕ. Реактивная копия снесена вместе с
// React-лентой (этап 7), сверять больше не с чем — поэтому те же
// последовательности операций проверяются теперь по ожидаемому содержимому
// зеркала. Предмет остался: одна пачка операций → одно предсказуемое окно.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'
import { mirrorWindow, resetMessagesMirror, winKey } from '../../core/history/messagesMirror'
import type { MessageReal, MyMessage } from '../../core/models'
import { generateMessageId, generateTempMessageId } from '../../core/history/messageId'
import { makeMessage, makeRawMessage } from '../../core/messages/testMessage'
import type { MessageOp } from '../../core/realtime/messageOps'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 50
const THREAD = 60
const ME = 1
const OTHER = 2

/** Номер в КЛИЕНТСКОМ пространстве — окно живёт только в нём. */
const cid = generateMessageId
/** Номер неотправленного бабла: дробь поверх последнего занятого (порт tweb
 *  `generateTempMessageId`); отрицательных номеров больше нет. */
const tmp = (afterId: number) => generateTempMessageId(afterId)

function msg(id: number, over: Partial<MessageReal> = {}): MyMessage {
  return { ...makeMessage({ id, peerId: CHAT, fromId: OTHER, text: `m${id}`, date: 1_755_259_200 }), ...over }
}

const mirrorMsgs = (key: string): MyMessage[] => [...(mirrorWindow(key) ?? [])]

describe('storeProjection — RT.messageOp едет в зеркало главного потока', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    resetMessagesMirror()
  })

  // Что ломается, если проводки нет: зеркало не видит ни одного изменения окна —
  // императивная лента молча перестаёт показывать новые сообщения.
  it('операция доезжает до зеркала', () => {
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(501)) }] })
    expect(mirrorMsgs(winKey(CHAT)).map((m) => m.id)).toEqual([cid(501)])
  })

  // Вся последовательность видов операций разом: наполнение, неотправленный
  // бабл, ошибка, ack (слияние по random_id), ack-then-echo дубль, правка,
  // патч поля, удаление — и то же сообщение во ВТОРОМ окне (тред).
  it('последовательность операций (insert/merge/patch/replace/remove) даёт предсказуемое окно', () => {
    const pending = tmp(cid(3))
    const ops: MessageOp[] = [
      // наполнение окна: обычные входящие
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(1)) },
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(2)) },
      { op: 'insert', key: winKey(CHAT, THREAD), msg: msg(cid(2), { reply_to: { _: 'messageReplyHeader', reply_to_top_id: THREAD } }) },
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(3)) },
      // неотправленный бабл своей отправки
      { op: 'insert', key: winKey(CHAT), msg: msg(pending, { fromId: ME, random_id: 'c-1', localUrl: 'blob:local-1' }) },
      // ошибка отправки
      { op: 'patch', key: winKey(CHAT), msgId: pending, fields: { failed: true } },
      // ack: серверное сообщение сливается с баблом по random_id
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(900), { fromId: ME, random_id: 'c-1' }) },
      // ack-then-echo дубль
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(900), { fromId: ME, random_id: 'c-1' }) },
      // правка витринного поля
      { op: 'replace', key: winKey(CHAT), msg: msg(cid(3), { message: 'изменено' }) },
      // просмотры канала
      { op: 'patch', key: winKey(CHAT), msgId: cid(2), fields: { views: 17 } },
      // удаление
      { op: 'remove', key: winKey(CHAT), msgId: cid(1) },
      // то же сообщение в окне треда
      { op: 'patch', key: winKey(CHAT, THREAD), msgId: cid(2), fields: { views: 17 } },
    ]
    rootScope.dispatchEventSingle(RT.messageOp, { ops })

    const main = mirrorMsgs(winKey(CHAT))
    expect(main.map((m) => m.id)).toEqual([cid(2), cid(3), cid(900)])
    // ack слил серверное сообщение с баблом: локальное превью пережило слияние.
    expect((main.find((m) => m.id === cid(900)) as MessageReal | undefined)?.localUrl).toBe('blob:local-1')
    expect((main.find((m) => m.id === cid(3)) as MessageReal | undefined)?.message).toBe('изменено')
    expect((main.find((m) => m.id === cid(2)) as MessageReal | undefined)?.views).toBe(17)
    // Окно треда — своя копия того же сообщения, патч доехал и туда.
    const thread = mirrorMsgs(winKey(CHAT, THREAD))
    expect(thread.map((m) => m.id)).toEqual([cid(2)])
    expect((thread[0] as MessageReal).views).toBe(17)
  })

  it('пооперационная доставка (кадр за кадром) даёт тот же результат', () => {
    const ops: MessageOp[] = [
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(1)) },
      { op: 'insert', key: winKey(CHAT), msg: msg(tmp(cid(1)), { fromId: ME, random_id: 'c-2' }) },
      { op: 'insert', key: winKey(CHAT), msg: msg(cid(950), { fromId: ME, random_id: 'c-2' }) },
      { op: 'remove', key: winKey(CHAT), msgId: cid(1) },
    ]
    for (const op of ops) rootScope.dispatchEventSingle(RT.messageOp, { ops: [op] })
    expect(mirrorMsgs(winKey(CHAT)).map((m) => m.id)).toEqual([cid(950)])
  })

  // Что ломается: если бы обработчик применял ВСЕ операции к одному (неверному)
  // ключу, а не к `op.key`, сообщение треда попало бы в основное окно чата.
  it('операция с ключом окна треда → в окно треда, основное не заведено', () => {
    rootScope.dispatchEventSingle(RT.messageOp, {
      ops: [{ op: 'insert', key: winKey(CHAT, THREAD), msg: msg(cid(800), {
        reply_to: { _: 'messageReplyHeader', reply_to_top_id: THREAD },
      }) }],
    })
    expect(mirrorMsgs(winKey(CHAT, THREAD)).map((m) => m.id)).toEqual([cid(800)])
    expect(mirrorWindow(winKey(CHAT))).toBeUndefined()
  })

  // Правило «окно правят ТОЛЬКО операции воркера»: сырой кадр `RT.newMessage`
  // едет рядом (звук, уведомление, счётчики), но окна не касается. Раньше здесь
  // же стоял пин «RT.newMessage докладывает превью ответа» — его предмет исчез:
  // `reply_to` стало ССЫЛКОЙ (`messageReplyHeader`), превью строит рендерер.
  it('сырой RT.newMessage окно не правит', () => {
    const evt: NewMessageEvt = {
      _: 'updateNewMessage',
      message: makeRawMessage({ id: 999, peerId: CHAT, fromId: OTHER, text: 'hello', date: 1_755_259_210 }),
    }
    // В реальности RT.messageOp летит первым (см. workerCore.ts:routeNewMessage) —
    // воспроизводим тот же порядок.
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(1)) }] })
    rootScope.dispatchEventSingle(RT.newMessage, evt)
    expect(mirrorMsgs(winKey(CHAT)).map((m) => m.id)).toEqual([cid(1)])
  })

  // Зеркало — порт `apiManagerProxy.mirrors`: в tweb оно отражает всё, что
  // объявил владелец, независимо от открытого чата (фильтрует подписчик —
  // `bubbles.ts` сверяет storageKey/peerId со своим). Пин держит эту границу:
  // окно заводится первым же insert'ом, никакого «сначала откройте чат».
  it('окно заводится первым insert’ом, даже если чат не открыт', () => {
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(999), msg: msg(cid(7), { peerId: 999 }) }] })
    expect(mirrorMsgs(winKey(999)).map((m) => m.id)).toEqual([cid(7)])
  })

  // Что ломается без строки сброса: окна прошлой сессии остаются в зеркале, и
  // лента следующего аккаунта читает синхронно чужую историю.
  it('rt:logging_out стирает окна зеркала', () => {
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg(cid(1)) }] })
    expect(mirrorWindow(winKey(CHAT))).toBeDefined()
    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })
    expect(mirrorWindow(winKey(CHAT))).toBeUndefined()
  })
})
