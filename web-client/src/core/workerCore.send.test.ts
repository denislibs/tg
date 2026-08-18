// Пин ПРОВОДКИ отправки в workerCore.ts: транспорт (`conn.sendMessage`), аплоад
// (`media.upload`), отмена аплоада, typing-пинг и канал прогресса приходят в
// messagesManager ИНЪЕКЦИЕЙ при сборке — именно этим снято кольцо импортов
// messagesManager ↔ connectionManager, из-за которого отправка раньше жила в
// realtime.ts. Сами по себе sendText/sendFile покрыты у владельца
// (managers/messages/pending.test.ts); здесь предмет другой — что пять стрелок
// в createWorkerCore() реально соединены с conn/media, а не забыты.
//
// Приём — тот же, что в workerCore.pendingFrames.test.ts: частичный vi.mock
// connectionManager (перехватить исходящие кадры и сам объект conn) плюс
// частичный vi.mock mediaManager (перехватить upload/cancelUpload).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps, SendArgs } from './realtime/connectionManager'

const sentFrames: SendArgs[] = []
const typings: { chatId: number; action: string }[] = []
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => ({
      ...actual.newConnectionManager(deps),
      sendMessage: (m: SendArgs) => { sentFrames.push(m) },
      sendTyping: (chatId: number, action: string) => { typings.push({ chatId, action }) },
    }),
  }
})

const uploaded: unknown[] = []
const cancelled: string[] = []
const upload = vi.fn(async (a: unknown) => { uploaded.push(a); return 909 })
vi.mock('./managers/mediaManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/mediaManager')>()
  return {
    ...actual,
    newMediaManager: (deps: Parameters<typeof actual.newMediaManager>[0]) => ({
      ...actual.newMediaManager(deps),
      upload,
      cancelUpload: async (id: string) => { cancelled.push(id) },
    }),
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import type { MessageOp } from './realtime/messageOps'

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

/** Поднимает воркер с подключённой вкладкой; отдаёт менеджеры воркера и всё,
 *  что вкладке прилетело служебными каналами. */
function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const ops: MessageOp[] = []
  const progress: { id: string; loaded: number; total: number; done?: boolean }[] = []
  tab.on('rt:message_op', (p) => ops.push(...(p as { ops: MessageOp[] }).ops))
  tab.on('media:upload_progress', (p) => progress.push(p as { id: string; loaded: number; total: number; done?: boolean }))
  return { core, ops, progress }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  sentFrames.length = 0
  typings.length = 0
  uploaded.length = 0
  cancelled.length = 0
  upload.mockClear()
})

describe('createWorkerCore(): отправка соединена с транспортом и аплоадом', () => {
  // Что ломается: без стрелки `send` менеджер собирается, sendText отвечает
  // { ok: true }, бабл появляется — и НИ ОДНО сообщение не уходит на сервер.
  it('messages.sendText → кадр в conn.sendMessage', async () => {
    const { core } = boot()

    await core.registry.messages.sendText({ chatId: 1, text: 'hi', clientMsgId: 'c1' })

    expect(sentFrames).toEqual([{
      chatId: 1, text: 'hi', clientMsgId: 'c1',
      // Пакет параметров отправки всегда проставляет свои поля — см. sendingParams.ts.
      threadRootId: null, replyToId: null, replyToPeerId: null, replyQuoteText: null,
      replyQuoteOffset: null, silent: false, effect: null, sendAsChatId: null,
    }])
  })

  // Что ломается: без стрелки `upload` байты никуда не уходят, и кадр медиа
  // либо не уйдёт вовсе, либо уйдёт без media_id (сообщение без картинки).
  it('messages.sendFile → media.upload, затем ОДИН кадр уже с media_id', async () => {
    const { core } = boot()

    const r = await core.registry.messages.sendFile({
      chatId: 1, clientMsgId: 'c2', senderId: 5, file: new Blob(['x'], { type: 'image/jpeg' }),
      type: 'photo', fileName: 'p.jpg', width: 10, height: 20, isMedia: true, uploadAction: 'upload_photo',
    })

    expect(r).toEqual({ mediaId: 909 })
    expect(uploaded).toHaveLength(1)
    expect(uploaded[0]).toMatchObject({ mime: 'image/jpeg', fileName: 'p.jpg', progressId: 'c2' })
    expect(sentFrames).toHaveLength(1)
    expect(sentFrames[0]).toMatchObject({ chatId: 1, clientMsgId: 'c2', type: 'photo', mediaId: 909 })
  })

  // Что ломается: без стрелки `sendTyping` собеседник не видит «отправляет
  // фото…» всё время аплоада (tweb sendMessageUpload*Action).
  it('sendFile пингует typing выбранным действием', async () => {
    const { core } = boot()

    await core.registry.messages.sendFile({
      chatId: 7, clientMsgId: 'c3', senderId: 5, file: new Blob(['x']), type: 'document', uploadAction: 'upload_file',
    })

    expect(typings[0]).toEqual({ chatId: 7, action: 'upload_file' })
  })

  // Что ломается: без стрелки `uploadProgress` кольцо загрузки на бабле не
  // появляется и не гаснет — вкладка своего канала для этого больше не держит.
  it('границы аплоада доезжают до вкладки каналом media:upload_progress', async () => {
    const { core, progress } = boot()

    await core.registry.messages.sendFile({
      chatId: 1, clientMsgId: 'c4', senderId: 5, file: new Blob(['x']), type: 'photo', isMedia: true,
    })

    expect(progress[0]).toMatchObject({ id: 'c4', total: 1 })
    expect(progress[progress.length - 1]).toMatchObject({ id: 'c4', done: true })
  })

  // Что ломается: без стрелки `cancelUpload` крестик на бабле убирал бы бабл,
  // но байты продолжали бы литься в сеть до конца файла.
  it('messages.cancelPending рвёт аплоад в mediaManager', async () => {
    const { core } = boot()

    await core.registry.messages.cancelPending({ clientMsgId: 'c5' })

    expect(cancelled).toEqual(['c5'])
  })
})
