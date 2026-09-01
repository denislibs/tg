// Тесты видео-ветки `_openMedia` (Task 15, порт tweb base.ts:2557-2896 +
// createPlayer :2627-2740): gif без плеера, loop-порог 60 c, создание плеера
// строго после Promise.all([canplay, onAnimationEnd]), буферизация
// (waiting → is-buffering + стрим-кольцо, canplay → detach), toggleControls →
// has-video-controls на whole, зум → lockControls (disable-hover).
// Среда — happy-dom + fake timers (полёт доводится страховочным таймером
// waitForMoverTransition, 200+100); медиа-API happy-dom нет — play/pause/
// readyState/networkState/buffered стабятся на прототипе, события видео
// диспатчатся руками.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Плеер строит подпись скорости живым узлом ядра (`_i18n`, задача 8), а строки в
// ядро кладёт холодный старт (`client/boot.ts`); в прогоне — общий сетап
// (`src/test/setup.ts`). На пустом ядре узел напечатал бы имя ключа и красил бы
// пин `test/domKeyLeak`.
import AppMediaViewerBase, { type ViewerMedia, type ViewerNavigationItem } from './base'
import type VideoPlayer from '@lib/mediaPlayer'
import ListLoader from './listLoader'
import { resetMediaUrlMirror } from '@core/mediaCache'

const { downloadMediaURL, resolveStreamUrl } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number) => Promise<string>>(),
  resolveStreamUrl: vi.fn<(id: number) => string | Promise<string>>(),
}))

// RPC-мост вкладки (как base.open.test.ts) — реальный SharedWorker в happy-dom
// не поднять
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

// Стрим-URL видео: развязка от токен-логики mediaUrl (ей — свои тесты)
vi.mock('@core/mediaUrl', () => ({ resolveStreamUrl }))

vi.mock('@helpers/blur', () => ({
  default: vi.fn(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    return { canvas, promise: Promise.resolve() }
  }),
}))

type Target = { element: HTMLElement }

class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  get whole() { return this.wholeDiv }
  get contentMap() { return this.content }
  get streamablePreloader() { return this.preloaderStreamable }
  get player(): VideoPlayer | undefined { return this.videoPlayer }

  callOpenMedia(args: { media: ViewerMedia, fromRight: number, target?: HTMLElement }) {
    return this._openMedia(args)
  }

  zoomIn() { this.addZoomStep(true) }
  zoomReset() { this.resetZoom() }
  get navigationItemPub() { return this.navigationItem }
}

function makeViewer() {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  return new TestViewer(listLoader, [])
}

const vid = (over: Partial<ViewerMedia> = {}): ViewerMedia => ({
  mediaId: 9,
  width: 800,
  height: 600,
  kind: 'video',
  ...over,
})

// Медиа-стаб happy-dom: play/pause с событиями, управляемые readyState/
// networkState/currentTime/duration, пустой buffered.
type MediaStub = HTMLMediaElement & {
  __paused?: boolean
  __readyState?: number
  __networkState?: number
  __currentTime?: number
  __duration?: number
}

const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
const savedDescriptors = new Map<string, PropertyDescriptor | undefined>()

function stubMediaPrototype() {
  const define = (name: string, descriptor: PropertyDescriptor) => {
    savedDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name))
    Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, ...descriptor })
  }
  define('play', {
    writable: true,
    value(this: MediaStub) {
      this.__paused = false
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    },
  })
  define('pause', {
    writable: true,
    value(this: MediaStub) {
      this.__paused = true
      this.dispatchEvent(new Event('pause'))
    },
  })
  define('load', { writable: true, value() {} })
  define('paused', { get(this: MediaStub) { return this.__paused ?? true } })
  define('readyState', { get(this: MediaStub) { return this.__readyState ?? 0 } })
  define('networkState', { get(this: MediaStub) { return this.__networkState ?? 0 } })
  define('currentTime', {
    get(this: MediaStub) { return this.__currentTime ?? 0 },
    set(this: MediaStub, v: number) { this.__currentTime = v },
  })
  define('duration', { get(this: MediaStub) { return this.__duration ?? NaN } })
  define('buffered', {
    get() { return { length: 0, start: () => 0, end: () => 0 } },
  })
  // happy-dom на назначение src симулирует загрузку и САМ стреляет canplay —
  // отбирает у теста контроль над гейтами; заменяем на инертный атрибут
  define('src', {
    get(this: MediaStub) { return this.getAttribute('src') ?? '' },
    set(this: MediaStub, v: string) { this.setAttribute('src', v) },
  })
  if (!('HAVE_FUTURE_DATA' in proto)) proto.HAVE_FUTURE_DATA = 3
  if (!('NETWORK_LOADING' in proto)) proto.NETWORK_LOADING = 2
}

function restoreMediaPrototype() {
  for (const [name, descriptor] of savedDescriptors) {
    if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, name, descriptor)
    else delete proto[name]
  }
  savedDescriptors.clear()
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMediaPrototype()
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
  downloadMediaURL.mockReset()
  resolveStreamUrl.mockReset()
  resolveStreamUrl.mockReturnValue('blob:stream-9')
})

afterEach(() => {
  vi.useRealTimers()
  restoreMediaPrototype()
  resetMediaUrlMirror()
  document.body.replaceChildren()
})

// Полный доезд открытия: doubleRaf + страховочный таймер open (200+100) + rAF
async function settleOpen(p: Promise<void>) {
  await vi.advanceTimersByTimeAsync(600)
  await p
}

// Довести до живого плеера: полёт + canplay-гейт createPlayer
async function openWithPlayer(v: TestViewer, media: ViewerMedia) {
  const p = v.callOpenMedia({ media, fromRight: 0 })
  await settleOpen(p)
  const video = v.contentMap.mover.querySelector('video') as MediaStub
  video.dispatchEvent(new Event('canplay'))
  await vi.advanceTimersByTimeAsync(100)
  return video
}

describe('_openMedia video: gif-режим (tweb :2597-2602)', () => {
  it('gif — muted + loop + autoplay, плеер НЕ создаётся', async () => {
    const v = makeViewer()
    const video = await openWithPlayer(v, vid({ gif: true }))

    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.autoplay).toBe(true)
    expect(v.contentMap.mover.querySelector('.ckin__player')).toBeNull()
    expect(v.whole.classList.contains('has-video')).toBe(false)
  })
})

// Пин добивки VIDEO_MIN_WIDTH (tweb :2479-2493): узкое видео С плеером
// добивается до 420px, gif (без плеера) — нет. Найдено контрольной мутацией
// при приёмке Task 15: гейт `isVideo && !media.gif` у добивки не был запинен —
// второй gif-гейт внутри createPlayer маскировал его снятие.
describe('_openMedia video: добивка VIDEO_MIN_WIDTH (tweb :2479-2493)', () => {
  it('узкое видео добивается до 420, узкий gif — нет', async () => {
    const v = makeViewer()
    await openWithPlayer(v, vid({ width: 100, height: 80 }))
    expect(parseFloat(v.contentMap.media.style.width)).toBe(420)

    const g = makeViewer()
    await openWithPlayer(g, vid({ width: 100, height: 80, gif: true }))
    expect(parseFloat(g.contentMap.media.style.width)).toBeLessThan(420)
  })
})

// tweb :2471 отдаёт в setAttachmentSize САМО медиа (`photo: media`), и у
// документа дефолт натурального размера 512×512 (setAttachmentSize.ts:52-56).
// Пока подставлялось общее 100, видео без размеров кадра в атрибутах открывалось
// квадратиком 200×200 (покрытие MIN_SIDE_SIZE) вместо 512×512.
describe('_openMedia video: дефолт натурального размера документа (tweb :52-56)', () => {
  it('видео без размеров открывается от 512, а не от 100', async () => {
    const v = makeViewer()
    await openWithPlayer(v, vid({ width: 0, height: 0 }))
    // окно happy-dom 1024×768 → бокс 1024×578, 512×512 влезает целиком (noZoom)
    expect(v.contentMap.media.style.width).toBe('512px')
    expect(v.contentMap.media.style.height).toBe('512px')
  })
})

describe('_openMedia video: loop-порог (tweb :2603-2605)', () => {
  it('duration < 60 → loop', async () => {
    const v = makeViewer()
    const video = await openWithPlayer(v, vid({ duration: 30 }))
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(false) // не gif-режим
  })

  it('duration ≥ 60 → без loop', async () => {
    const v = makeViewer()
    const video = await openWithPlayer(v, vid({ duration: 120 }))
    expect(video.loop).toBe(false)
  })
})

describe('_openMedia video: плеер строго после Promise.all([canplay, onAnimationEnd]) (tweb :2627-2640)', () => {
  it('canplay до конца полёта плеера не даёт; после страховочного таймера — даёт', async () => {
    const v = makeViewer()
    const p = v.callOpenMedia({ media: vid({ duration: 120 }), fromRight: 0 })

    // doubleRaf прошёл, страховочный таймер (200+100) ещё НЕ дожат
    await vi.advanceTimersByTimeAsync(100)
    const mover = v.contentMap.mover
    const video = mover.querySelector('video') as MediaStub
    expect(video).not.toBeNull()

    // первый гейт (canplay) пройден — второй (onAnimationEnd) ещё нет
    video.dispatchEvent(new Event('canplay'))
    await vi.advanceTimersByTimeAsync(50)
    expect(mover.querySelector('.ckin__player')).toBeNull()
    expect(v.player).toBeUndefined()

    // конец полёта → createPlayer
    await vi.advanceTimersByTimeAsync(450)
    expect(mover.querySelector('.ckin__player')).not.toBeNull()
    expect(v.player).not.toBeUndefined()
    expect(v.whole.classList.contains('has-video')).toBe(true)
    expect(v.whole.classList.contains('has-video-controls')).toBe(true)

    await p
  })
})

describe('_openMedia video: буферизация (tweb :2742-2803)', () => {
  it('нехватка данных на конец полёта → is-buffering + стрим-кольцо; canplay → detach', async () => {
    const v = makeViewer()
    const attach = vi.spyOn(v.streamablePreloader, 'attach')
    const detach = vi.spyOn(v.streamablePreloader, 'detach')

    const p = v.callOpenMedia({ media: vid({ duration: 120 }), fromRight: 0 })
    await settleOpen(p)

    // readyState 0 < HAVE_FUTURE_DATA на onAnimationEnd → буферизация
    const video = v.contentMap.mover.querySelector('video') as MediaStub
    expect(attach).toHaveBeenCalledWith(v.contentMap.mover, true)
    expect(video.parentElement!.classList.contains('is-buffering')).toBe(true)
    expect(detach).not.toHaveBeenCalled()

    // canplay — кольцо снимается; класс уходит с тогдашнего родителя
    // (аспектера) ДО репарента видео в плеер: проверяем всё поддерево мувера,
    // а не нового родителя — иначе протухший is-buffering на аспектере
    // остался бы незамеченным
    video.dispatchEvent(new Event('canplay'))
    await vi.advanceTimersByTimeAsync(100)
    expect(detach).toHaveBeenCalled()
    expect(v.contentMap.mover.querySelector('.is-buffering')).toBeNull()

    // повторный голод сети: waiting при NETWORK_LOADING и readyState < 3
    attach.mockClear()
    video.__networkState = 2
    video.__readyState = 1
    video.dispatchEvent(new Event('waiting'))
    expect(attach).toHaveBeenCalledWith(v.contentMap.mover, true)
    expect(video.parentElement!.classList.contains('is-buffering')).toBe(true)
  })
})

describe('createPlayer: toggleControls плеера ведёт has-video-controls на whole (tweb :2712-2714)', () => {
  it('hideControls → класс снят, showControls → возвращён', async () => {
    const v = makeViewer()
    await openWithPlayer(v, vid({ duration: 120 }))
    const player = v.player!

    player.showControls()
    expect(v.whole.classList.contains('has-video-controls')).toBe(true)

    player.hideControls()
    expect(v.whole.classList.contains('has-video-controls')).toBe(false)

    player.showControls()
    expect(v.whole.classList.contains('has-video-controls')).toBe(true)
  })
})

describe('updateVideoControlsLock: зум запирает контролы (tweb :958-968)', () => {
  it('зум → lockControls(false): disable-hover + скрытые контролы; сброс зума — разлочка', async () => {
    const v = makeViewer()
    await openWithPlayer(v, vid({ duration: 120 }))
    const wrapper = v.contentMap.mover.querySelector('.ckin__player') as HTMLElement

    v.zoomIn()
    expect(wrapper.classList.contains('disable-hover')).toBe(true)
    expect(wrapper.classList.contains('show-controls')).toBe(false)

    v.zoomReset()
    expect(wrapper.classList.contains('disable-hover')).toBe(false)
  })
})

// Пауза слоя Esc/Back на время картинки-в-картинке — tweb :2682-2685.
// Вьювера на экране нет (overlay снят, мувер прозрачный), и Esc/Back обязаны
// уйти тому, кто под ним, а не «закрывать» невидимое окно.
describe('_openMedia video: PiP снимает слой Esc/Back (tweb :2682-2685)', () => {
  it('вход в PiP снимает слой, возврат — ставит обратно', async () => {
    // Кнопка PiP (а с ней и слушатели enter/leave) создаётся только при
    // поддержке видео-PiP браузером; в happy-dom её нет.
    const saved = Object.getOwnPropertyDescriptor(Document.prototype, 'pictureInPictureEnabled')
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true })

    const pushItem = vi.fn<(item: ViewerNavigationItem) => void>()
    const removeItem = vi.fn<(item: ViewerNavigationItem) => void>()
    const v = makeViewer()
    v.navigation = { pushItem, removeItem }

    const video = await openWithPlayer(v, vid({ duration: 30 }))
    expect(pushItem).toHaveBeenCalledTimes(1)
    const item = v.navigationItemPub!

    video.dispatchEvent(new Event('enterpictureinpicture'))
    await vi.advanceTimersByTimeAsync(100) // debouncePipTime
    expect(removeItem).toHaveBeenCalledWith(item)

    video.dispatchEvent(new Event('leavepictureinpicture'))
    await vi.advanceTimersByTimeAsync(100)
    expect(pushItem).toHaveBeenCalledTimes(2)
    expect(pushItem.mock.calls[1][0]).toBe(item) // тот же слой, не новый

    Reflect.deleteProperty(document, 'pictureInPictureEnabled')
    if (saved) Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', saved)
  })
})
