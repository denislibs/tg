// Пин ПРОВОДКИ в workerCore.ts для Ф-6 f6-bots: кадр журнала `bot_commands`
// (updateBotCommands) доходит вкладкам событием rootScope `bot_commands`
// {peerId, botId, commands} — tweb `onUpdateBotCommands`
// (appProfileManager.ts:1560-1569) берёт ключ пира из `update.peer` и бота из
// `update.bot_id`. Сырой rt-кадр дальше не идёт, карточка не перечитывается.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  return { core, tab: new SuperMessagePort(epTab) }
}

const settle = async () => {
  for (let i = 0; i < 10; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): updateBotCommands', () => {
  const cmds = [{ _: 'botCommand', command: 'start', description: 'Начать' }]

  it('личка: bot_commands {peerId бота, botId, commands}', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    const rt: unknown[] = []
    tab.on('bot_commands', (p) => got.push(p))
    tab.on('rt:bot_commands', (p) => rt.push(p))

    capturedConnDeps!.onFrame('bot_commands', {
      _: 'updateBotCommands', peer: { _: 'peerUser', user_id: 42 }, bot_id: 42, commands: cmds,
    })
    await settle()

    expect(got).toEqual([{ peerId: 42, botId: 42, commands: cmds }])
    expect(rt).toEqual([])
  })

  it('группа: peerId — ключ чата (peerChannel, отрицательный)', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    tab.on('bot_commands', (p) => got.push(p))

    capturedConnDeps!.onFrame('bot_commands', {
      _: 'updateBotCommands', peer: { _: 'peerChannel', channel_id: 5 }, bot_id: 42, commands: [],
    })
    await settle()

    expect(got).toEqual([{ peerId: -5, botId: 42, commands: [] }])
  })
})
