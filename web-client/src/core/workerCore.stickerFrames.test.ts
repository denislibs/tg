// Пин ПРОВОДКИ в workerCore.ts для Ф-6 f6-stickers: кадры журнала своих
// устройств доходят вкладкам событиями rootScope (tweb appStickersManager.ts:80-88,
// appGifsManager.ts:21-29), а не rt-именем каталога.
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

describe('createWorkerCore(): стикеры и GIF своих устройств', () => {
  const stubFetch = (body: unknown) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    return calls
  }

  it('updateNewStickerSet → stickers_installed с набором', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    const rt: unknown[] = []
    tab.on('stickers_installed', (p) => got.push(p))
    tab.on('rt:new_sticker_set', (p) => rt.push(p))
    const set = { _: 'stickerSet', id: 5, title: 'Набор', short_name: 'pack', count: 0 }

    capturedConnDeps!.onFrame('stickers_new_set', {
      _: 'updateNewStickerSet',
      stickerset: { _: 'messages.stickerSet', set, packs: [], keywords: [], documents: [] },
    })
    await settle()

    expect(got).toEqual([set])
    expect(rt).toEqual([])
  })

  it('updateRecentStickers / updateFavedStickers → перечитать и stickers_updated', async () => {
    const { tab } = boot()
    const calls = stubFetch({ stickers: [] })
    const got: unknown[] = []
    tab.on('stickers_updated', (p) => got.push(p))

    capturedConnDeps!.onFrame('stickers_recent', { _: 'updateRecentStickers' })
    capturedConnDeps!.onFrame('stickers_faved', { _: 'updateFavedStickers' })
    await settle()

    expect(calls.some((u) => u.endsWith('/stickers/recent'))).toBe(true)
    expect(calls.some((u) => u.endsWith('/stickers/faved'))).toBe(true)
    expect(got).toEqual(expect.arrayContaining([
      { type: 'recent', stickers: [] },
      { type: 'faved', stickers: [] },
    ]))
  })

  it('updateSavedGifs → перечитать и gifs_updated', async () => {
    const { tab } = boot()
    const calls = stubFetch({ gifs: [] })
    const got: unknown[] = []
    tab.on('gifs_updated', (p) => got.push(p))

    capturedConnDeps!.onFrame('saved_gifs', { _: 'updateSavedGifs' })
    await settle()

    expect(calls.some((u) => u.endsWith('/gifs/saved'))).toBe(true)
    expect(got).toEqual([[]])
  })
})
