// Проводка реестра документов в createWorkerCore() (норма CLAUDE.md «Тесты»):
// `docs.getDoc` — порт `appDocsManager.getDoc`, его зовёт предпросмотр стикера
// (`components/stickerViewer.ts`) по `data-doc-id` ячейки. Документ, который
// воркер получил ответом менеджера (здесь — набор стикеров), обязан находиться
// по id через RPC вкладки.
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const DOC_ID = 880011

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/sticker-sets/duck')) {
      return new Response(JSON.stringify({
        set: { _: 'stickerSet', id: 7, title: 'Duck', short_name: 'duck', count: 1 },
        documents: [{
          _: 'document', id: DOC_ID, mime_type: 'image/webp', size: 1,
          attributes: [{ _: 'documentAttributeSticker', alt: '🦆', stickerset: { _: 'inputStickerSetID', id: 7 } }],
        }],
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): docs.getDoc — документ по id для вкладки', () => {
  it('документ из ответа менеджера стикеров находится по RPC, неизвестный id — нет', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)

    await tab.invoke('manager', { name: 'stickers', method: 'getStickerSet', args: [{ shortName: 'duck' }] })

    const doc = await tab.invoke('manager', { name: 'docs', method: 'getDoc', args: [DOC_ID] })
    expect(doc).toMatchObject({ id: DOC_ID, type: 'sticker', stickerEmojiRaw: '🦆' })
    expect(await tab.invoke('manager', { name: 'docs', method: 'getDoc', args: [DOC_ID + 1] })).toBeUndefined()
  })
})
