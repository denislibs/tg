// Пины РЕНДЕРА ДОКУМЕНТОВ во вкладках `AppSearchSuper` — файлы, музыка,
// голосовые и кружки (порт tweb `src/components/appSearchSuper.ts:940-962`,
// `processDocumentFilter`, и развилка `:1143-1170`).
//
// Предмет проверок — ЧТО ОКАЗАЛОСЬ В DOM и ЧТО ИГРАЕТ ПЛЕЕР, а не с какими
// аргументами позван враппер: три вкладки обслуживает один рендерер, и
// различия между ними (подпись временем у файла, отправитель у голосового,
// `audio-48` у звука) — это различия в узлах, их и сверяем.
//
// Окружение — как в `audio.test.ts`: медиа-элементы платформы не играют, их
// прототип подменён заглушками, дёргающими настоящие события.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { mediaPlayback, resetPlayback } from '@core/audio/mediaPlaybackController'
import { saveMessageMedia, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import { getMessageKind } from '@core/messages/messageKind'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { MyMessage } from '@core/models'
import rootScope from '@lib/rootScope'
import type { LangPackKey } from '@lib/langPack'
import { useAudioStore } from '@stores/audioStore'

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
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { meta: () => Promise.resolve({ waveform: '' }) } } }),
}))

type FakeMedia = HTMLMediaElement & { _playing?: boolean, _time?: number, _dur?: number, _ready?: number }

beforeAll(() => {
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
})

const ALICE: PeerId = 5
const ME: PeerId = 9
const GROUP: PeerId = toPeerId(77, true)

/** Час назад — подпись времени будет «Сегодня в ЧЧ:ММ». */
const DATE = Math.floor(Date.now() / 1000) - 3600

// Документы — в форме оригинала: `type`/`file_name` выводит `saveDocument`
// из атрибутов и mime (порт `appDocsManager.saveDoc`).
const pdfMedia = (id: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: {
    _: 'document', id, mime_type: 'application/pdf', size: 318_464,
    attributes: [{ _: 'documentAttributeFilename', file_name: 'Оферта.pdf' }],
  },
})
const musicMedia = (id: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: {
    _: 'document', id, mime_type: 'audio/mpeg', size: 3_500_000,
    attributes: [
      { _: 'documentAttributeAudio', duration: 106, title: 'я тимлид.mp3', performer: 'Дн' },
      { _: 'documentAttributeFilename', file_name: 'audio.mp3' },
    ],
  },
})
const voiceMedia = (id: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: {
    _: 'document', id, mime_type: 'audio/ogg', size: 12_000,
    attributes: [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 10 }],
  },
})
const roundMedia = (id: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: {
    _: 'document', id, mime_type: 'video/mp4', size: 90_000,
    attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 240, h: 240, pFlags: { round_message: true } }],
  },
})

/** Сообщение с вложением; id сообщения и id документа совпадают — так проще читать пины. */
const withMedia = (
  media: (id: number) => MessageMedia,
  id: number,
  { peerId = ALICE, fromId = ALICE }: { peerId?: PeerId, fromId?: PeerId } = {},
): MyMessage => makeMessage({ id, peerId, fromId, date: DATE, media: saveMessageMedia(media(id)) })

/** Какие сообщения отдаёт ручка `/chats/{id}/media?filter=…` (`messagesrepo.go::mediaFilterCond`). */
const WIRE_KINDS: Record<string, ReadonlySet<ReturnType<typeof getMessageKind>>> = {
  files: new Set(['document'] as const),
  music: new Set(['audio'] as const),
  voice: new Set(['voice', 'roundVideo'] as const),
}

function fakeBackend(all: MyMessage[]) {
  const managers = {
    messages: {
      mediaHistory: async (peerId: number, filter: string, offsetId = 0, limit = 30) => {
        const ofFilter = all.filter((m) => m.peerId === peerId && WIRE_KINDS[filter].has(getMessageKind(m)))
        const from = offsetId ? ofFilter.filter((m) => m.id < offsetId) : ofFilter
        return { messages: from.slice(0, limit), count: ofFilter.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) =>
        filters.map((filter) => ({ filter, count: all.length })),
    },
    peers: { fillMirror: async () => {} },
  } as unknown as SearchSuperManagers
  return managers
}

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
    { type: 'music', inputFilter: 'inputMessagesFilterMusic', name: 'SharedMusicTab2' as LangPackKey },
    { type: 'voice', inputFilter: 'inputMessagesFilterRoundVoice', name: 'SharedVoiceTab2' as LangPackKey },
  ]
}

function build(all: MyMessage[], peerId: PeerId = ALICE, options: { showSender?: boolean } = {}) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers: fakeBackend(all), ...options })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId, historyStorage: getHistoryStorage(peerId) })
  return searchSuper
}

/** Все три вкладки: `load()` без `single` грузит соседние текущей, текущая — своим вызовом. */
async function loadAll(searchSuper: AppSearchSuper) {
  await searchSuper.load(true)
  await searchSuper.load()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const items = (searchSuper: AppSearchSuper, filter: 'inputMessagesFilterDocument' | 'inputMessagesFilterMusic' | 'inputMessagesFilterRoundVoice') =>
  Array.from(searchSuper.tabs[filter]!.children) as HTMLElement[]

/** СВОЙ медиа-элемент документа — тот же, что взял узел (tweb `this.audio`). */
const media = (mediaId: number) => mediaPlayback.getMedia(mediaId) as FakeMedia

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{
    op: 'upsert',
    peers: [
      { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
      { _: 'user', id: ME, first_name: 'Я', pFlags: {} },
      { _: 'chat', id: 77, title: 'Кружок', photo: { _: 'chatPhotoEmpty' }, participants_count: 2, date: DATE },
    ],
  }])
  rootScope.myId = ME
})

afterEach(() => {
  resetPlayback()
  rootScope.myId = 0
  document.body.replaceChildren()
})

describe('AppSearchSuper: файлы (tweb processDocumentFilter, withTime)', () => {
  it('строка документа: имя, размер и время отправки — одним описанием через « · »', async () => {
    const searchSuper = build([withMedia(pdfMedia, 1)])
    await loadAll(searchSuper)

    const [item] = items(searchSuper, 'inputMessagesFilterDocument')
    expect(item.classList.contains('document')).toBe(true)
    expect(item.classList.contains('ext-pdf')).toBe(true)
    expect(item.classList.contains('search-super-item')).toBe(true)
    expect(item.dataset.mid).toBe('1')

    const name = item.querySelector('.document-name > middle-ellipsis-element') as HTMLElement
    expect(name.textContent).toBe('Оферта.pdf')
    // tweb `:945` — `fontWeight: 400`, тоньше ленты (500)
    expect(name.dataset.fontWeight).toBe('400')

    const size = item.querySelector('.document-size')!.textContent!
    expect(size).toContain('311')  // 318_464 байт ≈ 311 KB
    // tweb `:947` — `withTime: !showSender`: время отправки рядом с размером
    expect(size).toMatch(/\d\d:\d\d/)
    expect(size).toContain(' · ')
    // отправителя у файла нет (`showSender` не задан)
    expect(item.querySelector('.sender-title')).toBeNull()
  })

  it('с `showSender` у файла вместо времени — отправитель и `sent-time` в имени', async () => {
    const searchSuper = build([withMedia(pdfMedia, 1)], ALICE, { showSender: true })
    await loadAll(searchSuper)

    const [item] = items(searchSuper, 'inputMessagesFilterDocument')
    expect(item.querySelector('.document-size .sender-title')?.textContent).toBe('Алиса')
    expect(item.querySelector('.document-name .sent-time')).not.toBeNull()
    expect(item.querySelector('.document-size')!.textContent).not.toMatch(/\d\d:\d\d/)
  })
})

describe('AppSearchSuper: музыка', () => {
  it('audio-48, без `is-voice`; описание — исполнитель и время отправки', async () => {
    const searchSuper = build([withMedia(musicMedia, 2)])
    await loadAll(searchSuper)

    const [item] = items(searchSuper, 'inputMessagesFilterMusic')
    expect(item.tagName).toBe('AUDIO-ELEMENT')
    // tweb `:957-959` — `audio-48` у audio/voice/round
    expect(item.classList.contains('audio-48')).toBe(true)
    expect(item.classList.contains('is-voice')).toBe(false)
    expect(item.dataset.mid).toBe('2')

    expect(item.querySelector('.audio-title')!.textContent).toContain('я тимлид.mp3')
    const description = item.querySelector('.audio-description')!.textContent!
    expect(description).toContain('Дн')
    expect(description).toMatch(/\d\d:\d\d/)
  })
})

describe('AppSearchSuper: голосовые и кружки — один рендерер с файлами', () => {
  it('голосовое рисуется как музыка (`voiceAsMusic`): заголовок — отправитель, рядом `sent-time`', async () => {
    const searchSuper = build([withMedia(voiceMedia, 3)])
    await loadAll(searchSuper)

    const [item] = items(searchSuper, 'inputMessagesFilterRoundVoice')
    expect(item.tagName).toBe('AUDIO-ELEMENT')
    expect(item.classList.contains('audio-48')).toBe(true)
    // `voiceAsMusic: true` (tweb `:948`): волны нет, есть заголовок и подпись
    expect(item.classList.contains('is-voice')).toBe(false)
    expect(item.querySelector('.audio-waveform')).toBeNull()
    // tweb `:942` — у голосового отправитель показывается ВСЕГДА, а время — нет
    expect(item.querySelector('.audio-title .sender-title')?.textContent).toBe('Алиса')
    expect(item.querySelector('.audio-title .sent-time')).not.toBeNull()
    expect(item.querySelector('.audio-description')?.textContent ?? '').not.toMatch(/\d\d:\d\d/)
  })

  it('кружок идёт той же вкладкой и тем же рендерером', async () => {
    const searchSuper = build([withMedia(roundMedia, 4)])
    await loadAll(searchSuper)

    const [item] = items(searchSuper, 'inputMessagesFilterRoundVoice')
    expect(item.tagName).toBe('AUDIO-ELEMENT')
    expect(item.classList.contains('audio-48')).toBe(true)
    expect(item.querySelector('.audio-title .sender-title')?.textContent).toBe('Алиса')
  })

  it('в группе отправитель подписан «кто ➝ куда»; своё — «FromYou»', async () => {
    const searchSuper = build([
      withMedia(voiceMedia, 6, { peerId: GROUP, fromId: ME }),
      withMedia(voiceMedia, 5, { peerId: GROUP, fromId: ALICE }),
    ], GROUP)
    await loadAll(searchSuper)

    const [mine, hers] = items(searchSuper, 'inputMessagesFilterRoundVoice')
    expect(hers.querySelector('.sender-title')?.textContent).toBe('Алиса ➝ Кружок')
    expect(mine.querySelector('.sender-title')?.textContent).toBe('You ➝ Кружок')
  })
})

describe('AppSearchSuper: воспроизведение — общий плеер, очередь из элементов вкладки', () => {
  it('клик по элементу вкладки играет его СВОИМ медиа; очередь — соседи по вкладке в порядке узлов', async () => {
    const searchSuper = build([
      withMedia(voiceMedia, 13),
      withMedia(roundMedia, 12),
      withMedia(voiceMedia, 11),
      withMedia(musicMedia, 2),
    ])
    await loadAll(searchSuper)

    const voice = items(searchSuper, 'inputMessagesFilterRoundVoice')
    expect(voice.map((el) => el.dataset.mid)).toEqual(['13', '12', '11'])

    const toggle = voice[1].querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(media(12).paused).toBe(false)
    // очередь — вся вкладка `voice`, музыка из соседней вкладки в неё не входит
    expect(useAudioStore.getState().queue.map((t) => t.mediaId)).toEqual([13, 12, 11])
    expect(useAudioStore.getState().index).toBe(1)

    mediaPlayback.next()
    await settle()
    expect(media(11).paused).toBe(false)
    expect(media(12).paused).toBe(true)
  })

  it('музыка вкладки — своя очередь, голосовые в неё не попадают', async () => {
    const searchSuper = build([
      withMedia(musicMedia, 22),
      withMedia(musicMedia, 21),
      withMedia(voiceMedia, 11),
    ])
    await loadAll(searchSuper)

    const [first] = items(searchSuper, 'inputMessagesFilterMusic')
    const toggle = first.querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(media(22).paused).toBe(false)
    expect(useAudioStore.getState().queue.map((t) => t.mediaId)).toEqual([22, 21])
  })
})
