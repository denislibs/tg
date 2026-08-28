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
import { saveDocument, type MyDocument } from '@core/media/messageMedia'

// Платформа ИГРАЕТ ogg сама — это ~97% трафика и путь, ради которого написан
// весь файл: подача src синхронна, конвертации нет. Объявлять приходится явно,
// потому что в jsdom `canPlayType` возвращает пустую строку, то есть по умолчанию
// стенд изображал бы Safari ниже 18.4 и гонял АСИНХРОННУЮ ветку
// (`core/audio/mediaPlaybackController.ts::ensureSrc`). Сама эта ветка покрыта
// отдельно — `core/audio/mediaPlaybackController.opus.test.ts`.
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
const markMediaPlayed = vi.fn()
vi.mock('@core/mediaRead', () => ({ markMediaPlayed: (...args: unknown[]) => markMediaPlayed(...args) }))

// Мок нужен как ПИН, а не как заглушка зависимости: пики приезжают в самом
// сообщении, поэтому узел не должен ходить за метой медиа ВООБЩЕ. Тест волны
// проверяет `meta` на «не звали» — если добор меты вернут, он покраснеет.
const meta = vi.fn((_id: number) => Promise.resolve({ waveform: '' }))
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { meta: (id: number) => meta(id) } } }),
}))

type FakeMedia = HTMLMediaElement & { _playing?: boolean, _time?: number, _dur?: number, _ready?: number }

let wrapDocument: typeof import('./wrappers/document').default
let mediaPlayback: typeof import('@core/audio/mediaPlaybackController').mediaPlayback
let resetPlayback: typeof import('@core/audio/mediaPlaybackController').resetPlayback
let rootScope: typeof import('@lib/rootScope').default
let RT: typeof import('@core/realtime/events').RT
let getMiddleware: typeof import('@helpers/middleware').getMiddleware
let useAudioStore: typeof import('@stores/audioStore').useAudioStore

/** СВОЙ медиа-элемент сообщения — тот же, что взял узел (tweb `this.audio`). */
const media = (mediaId: number) => mediaPlayback.getMedia(mediaId) as FakeMedia

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

  wrapDocument = (await import('./wrappers/document')).default
  mediaPlayback = (await import('@core/audio/mediaPlaybackController')).mediaPlayback
  resetPlayback = (await import('@core/audio/mediaPlaybackController')).resetPlayback
  rootScope = (await import('@lib/rootScope')).default
  RT = (await import('@core/realtime/events')).RT
  getMiddleware = (await import('@helpers/middleware')).getMiddleware
  useAudioStore = (await import('@stores/audioStore')).useAudioStore
})

/** 63 байта пиков — тот же формат, что кладёт запись (5 бит на значение). */
const WAVEFORM_B64 = btoa(String.fromCharCode(...Array.from({ length: 63 }, (_, i) => (i * 37) % 256)))

// Документы — в форме оригинала: `type`/`duration`/`file_name` НЕ задаются рукой,
// их выводит `saveDocument` из атрибутов и mime (порт `appDocsManager.saveDoc`).
// Отсутствующий флаг/тег — это ОТСУТСТВУЮЩИЙ ключ, а не `undefined`.
const voiceDoc = ({ id = 100, noWaveform }: { id?: number, noWaveform?: true } = {}): MyDocument => saveDocument({
  _: 'document',
  id,
  mime_type: 'audio/ogg',
  size: 12_000,
  attributes: [{
    _: 'documentAttributeAudio',
    pFlags: { voice: true },
    duration: 10,
    ...(noWaveform ? {} : { waveform: WAVEFORM_B64 }),
  }],
})

// Имя файла НАМЕРЕННО отличается от ID3-заголовка: tweb берёт
// `audioAttribute?.title ?? doc.file_name` — приоритет у тега, а не у файла.
const musicDoc = (
  { id = 200, noPerformer, noTitle }: { id?: number, noPerformer?: true, noTitle?: true } = {},
): MyDocument => saveDocument({
  _: 'document',
  id,
  mime_type: 'audio/mpeg',
  size: 3_500_000,
  attributes: [
    {
      _: 'documentAttributeAudio',
      duration: 106,
      ...(noTitle ? {} : { title: 'я тимлид.mp3' }),
      ...(noPerformer ? {} : { performer: 'Дн' }),
    },
    { _: 'documentAttributeFilename', file_name: 'audio_2026-08-19.mp3' },
  ],
})

function wrap(doc: MyDocument, message: Record<string, unknown> = {}) {
  const helper = getMiddleware()
  const element = wrapDocument({ doc, message, middleware: helper.get() })
  document.body.append(element)
  return { element, helper }
}

/** Дать движку дожевать асинхронный load() (резолв URL + play). */
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Волна двигается ДРОССЕЛЕМ ПО КАДРУ (tweb `throttleWithRaf`, audio.ts:270-272):
 *  `timeupdate` приходит чаще кадра, и обновление ширины ждёт rAF.
 *  Ждём ДВА кадра и хвост микро/макрозадач: `fastRaf` копит колбэки в общую
 *  пачку, и свой rAF теста может встать в очередь раньше неё. */
const frame = async () => {
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await new Promise((r) => setTimeout(r, 0))
}

/** Контейнер ленты — от него `findMediaTargets` начинает скан (tweb :462). */
function bubblesInner() {
  const inner = document.createElement('div')
  inner.className = 'bubbles-inner'
  document.body.append(inner)
  return inner
}

/** Бабл вокруг узла: селектор плейлиста требует `.bubble:not(.webpage)`. */
function bubble(child: HTMLElement, extra = '') {
  const b = document.createElement('div')
  b.className = ('bubble ' + extra).trim()
  b.append(child)
  return b
}

/** Узел кружка — то, что строит `wrappers/video.ts::wrapRound`: `.media-round`
 *  с треком на самом узле. */
function roundNode(mediaId: number, mid: number, peerId: number) {
  const node = document.createElement('div')
  node.className = 'media-round'
  node.dataset.mid = '' + mid
  node.dataset.peerId = '' + peerId
  ;(node as unknown as { track: unknown }).track = {
    mediaId, title: '', subtitle: '', peerId, msgId: mid, type: 'round',
  }
  return node
}

beforeEach(() => {
  document.body.textContent = ''
  markMediaPlayed.mockClear()
  meta.mockClear()
})

afterEach(() => {
  resetPlayback()
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

    rootScope.dispatchEventSingle(RT.mediaRead, {
      _: 'updateReadPeerMessagesContents',
      peer: { _: 'peerUser', user_id: 42 },
      messages: [5],
    })

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

  // Пики едут в самом сообщении (`media_waveform` витрины истории и live-кадра),
  // как documentAttributeAudio.waveform у telegram. Волна обязана быть готова к
  // первому кадру — ни запроса меты медиа, ни перерисовки на месте.
  it('волна готова синхронно: запроса меты медиа нет вовсе', async () => {
    const { element } = wrap(voiceDoc())

    expect(element.querySelectorAll('.audio-waveform-background .audio-waveform-bar').length).toBe(47)

    await settle()

    expect(meta).not.toHaveBeenCalled()
    // волна не перерисовывалась — узлы те же, что были на первом кадре
    expect(element.querySelectorAll('.audio-waveform-background .audio-waveform-bar').length).toBe(47)
  })

  // tweb audio.ts:318-320. Клик в самый правый бар обязан перематывать В ХВОСТ,
  // а не ставить ровно `duration`: на точном конце браузер немедленно шлёт
  // `ended`, и узел сбрасывается в «не проигрывалось» вместо продолжения.
  it('скраб в самый конец волны не доводит currentTime до duration', () => {
    const { element } = wrap(voiceDoc())
    const svg = element.querySelector('.audio-waveform-background > svg.audio-waveform-bars') as SVGSVGElement
    const m = media(100)
    m._dur = 10

    // правый край дорожки: getBoundingClientRect в happy-dom нулевой, поэтому
    // fraction = clientX / availW (190) — клик за правым краем даёт fraction > 1
    svg.dispatchEvent(new MouseEvent('click', { clientX: 1000, bubbles: true }))

    expect(m.currentTime).toBeLessThan(10)
    expect(m.currentTime).toBeCloseTo(9.99, 5)
  })

  // tweb audio.ts:239-244 + :325-329: пиков нет → вместо волны в её же
  // контейнере рисуется обычная полоса прогресса. Без этой ветки узел оставался
  // с ПУСТЫМ контейнером — по такому голосовому нечем ни следить, ни перематывать.
  it('пиков нет — вместо волны полоса прогресса; файл ради волны не качается', async () => {
    const { element } = wrap(voiceDoc({ noWaveform: true }))

    // tweb: пустой waveform → createWaveformBars не отдаёт контейнер, svg нет
    expect(element.querySelector('.audio-waveform')).toBeNull()

    const container = element.querySelector('.audio-waveform-container') as HTMLElement
    const line = container.querySelector('.progress-line') as HTMLElement
    expect(line).not.toBeNull()
    // `streamable` — подложка «сколько буферизовано» (tweb `doc.supportsStreaming`)
    expect(line.querySelector('.progress-line__loaded')).not.toBeNull()

    await settle()

    expect(meta).not.toHaveBeenCalled()
    expect(element.querySelector('.audio-waveform')).toBeNull()
  })
})

describe('AudioElement — воспроизведение', () => {
  it('узел играет СВОИМ элементом: клик запускает, повторный ставит на паузу', async () => {
    const { element } = wrap(voiceDoc(), { mid: 5, peerId: 42 })
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    // элемент сообщения заведён сразу при отрисовке узла (tweb onLoad → addMedia)
    expect((element as unknown as { media: HTMLMediaElement }).media).toBe(media(100))

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(media(100).src).toContain('https://media/100')
    expect(media(100).paused).toBe(false)
    expect(toggle.classList.contains('playing')).toBe(true)
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:00 / 0:10')

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(media(100).paused).toBe(true)
    expect(toggle.classList.contains('playing')).toBe(false)
  })

  it('прогресс воспроизведения обрезает клон волны по ширине', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    media(100)._dur = 10
    media(100)._time = 5
    media(100).dispatchEvent(new Event('timeupdate'))

    const fake = element.querySelector('.audio-waveform-fake') as HTMLElement
    // до кадра ширина не двигается — обновление под `throttleWithRaf`
    expect(fake.style.width).toBe('')
    await frame()
    expect(fake.style.width).toBe('50%')
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:05 / 0:10')
  })

  it('чужое непрослушанное голосовое помечается прослушанным', async () => {
    wrap(voiceDoc(), { mid: 5, peerId: 42, mediaUnread: true, out: false })
    const toggle = document.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // tweb: точка снимается по первому движению времени, а не по клику
    expect(markMediaPlayed).not.toHaveBeenCalled()

    media(100)._time = 1
    media(100).dispatchEvent(new Event('timeupdate'))

    expect(markMediaPlayed).toHaveBeenCalledWith(42, 5)
    expect(markMediaPlayed).toHaveBeenCalledTimes(1)
  })

  it('плейлист — соседи по ленте, в порядке узлов (tweb findMediaTargets)', async () => {
    const inner = bubblesInner()

    const first = wrap(voiceDoc({ id: 101 }), { mid: 1, peerId: 42 })
    const second = wrap(voiceDoc({ id: 102 }), { mid: 2, peerId: 42 })
    inner.append(bubble(first.element), bubble(second.element))

    const toggle = second.element.querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // доиграв второе, плеер не должен упереться — очередь несёт обоих соседей
    expect(media(102).paused).toBe(false)

    mediaPlayback.prev()
    await settle()
    expect(media(101).paused).toBe(false)
    // предыдущий трек остановлен своим же элементом
    expect(media(102).paused).toBe(true)
    expect(second.element.querySelector('.audio-toggle')?.classList.contains('playing')).toBe(false)
  })

  // Порт терма `.media-round` (tweb audio.ts:469): голосовые и кружки —
  // ОДНА очередь (`inputMessagesFilterRoundVoice`). Без него очередь голосовых
  // обрывалась на первом же кружке ленты.
  it('кружок ленты стоит в одной очереди с голосовыми', async () => {
    const inner = bubblesInner()

    const voice = wrap(voiceDoc({ id: 101 }), { mid: 1, peerId: 42 })
    const round = roundNode(102, 2, 42)
    inner.append(bubble(voice.element), bubble(round))

    const toggle = voice.element.querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(useAudioStore.getState().queue.map((t) => t.mediaId)).toEqual([101, 102])
  })

  // Порт префикса `.bubble:not(.webpage)` (tweb audio.ts:473-476): голосовое из
  // карточки превью ссылки — не «следующий трек» ленты.
  it('голосовое внутри превью ссылки в очередь не попадает', async () => {
    const inner = bubblesInner()

    const own = wrap(voiceDoc({ id: 101 }), { mid: 1, peerId: 42 })
    const inWebpage = wrap(voiceDoc({ id: 103 }), { mid: 3, peerId: 42 })
    inner.append(bubble(own.element), bubble(inWebpage.element, 'webpage'))

    const toggle = own.element.querySelector('.audio-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(useAudioStore.getState().queue.map((t) => t.mediaId)).toEqual([101])
  })

  it('заиграло другое — волна остаётся на месте, чужой прогресс в неё не течёт', async () => {
    const { element } = wrap(voiceDoc({ id: 111 }))
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    media(111)._dur = 10
    media(111)._time = 5
    media(111).dispatchEvent(new Event('timeupdate'))
    await frame()
    expect((element.querySelector('.audio-waveform-fake') as HTMLElement).style.width).toBe('50%')

    // плеер уехал на чужой трек
    mediaPlayback.playQueue([{ mediaId: 999, title: 't', subtitle: 's', type: 'voice' }], 0)
    await settle()

    expect(element.querySelectorAll('.audio-waveform-background .audio-waveform-bar').length).toBe(47)
    expect((element.querySelector('.audio-waveform-fake') as HTMLElement).style.width).toBe('0%')
    expect(element.querySelector('.audio-time')?.textContent).toBe('0:10')

    // чужой трек тикает — наша волна и время стоят
    media(999)._dur = 10
    media(999)._time = 8
    media(999).dispatchEvent(new Event('timeupdate'))

    expect((element.querySelector('.audio-waveform-fake') as HTMLElement).style.width).toBe('0%')
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

  it('middleware протух — узел отписан, воспроизведение его не трогает', async () => {
    const { element, helper } = wrap(voiceDoc({ id: 109 }), { mid: 9, peerId: 42 })
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    helper.destroy()

    // тот же трек заиграл откуда-то ещё (плашка плеера, соседний бабл)
    mediaPlayback.playQueue([{ mediaId: 109, title: 't', subtitle: 's', type: 'voice' }], 0)
    await settle()

    expect(toggle.classList.contains('playing')).toBe(false)
    expect(element.classList.contains('downloading')).toBe(false)
  })

  // tweb audio.ts:688-702: крестик кольца зовёт `promise.cancel()`, и этот
  // метод определяет ТОТ, КТО кольцо завёл — у `deferredPromise` его нет.
  // Без определения крестик был пустышкой.
  it('крестик кольца ожидания реально отменяет ожидание и останавливает трек', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(media(100).paused).toBe(false)

    const download = element.querySelector('.audio-download') as HTMLElement
    const preloader = download.querySelector('.preloader-container') as HTMLElement
    preloader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(media(100).paused).toBe(true)
  })

  // tweb audio.ts:700-702 — пауза во время ожидания потока снимает кольцо сама.
  it('пауза во время ожидания потока отменяет кольцо', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    await frame()
    const download = element.querySelector('.audio-download') as HTMLElement
    const preloader = download.querySelector('.preloader-container') as HTMLElement
    // кольцо привешено и НЕ уходит (обратного перехода нет)
    expect(preloader.classList.contains('backwards')).toBe(false)

    media(100).pause()
    await settle()
    await frame()
    await frame()

    // Отменённое ожидание уводит кольцо (tweb: реджект дефера → preloader.detach).
    // Снятие идёт переходом tweb, поэтому наблюдаемых состояний ДВА и какое
    // застанет тест — вопрос таймингов rAF/таймера: либо идёт обратный переход
    // (`backwards`), либо он уже кончился и узла нет. Оба — «кольцо ушло»;
    // «кольцо на месте и видимо» (что и было без `deferred.cancel`) — не они.
    const gone = !preloader.parentElement || preloader.classList.contains('backwards')
    expect(gone).toBe(true)
  })

  it('кольцо ожидания потока появляется и снимается по canplay', async () => {
    const { element } = wrap(voiceDoc())
    const toggle = element.querySelector('.audio-toggle') as HTMLElement

    // кольца нет, пока трек не запускали (tweb вешает его на первый play)
    expect(element.classList.contains('downloading')).toBe(false)

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(element.classList.contains('corner-download')).toBe(true)
    expect(element.classList.contains('downloading')).toBe(true)
    const download = element.querySelector('.audio-download') as HTMLElement
    expect(download.querySelector('.preloader-container')).not.toBeNull()

    media(100)._ready = 2
    media(100).dispatchEvent(new Event('canplay'))
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

  // tweb audio.ts:390 — `audioAttribute?.title ?? doc.file_name`: заголовок
  // и исполнитель живут в ID3-теге документа, а не в самом файле.
  it('без ID3-заголовка подписью становится имя файла', () => {
    const { element } = wrap(musicDoc({ noTitle: true }))

    expect(element.querySelector('.audio-title')?.textContent).toBe('audio_2026-08-19.mp3')
  })

  it('без исполнителя описание — размер файла (tweb formatBytes-ветка)', () => {
    const { element } = wrap(musicDoc({ noPerformer: true }))

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
    // tweb audio.ts:405-409 `streamable: doc.supportsStreaming` — вторая полоса
    // «сколько буферизовано» под основной; у нас стримится любое медиа
    expect(subtitle.lastElementChild?.querySelector('.progress-line__loaded')).not.toBeNull()

    media(200).dispatchEvent(new Event('ended'))

    expect(element.classList.contains('audio-show-progress')).toBe(false)
    expect(subtitle.lastElementChild?.className).toBe('audio-description')
  })
})
