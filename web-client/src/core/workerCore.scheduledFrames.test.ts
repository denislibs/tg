// Пин ПРОВОДКИ кадров ленты отложенных в workerCore.ts::dispatch:
// `updateNewScheduledMessage`/`updateDeleteScheduledMessages` применяет владелец
// хранилища отложенных (`messages.applyNewScheduledMessage`/
// `applyDeleteScheduledMessages`, порт tweb `onUpdateNewScheduledMessage`/
// `onUpdateDeleteScheduledMessages`, appMessagesManager.ts:11773-11815).
// Без этих двух строк лента отложенных второго устройства не видит ни постановки,
// ни публикации — механика хранилища покрыта у владельца
// (`managers/messagesManager.test.ts`), здесь предмет — что кадр до него доходит.
//
// Приём — тот же, что в workerCore.geoLiveFrame.test.ts: частичные vi.mock
// connectionManager (перехват onFrame) и messagesManager (шпионы владельца).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import { makeRawMessage } from './messages/testMessage'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

const applyNewScheduledMessage = vi.fn()
const applyDeleteScheduledMessages = vi.fn()
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: Parameters<typeof actual.newMessagesManager>[0]) => ({
      ...actual.newMessagesManager(deps),
      applyNewScheduledMessage,
      applyDeleteScheduledMessages,
    }),
  }
})

import { createWorkerCore } from './workerCore'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  applyNewScheduledMessage.mockClear()
  applyDeleteScheduledMessages.mockClear()
})

describe('createWorkerCore(): кадры ленты отложенных применяет владелец хранилища', () => {
  it('scheduled_new → messages.applyNewScheduledMessage', () => {
    createWorkerCore()
    const frame = {
      _: 'updateNewScheduledMessage',
      message: makeRawMessage({ id: 3, peerId: 1, fromId: 1, text: 'потом', createdAt: '2026-08-01T00:00:00Z' }),
    }
    capturedConnDeps!.onFrame('scheduled_new', frame)
    expect(applyNewScheduledMessage).toHaveBeenCalledWith(frame)
  })

  it('scheduled_delete → messages.applyDeleteScheduledMessages', () => {
    createWorkerCore()
    const frame = { _: 'updateDeleteScheduledMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [3], sent_messages: [7] }
    capturedConnDeps!.onFrame('scheduled_delete', frame)
    expect(applyDeleteScheduledMessages).toHaveBeenCalledWith(frame)
  })
})
