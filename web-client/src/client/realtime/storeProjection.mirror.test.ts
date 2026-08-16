// Проводка зеркала окон (этап «лента на императивном DOM», шаг 1): проектор
// применяет ОДНУ пачку операций к обеим копиям окна — реактивной (zustand, для
// React) и синхронной (core/history/messagesMirror, для императивной ленты).
// Главный пин — схождение копий: он краснеет раньше, чем на зеркало сядет лента.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import { mirrorWindow, resetMessagesMirror } from '../../core/history/messagesMirror'
import type { Message } from '../../core/models'
import type { MessageOp } from '../../core/realtime/messageOps'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 50
const THREAD = 60
const ME = 1
const OTHER = 2

function msg(over: Partial<Message> & { id: number; seq: number }): Message {
  return {
    chatId: CHAT, senderId: OTHER, type: 'text', text: `m${over.seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-15T12:00:00Z', threadRootId: null,
    ...over,
  }
}

// Открыть окно в zustand-копии: React-лента заводит его до фетча страницы
// (beginLoad). Зеркало окно не заводит заранее — оно кормится ТОЛЬКО потоком
// операций и заводит окно первым же insert'ом. Чтобы копии были сравнимы,
// содержимое обеим даёт один и тот же поток операций (ниже).
const openWindow = (key: string) => useMessagesStore.getState().beginLoad(key)

const storeMsgs = (key: string) => useMessagesStore.getState().byKey[key]?.msgs ?? []

describe('storeProjection — RT.messageOp едет и в зеркало главного потока', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    resetMessagesMirror()
  })

  // Что ломается, если проводки нет: зеркало не видит ни одного изменения окна —
  // императивная лента (этап 2) молча перестаёт показывать новые сообщения.
  it('операция доезжает до зеркала, а не только до стора', () => {
    openWindow(winKey(CHAT))
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 501, seq: 1 }) }] })
    expect((mirrorWindow(winKey(CHAT)) ?? []).map((m) => m.id)).toEqual([501])
  })

  // ГЛАВНЫЙ ПИН этапа: одна и та же последовательность операций обязана дать
  // одинаковое содержимое в обеих копиях. Разъезд копий — тот самый класс
  // дефекта, про который «Владение фактами» в web-client/CLAUDE.md (второй
  // независимый вывод одного факта).
  it('копии сходятся на всей последовательности операций (insert/merge/patch/replace/remove)', () => {
    openWindow(winKey(CHAT))
    openWindow(winKey(CHAT, THREAD))

    const ops: MessageOp[] = [
      // наполнение окна: обычные входящие
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 1, seq: 1 }) },
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 2, seq: 2 }) },
      { op: 'insert', key: winKey(CHAT, THREAD), msg: msg({ id: 2, seq: 2, threadRootId: THREAD }) },
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 3, seq: 3 }) },
      // неотправленный бабл своей отправки
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: -1, seq: 4, senderId: ME, clientId: 'c-1', localUrl: 'blob:local-1' }) },
      // ошибка отправки
      { op: 'patch', key: winKey(CHAT), msgId: -1, fields: { failed: true } },
      // ack: серверное сообщение сливается с баблом по clientId
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 900, seq: 5, senderId: ME, clientId: 'c-1' }) },
      // ack-then-echo дубль
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 900, seq: 5, senderId: ME, clientId: 'c-1' }) },
      // правка витринного поля
      { op: 'replace', key: winKey(CHAT), msg: msg({ id: 3, seq: 3, text: 'изменено' }) },
      // просмотры канала
      { op: 'patch', key: winKey(CHAT), msgId: 2, fields: { views: 17 } },
      // удаление
      { op: 'remove', key: winKey(CHAT), msgId: 1 },
      // то же сообщение в окне треда
      { op: 'patch', key: winKey(CHAT, THREAD), msgId: 2, fields: { views: 17 } },
    ]
    rootScope.dispatchEventSingle(RT.messageOp, { ops })

    expect(mirrorWindow(winKey(CHAT))).toEqual(storeMsgs(winKey(CHAT)))
    expect(mirrorWindow(winKey(CHAT, THREAD))).toEqual(storeMsgs(winKey(CHAT, THREAD)))
    // Осмысленность сверки: копии не «сошлись пустыми».
    expect(storeMsgs(winKey(CHAT)).map((m) => m.id)).toEqual([2, 3, 900])
    expect(storeMsgs(winKey(CHAT)).find((m) => m.id === 900)?.localUrl).toBe('blob:local-1')
  })

  it('копии сходятся и при пооперационной доставке (кадр за кадром)', () => {
    openWindow(winKey(CHAT))
    const ops: MessageOp[] = [
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 1, seq: 1 }) },
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: -2, seq: 2, senderId: ME, clientId: 'c-2' }) },
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 950, seq: 3, senderId: ME, clientId: 'c-2' }) },
      { op: 'remove', key: winKey(CHAT), msgId: 1 },
    ]
    for (const op of ops) {
      rootScope.dispatchEventSingle(RT.messageOp, { ops: [op] })
      expect(mirrorWindow(winKey(CHAT))).toEqual(storeMsgs(winKey(CHAT)))
    }
    expect(storeMsgs(winKey(CHAT)).map((m) => m.id)).toEqual([950])
  })

  // Единственное СТРУКТУРНОЕ расхождение копий, и оно намеренное: zustand-копия
  // существует ради React и держит только окна, которые React открыл (гейт
  // `!byKey[op.key]` в messagesStore.applyOps), а зеркало — порт
  // apiManagerProxy.mirrors, которое в tweb отражает всё объявленное владельцем
  // независимо от открытого чата (фильтрует подписчик: bubbles.ts сверяет
  // storageKey/peerId со своим). Пин держит именно эту границу: если её
  // случайно «выровняют» гейтом, зеркало перестанет знать про чаты, которые
  // лента ещё не открыла, — и этап 2 получит пустое окно на переключении чата.
  it('окно, не открытое React-лентой: стор его игнорирует, зеркало — заводит', () => {
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(999), msg: msg({ id: 7, seq: 7, chatId: 999 }) }] })
    expect(useMessagesStore.getState().byKey[winKey(999)]).toBeUndefined()
    expect((mirrorWindow(winKey(999)) ?? []).map((m) => m.id)).toEqual([7])
  })

  // Что ломается без строки сброса: окна прошлой сессии остаются в зеркале, и
  // лента следующего аккаунта читает синхронно чужую историю.
  it('rt:logging_out стирает окна зеркала', () => {
    rootScope.dispatchEventSingle(RT.messageOp, { ops: [{ op: 'insert', key: winKey(CHAT), msg: msg({ id: 1, seq: 1 }) }] })
    expect(mirrorWindow(winKey(CHAT))).toBeDefined()
    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })
    expect(mirrorWindow(winKey(CHAT))).toBeUndefined()
  })
})
