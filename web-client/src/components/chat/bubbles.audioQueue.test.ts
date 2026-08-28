// src/components/chat/bubbles.audioQueue.test.ts
//
// ОЧЕРЕДЬ ГОЛОСОВЫХ И КРУЖКОВ ГЛОБАЛЬНОГО ПЛЕЕРА, собранная ИЗ ЖИВОЙ ЛЕНТЫ.
//
// У tweb «что играть дальше» никто не собирает заранее: `AudioElement
// .setTargetsIfNeeded` (audio.ts:815-828) перед запуском сканирует СОСЕДЕЙ по
// DOM (`findMediaTargets`, audio.ts:458-498 — селектор
// `.bubble:not(.webpage) .audio.is-voice, .media-round`, оба в одной очереди —
// `inputMessagesFilterRoundVoice`) и отдаёт их контроллеру
// (`appMediaPlaybackController.setTargets`, :1051-1096). Доиграв, `onEnded`
// (:830-849) шагает по этой очереди — `go(1)`.
//
// Механика очереди у нас портирована и пиньётся у себя
// (`core/audio/mediaPlaybackController.test.ts`, `components/audio.test.ts`),
// а здесь проверяется ровно то, что она СОБИРАЕТСЯ ИЗ ЛЕНТЫ: узлы, которые
// строит `chat/bubbles.ts`, должны попадать в скан — с теми же классами и в том
// же порядке. Это и есть «лента — владелец аудио-бабла».
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDocument, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'

vi.mock('@environment/opusSupport', () => ({ default: true }))
vi.mock('@core/mediaUrl', () => ({
  resolveMediaContentUrl: (id: number) => `https://media/${id}`,
  mediaContentUrl: (id: number) => `https://media/${id}`,
  resolveStreamUrl: (id: number) => `https://media/${id}`,
  primeMediaToken: () => Promise.resolve(),
  hasMediaToken: () => true,
  applyMediaToken: () => {},
  resetMediaToken: () => {},
  subscribeMediaToken: () => () => {},
}))
vi.mock('@core/mediaRead', () => ({ markMediaPlayed: vi.fn() }))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      media: {
        meta: async () => ({ waveform: '' }),
        downloadMediaURL: async (id: number) => `blob:${id}`,
        contentUrl: async (id: number) => `/api/media/${id}/content`,
        streamUrl: async (id: number) => `/api/media/${id}/stream`,
        tokenInfo: async () => ({ token: 'T', expiresAt: Date.now() + 900_000 }),
      },
    },
  }),
}))

type FakeMedia = HTMLMediaElement & { _playing?: boolean, _time?: number, _dur?: number, _ready?: number }

let ChatBubbles: typeof import('./bubbles').default
let mediaPlayback: typeof import('@core/audio/mediaPlaybackController').mediaPlayback
let resetPlayback: typeof import('@core/audio/mediaPlaybackController').resetPlayback
let useAudioStore: typeof import('@stores/audioStore').useAudioStore
let rootScope: typeof import('@lib/rootScope').default
let makeMessage: typeof import('@core/messages/testMessage').makeMessage
let resetMessagesMirror: typeof import('@core/history/messagesMirror').resetMessagesMirror
let resetPeerMirror: typeof import('@core/peerCache').resetPeerMirror
let clearChatPositions: typeof import('@core/chat/chatPositions').clearChatPositions
let useSettingsStore: typeof import('@/settings').useSettingsStore

beforeAll(async () => {
  // Медиа-элементы окружения не играют — прототип подменён предсказуемыми
  // заглушками, дёргающими настоящие события (приём из
  // `core/audio/mediaPlaybackController.test.ts` и `components/audio.test.ts`).
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  const define = (key: string, desc: PropertyDescriptor) =>
    Object.defineProperty(proto, key, { configurable: true, ...desc })
  define('HAVE_CURRENT_DATA', { get() { return 2 } })
  define('readyState', { get(this: FakeMedia) { return this._ready ?? 0 } })
  define('paused', { get(this: FakeMedia) { return !this._playing } })
  define('currentTime', {
    get(this: FakeMedia) { return this._time ?? 0 },
    set(this: FakeMedia, v: number) { this._time = v },
  })
  define('duration', {
    get(this: FakeMedia) { return this._dur ?? 0 },
    set(this: FakeMedia, v: number) { this._dur = v },
  })
  proto.play = function(this: FakeMedia) {
    this._playing = true
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  proto.pause = function(this: FakeMedia) {
    if(!this._playing) return
    this._playing = false
    this.dispatchEvent(new Event('pause'))
  }

  ChatBubbles = (await import('./bubbles')).default
  ;({ mediaPlayback, resetPlayback } = await import('@core/audio/mediaPlaybackController'))
  ;({ useAudioStore } = await import('@stores/audioStore'))
  rootScope = (await import('@lib/rootScope')).default
  ;({ makeMessage } = await import('@core/messages/testMessage'))
  ;({ resetMessagesMirror } = await import('@core/history/messagesMirror'))
  ;({ resetPeerMirror } = await import('@core/peerCache'))
  ;({ clearChatPositions } = await import('@core/chat/chatPositions'))
  ;({ useSettingsStore } = await import('@/settings'))
})

const CHAT = 62

const docMedia = (id: number, mime: string, attributes: DocumentAttribute[]): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({ _: 'document', id, mime_type: mime, size: 4096, attributes }),
})

const voice = (id: number) =>
  docMedia(id, 'audio/ogg', [{ _: 'documentAttributeAudio', duration: 4, pFlags: { voice: true } }])

const round = (id: number) =>
  docMedia(id, 'video/mp4', [{ _: 'documentAttributeVideo', duration: 3, w: 384, h: 384, pFlags: { round_message: true } }])

const message = (id: number, media: MessageMedia) =>
  makeMessage({ id, peerId: CHAT, fromId: 2, text: '', createdAt: '2026-08-20T10:00:00Z', media })

let bubbles: import('./bubbles').default | undefined

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  resetPlayback()
  rootScope.myId = 1
  useSettingsStore.setState({ reduceMotion: true })
})

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
  resetPlayback()
  useSettingsStore.setState({ reduceMotion: false })
})

async function settle(times = 6) {
  for (let i = 0; i < times; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openFeed(messages: ReturnType<typeof message>[]) {
  const container = document.createElement('div')
  container.classList.add('chat')
  const b = new ChatBubbles({
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container,
    bubblesViewport: document.createElement('div'),
  }, {
    messages: {
      getHistory: vi.fn(async () => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  })
  bubbles = b
  // Лента живёт В ДОКУМЕНТЕ: `findMediaTargets` ищет контейнер подъёмом от узла
  // (`findUpClassName(anchor, 'bubbles-inner')`), а не по глобальному запросу.
  document.body.append(b.container)
  await (await b.setPeer())?.promise
  await settle()
  return b
}

const el = (mediaId: number) => mediaPlayback.getMedia(mediaId) as FakeMedia

describe('ChatBubbles — очередь голосовых/кружков собирается из ленты', () => {
  it('клик по голосовому объявляет очередь СОСЕДЕЙ в порядке ленты', async () => {
    const b = await openFeed([message(1, voice(201)), message(2, voice(202)), message(3, voice(203))])

    const first = b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .audio-toggle')!
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    const { queue, index } = useAudioStore.getState()
    expect(queue.map((track) => track.mediaId)).toEqual([201, 202, 203])
    expect(index).toBe(0)
  })

  it('доиграв, плеер сам переходит к следующему голосовому ленты', async () => {
    const b = await openFeed([message(1, voice(211)), message(2, voice(212))])

    const first = b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .audio-toggle')!
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(useAudioStore.getState().track?.mediaId).toBe(211)

    el(211).dispatchEvent(new Event('ended'))
    await settle()

    expect(useAudioStore.getState().track?.mediaId).toBe(212)
    expect(useAudioStore.getState().playing).toBe(true)
    // Узел следующего бабла узнал о запуске СВОИМ элементом, а не опросом
    // контроллера (tweb: «играю ли я» — это `media.paused`).
    const second = b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="2"] .audio-toggle')!
    expect(second.classList.contains('playing')).toBe(true)
  })

  it('кружок ленты стоит в ТОЙ ЖЕ очереди, что голосовые (tweb inputMessagesFilterRoundVoice)', async () => {
    const b = await openFeed([message(1, voice(221)), message(2, round(222)), message(3, voice(223))])

    const first = b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .audio-toggle')!
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(useAudioStore.getState().queue.map((track) => track.mediaId)).toEqual([221, 222, 223])
  })

  it('музыка — СВОЯ очередь: голосовые в неё не попадают (tweb inputMessagesFilterMusic)', async () => {
    const music = (id: number) =>
      docMedia(id, 'audio/mpeg', [{ _: 'documentAttributeAudio', duration: 100, title: 't', performer: 'p' }])
    const b = await openFeed([message(1, voice(231)), message(2, music(232)), message(3, music(233))])

    const musicToggle = b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="2"] .audio-toggle')!
    musicToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(useAudioStore.getState().queue.map((track) => track.mediaId)).toEqual([232, 233])
  })
})
