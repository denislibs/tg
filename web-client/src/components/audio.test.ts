// Поведение ванильного `AudioElement` (порт tweb components/audio.ts) — узла,
// в который `wrapDocument` делегирует голосовое, кружок и музыку.
//
// Эталон дерева — живой дамп tweb `docs/tweb/dom/dumps/03-reply-audio.json`:
//
//   audio-element.audio.is-out[data-mid][data-peer-id]
//     div.audio-toggle.audio-ico[.playing] > .audio-play-icon > .part.one/.two
//     div.audio-details
//       div.audio-title > middle-ellipsis-element
//       div.audio-subtitle > div.audio-time + (.audio-description | .progress-line)
//
// Медиа-элементы окружения не играют — прототип подменён предсказуемыми
// заглушками, дёргающими настоящие события (приём из mediaPlaybackController.test.ts).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const markMediaPlayed = vi.fn()
vi.mock('@core/mediaRead', () => ({ markMediaPlayed: (...args: unknown[]) => markMediaPlayed(...args) }))

const meta = vi.fn((_id: number) => Promise.resolve({ waveform: '' }))
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { meta: (id: number) => meta(id) } } }),
}))

type FakeMedia = HTMLMediaElement & { _playing?: boolean, _time?: number, _dur?: number, _ready?: number }

let wrapDocument: typeof import('./wrappers/document').default
let mediaPlayback: typeof import('@core/audio/mediaPlaybackController').mediaPlayback
let rootScope: typeof import('@lib/rootScope').default
let RT: typeof import('@core/realtime/events').RT
let getMiddleware: typeof import('@helpers/middleware').getMiddleware

const created: HTMLMediaElement[] = []
/** Внутренний <audio> движка (создаётся лениво при первом воспроизведении). */
const player = () => created[created.length - 1] as FakeMedia

beforeAll(async () => {
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

  const RealAudio = globalThis.Audio
  vi.stubGlobal('Audio', function() {
    const a = new RealAudio()
    created.push(a)
    return a
  })

  wrapDocument = (await import('./wrappers/document')).default
  mediaPlayback = (await import('@core/audio/mediaPlaybackController')).mediaPlayback
  rootScope = (await import('@lib/rootScope')).default
  RT = (await import('@core/realtime/events')).RT
  getMiddleware = (await import('@helpers/middleware')).getMiddleware
})

/** 63 байта пиков — тот же формат, что кладёт запись (5 бит на значение). */
const WAVEFORM_B64 = btoa(String.fromCharCode(...Array.from({ length: 63 }, (_, i) => (i * 37) % 256)))

const voiceDoc = (over: Record<string, unknown> = {}) => ({
  id: 100,
  type: 'voice' as const,
  duration: 10,
  waveform: WAVEFORM_B64,
  ...over,
})

const musicDoc = (over: Record<string, unknown> = {}) => ({
  id: 200,
  type: 'audio' as const,
  duration: 106,
  size: 3_500_000,
  fileName: 'я тимлид.mp3',
  title: 'я тимлид.mp3',
  performer: 'Дн',
  ...over,
})

function wrap(doc: ReturnType<typeof voiceDoc> | ReturnType<typeof musicDoc>, message: Record<string, unknown> = {}) {
  const helper = getMiddleware()
  const element = wrapDocument({ doc, message, middleware: helper.get() })
  document.body.append(element)
  return { element, helper }
}

/** Дать движку дожевать асинхронный load() (резолв URL + play). */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  document.body.textContent = ''
  markMediaPlayed.mockClear()
  meta.mockClear()
})

afterEach(() => {
  mediaPlayback.close()
})

describe('AudioElement — настоящий web-component, а не пустой тег', () => {
  it('тег зарегистрирован: разметка оживает без ссылки на инстанс', () => {
    expect(customElements.get('audio-element')).toBeDefined()

    const parsed = document.createElement('div')
    parsed.innerHTML = '<audio-element></audio-element>'
    expect(parsed.firstElementChild?.constructor.name).toBe('AudioElement')
  })

  it('прочтение медиа снимает точку «не прослушано» поиском по DOM', () => {
    const { element } = wrap(voiceDoc(), { mid: 5, peerId: 42, mediaUnread: true })
    expect(element.classList.contains('is-unread')).toBe(true)

    rootScope.dispatchEventSingle(RT.mediaRead, { chat_id: 42, msg_id: 5 })

    expect(element.classList.contains('is-unread')).toBe(false)
  })
})

describe('AudioElement — голосовое (tweb wrapVoiceMessage)', () => {
  it('дерево и классы совпадают с tweb', () => {
    const { element } = wrap(voiceDoc(), { mid: 5, peerId: 42, out: true, mediaUnread: true })

    expect(element.tagName).toBe('AUDIO-ELEMENT')
    expect(element.classList.contains('audio')).toBe(true)
    expect(element.classList.contains('is-voice')).toBe(true)
    expect(element.classList.contains('is-out')).toBe(true)
    expect(element.classList.contains('is-unread')).toBe(true)
    expect(element.dataset.mid).toBe('5')
    expect(element.dataset.peerId).toBe('42')

    const toggle = element.querySelector('.audio-toggle.audio-ico') as HTMLElement
    expect(toggle.querySelector('.audio-play-icon > .part.one')).not.toBeNull()
    expect(toggle.querySelector('.audio-play-icon > .part.two')).not.toBeNull()

    const container = element.querySelector('.audio-waveform-container') as HTMLElement
    expect(container.children[0].className).toBe('audio-waveform audio-waveform-background')
    expect(container.children[1].className).toBe('audio-waveform audio-waveform-fake')

    // в покое время — длительность записи (tweb getDurationStr)
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:10')
  })

  it('волна строится из переданных пиков — бары выровнены по низу', () => {
    const { element } = wrap(voiceDoc())

    const svg = element.querySelector('.audio-waveform-background > svg.audio-waveform-bars') as SVGSVGElement
    // ширина волны растёт с длительностью: clamp(10/60*256, 190, 256) = 190
    expect(svg.getAttribute('width')).toBe('190')
    expect(svg.getAttribute('viewBox')).toBe('0 0 190 23')

    const bars = Array.from(svg.querySelectorAll('rect.audio-waveform-bar'))
    // число баров = availW / (ширина + отступ) = 190 / 4
    expect(bars.length).toBe(47)

    bars.forEach((bar, i) => {
      const height = Number(bar.getAttribute('height'))
      expect(height).toBeGreaterThanOrEqual(4) // barHeightMin
      expect(height).toBeLessThanOrEqual(23) // barHeightMax
      // y = высота контейнера − высота бара: бары стоят на дне, а не по центру
      expect(Number(bar.getAttribute('y'))).toBe(23 - height)
      expect(Number(bar.getAttribute('x'))).toBe(i * 4)
    })

    // пики разные — волна не «полка»
    const heights = new Set(bars.map((bar) => bar.getAttribute('height')))
    expect(heights.size).toBeGreaterThan(1)

    // фоновая волна и её обрезаемый клон одинаковы
    const fake = element.querySelector('.audio-waveform-fake > svg') as SVGSVGElement
    expect(fake.querySelectorAll('rect').length).toBe(bars.length)
  })

  it('пиков нет в сообщении — добираются метой и волна перерисовывается', async () => {
    meta.mockResolvedValueOnce({ waveform: WAVEFORM_B64 })
    const { element } = wrap(voiceDoc({ waveform: undefined }))

    // без пиков волны нет вовсе (tweb: пустой waveform → нет svg)
    expect(element.querySelector('.audio-waveform')).toBeNull()

    await settle()

    expect(meta).toHaveBeenCalledWith(100)
    expect(element.querySelectorAll('.audio-waveform-background .audio-waveform-bar').length).toBe(47)
  })

  it('middleware протух — поздняя мета в DOM ничего не пишет', async () => {
    let resolveMeta: (value: { waveform: string }) => void = () => {}
    meta.mockReturnValueOnce(new Promise((r) => { resolveMeta = r }))

    const { element, helper } = wrap(voiceDoc({ waveform: undefined }))
    helper.destroy()

    resolveMeta({ waveform: WAVEFORM_B64 })
    await settle()

    expect(element.querySelector('.audio-waveform')).toBeNull()
  })
})

describe('AudioElement — воспроизведение', () => {
  it('клик запускает трек, повторный ставит на паузу', async () => {
    const { element } = wrap(voiceDoc(), { mid: 5, peerId: 42 })
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(player().src).toContain('https://media/100')
    expect(toggle.classList.contains('playing')).toBe(true)
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:00 / 0:10')

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(player().paused).toBe(true)
    expect(toggle.classList.contains('playing')).toBe(false)
  })

  it('прогресс воспроизведения обрезает клон волны по ширине', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    player()._dur = 10
    player()._time = 5
    player().dispatchEvent(new Event('timeupdate'))

    const fake = element.querySelector('.audio-waveform-fake') as HTMLElement
    expect(fake.style.width).toBe('50%')
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:05 / 0:10')
  })

  it('чужое непрослушанное голосовое помечается прослушанным', async () => {
    wrap(voiceDoc(), { mid: 5, peerId: 42, mediaUnread: true, out: false })
    const toggle = document.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(markMediaPlayed).toHaveBeenCalledWith(42, 5)
  })

  it('плейлист — соседи по ленте, в порядке узлов (tweb findMediaTargets)', async () => {
    const inner = document.createElement('div')
    inner.className = 'bubbles-inner'
    document.body.append(inner)

    const first = wrap(voiceDoc({ id: 101 }), { mid: 1, peerId: 42 })
    const second = wrap(voiceDoc({ id: 102 }), { mid: 2, peerId: 42 })
    inner.append(first.element, second.element)

    const toggle = second.element.querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // доиграв второе, плеер не должен упереться — очередь несёт обоих соседей
    expect(player().src).toContain('https://media/102')

    mediaPlayback.prev()
    await settle()
    expect(player().src).toContain('https://media/101')
  })

  it('заиграло другое — волна остаётся на месте, прогресс сброшен', async () => {
    const { element } = wrap(voiceDoc({ id: 111 }))
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    player()._dur = 10
    player()._time = 5
    player().dispatchEvent(new Event('timeupdate'))
    expect((element.querySelector('.audio-waveform-fake') as HTMLElement).style.width).toBe('50%')

    // плеер уехал на чужой трек
    mediaPlayback.playQueue([{ mediaId: 999, title: 't', subtitle: 's', type: 'voice' }], 0)
    await settle()

    expect(element.querySelectorAll('.audio-waveform-background .audio-waveform-bar').length).toBe(47)
    expect((element.querySelector('.audio-waveform-fake') as HTMLElement).style.width).toBe('')
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:10')
  })

  it('музыка после переключения треков не теряет длительность из подписи', async () => {
    const { element } = wrap(musicDoc({ id: 211 }))
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(element.querySelector('.audio-subtitle > .progress-line')).not.toBeNull()

    mediaPlayback.playQueue([{ mediaId: 999, title: 't', subtitle: 's', type: 'audio' }], 0)
    await settle()

    const subtitle = element.querySelector('.audio-subtitle') as HTMLElement
    expect(Array.from(subtitle.children).map((child) => child.className))
      .toEqual(['audio-time', 'audio-description'])

    // и второй запуск снова меняет ОПИСАНИЕ, а не время
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(Array.from(subtitle.children).map((child) => child.className))
      .toEqual(['audio-time', 'progress-line'])
  })

  it('middleware протух — узел отписан, чужое воспроизведение его не трогает', async () => {
    const { element, helper } = wrap(voiceDoc({ id: 109 }), { mid: 9, peerId: 42 })
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    helper.destroy()

    // тот же трек заиграл откуда-то ещё (плашка плеера, соседний бабл)
    mediaPlayback.playQueue([{ mediaId: 109, title: 't', subtitle: 's', type: 'voice' }], 0)
    await settle()

    expect(toggle.classList.contains('playing')).toBe(false)
    expect(element.classList.contains('downloading')).toBe(false)
  })

  it('кольцо ожидания потока появляется и снимается по canplay', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    // кольцо садится СРАЗУ по клику — поток ещё не готов (tweb corner-download)
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(element.classList.contains('corner-download')).toBe(true)
    expect(element.classList.contains('downloading')).toBe(true)
    const download = element.querySelector('.audio-download') as HTMLElement
    expect(download.querySelector('.preloader-container')).not.toBeNull()

    player()._ready = 2
    player().dispatchEvent(new Event('canplay'))
    await settle()

    expect(element.classList.contains('downloading')).toBe(false)
    expect(download.classList.contains('downloaded')).toBe(true)
  })
})

describe('AudioElement — музыка (tweb wrapAudio)', () => {
  it('дерево и классы совпадают с живым дампом 03-reply-audio.json', () => {
    const { element } = wrap(musicDoc(), { mid: 21402, peerId: 444077753, out: true })

    expect(element.classList.contains('audio')).toBe(true)
    expect(element.classList.contains('is-voice')).toBe(false)
    expect(element.classList.contains('is-out')).toBe(true)

    const details = element.querySelector('.audio-details') as HTMLElement
    const title = details.querySelector('.audio-title') as HTMLElement
    expect(title.firstElementChild?.tagName).toBe('MIDDLE-ELLIPSIS-ELEMENT')
    expect(title.textContent).toBe('я тимлид.mp3')

    const subtitle = details.querySelector('.audio-subtitle') as HTMLElement
    expect(subtitle.children[0].className).toBe('audio-time')
    expect(subtitle.children[0].textContent).toBe('1:46')
    expect(subtitle.children[1].className).toBe('audio-description')
    expect(subtitle.children[1].textContent).toBe(' • Дн')

    // волны у музыки нет
    expect(element.querySelector('.audio-waveform-container')).toBeNull()
  })

  it('без исполнителя описание — размер файла (tweb formatBytes-ветка)', () => {
    const { element } = wrap(musicDoc({ performer: undefined }))

    expect(element.querySelector('.audio-description')?.textContent).toBe(' • 3.3 MB')
  })

  it('на play описание сменяется полосой прогресса, на ended возвращается', async () => {
    const { element } = wrap(musicDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(element.classList.contains('audio-show-progress')).toBe(true)
    const subtitle = element.querySelector('.audio-subtitle') as HTMLElement
    expect(subtitle.lastElementChild?.className).toContain('progress-line')

    player().dispatchEvent(new Event('ended'))

    expect(element.classList.contains('audio-show-progress')).toBe(false)
    expect(subtitle.lastElementChild?.className).toBe('audio-description')
  })
})
