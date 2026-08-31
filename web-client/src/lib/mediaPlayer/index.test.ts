// Тесты vanilla-плеера (Task 15): chrome-разметка 1:1 tweb buildControls,
// MediaProgressLine (скраб двигает currentTime, кламп у конца), VolumeSelector
// (mute-тоггл меняет иконку и media.muted), меню скоростей (персист в
// settings-стор). Среда — happy-dom; медиа-API стабится (см. base.video.test).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import VideoPlayer from './index'
import MediaProgressLine from '@components/mediaProgressLine'
import VolumeSelector from '@components/volumeSelector'
import ListenerSetter from '@helpers/listenerSetter'
import { glyph } from '@core/tgico-icons'
import { useSettingsStore } from '../../settings'
import { loadLang, useI18nStore } from '../../i18n'

type MediaStub = HTMLVideoElement & {
  __paused?: boolean
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
  define('currentTime', {
    get(this: MediaStub) { return this.__currentTime ?? 0 },
    set(this: MediaStub, v: number) { this.__currentTime = v },
  })
  define('duration', { get(this: MediaStub) { return this.__duration ?? NaN } })
  define('buffered', {
    get() { return { length: 0, start: () => 0, end: () => 0 } },
  })
  define('src', {
    get(this: MediaStub) { return this.getAttribute('src') ?? '' },
    set(this: MediaStub, v: string) { this.setAttribute('src', v) },
  })
}

function restoreMediaPrototype() {
  for (const [name, descriptor] of savedDescriptors) {
    if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, name, descriptor)
    else delete proto[name]
  }
  savedDescriptors.clear()
}

beforeEach(() => {
  stubMediaPrototype()
})

afterEach(() => {
  restoreMediaPrototype()
  useSettingsStore.getState().update({ videoRate: 1 })
  document.body.replaceChildren()
})

function makeVideo(duration?: number): MediaStub {
  const video = document.createElement('video') as MediaStub
  if (duration !== undefined) video.__duration = duration
  return video
}

function makePlayer(video: MediaStub) {
  const host = document.createElement('div')
  host.append(video)
  document.body.append(host)
  return new VideoPlayer({ video, streamable: true, duration: video.__duration })
}

describe('VideoPlayer: chrome-разметка 1:1 tweb (buildControls :603-628)', () => {
  it('дерево ckin__player: video → big toggle → gradient → controls (+ prepend прогресса)', () => {
    const video = makeVideo(90)
    makePlayer(video)

    const wrapper = document.querySelector('.ckin__player') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.classList.contains('default')).toBe(true)
    expect(video.classList.contains('ckin__video')).toBe(true)
    expect(video.parentElement).toBe(wrapper)

    // порядок детей load-bearing (правила _ckin.scss — по соседям)
    const children = [...wrapper.children]
    expect(children[0]).toBe(video)
    expect(children[1].matches('button.default__button--big.toggle')).toBe(true)
    expect(children[2].matches('.default__gradient-bottom.ckin__controls')).toBe(true)
    expect(children[3].matches('.default__controls.ckin__controls')).toBe(true)

    const controls = children[3]
    // MediaProgressLine prepend'ится перед bottom-controls (tweb :253)
    expect(controls.firstElementChild!.matches('.progress-line.media-progress-line')).toBe(true)
    expect(controls.querySelector('.bottom-controls.night')).not.toBeNull()

    const left = controls.querySelector('.left-controls')!
    expect(left.querySelector('button.default__button.toggle')).not.toBeNull()
    expect(left.querySelector('.player-volume')).not.toBeNull()
    expect(left.querySelector('.ckin__time .ckin__time-elapsed')).not.toBeNull()
    expect(left.querySelector('.ckin__time .ckin__time-duration')!.textContent).toBe('1:30')

    const right = controls.querySelector('.right-controls')!
    expect(right.querySelector('.playback-rate-button-menu')).not.toBeNull()
  })
})

describe('VideoPlayer: меню скоростей — персист в settings-стор (как React-плеер)', () => {
  it('клик по пункту 2x ставит playbackRate и пишет videoRate', () => {
    const video = makeVideo(90)
    const player = makePlayer(video)

    const items = [...document.querySelectorAll('.playback-rate-button-menu .btn-menu-item')]
    expect(items.length).toBe(5) // VIDEO_RATES tweb: 0.5/1/1.5/2/3
    const item2x = items.find((el) => el.textContent!.includes('2x'))!
    item2x.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(video.playbackRate).toBe(2)
    expect(useSettingsStore.getState().videoRate).toBe(2)
    player.cleanup()
  })

  // Задача 8: плеер живёт открытым, и смена языка при нём обязана перевести
  // подпись НА МЕСТЕ. Проверяется разделение ролей оригинала
  // (`playbackRateButton.tsx:70-71`): «Normal» — подпись (живой узел), «2x» —
  // данные (число со суффиксом), и переводу они подлежат по-разному.
  it('смена языка при открытом плеере переводит «Normal», не трогая «2x»', async() => {
    const video = makeVideo(90)
    const player = makePlayer(video)

    // Подписи, а не пункты целиком: у пункта в тексте ещё и глиф галочки.
    const labels = [...document.querySelectorAll('.playback-rate-button-menu .btn-menu-item-text')]
    const normal = labels.find((el) => el.textContent === 'Normal')!
    const x2 = labels.find((el) => el.textContent === '2x')!
    expect(normal).toBeDefined()
    expect(x2).toBeDefined()

    useI18nStore.getState().setLang('ru')
    await loadLang('ru')

    expect(normal.textContent).toBe('Обычная')
    expect(x2.textContent).toBe('2x')

    player.cleanup()
    useI18nStore.getState().setLang('en')
    await loadLang('en')
  })
})

describe('MediaProgressLine: скраб по треку двигает currentTime', () => {
  class TestMPL extends MediaProgressLine {
    scrubAt(x: number, width: number) {
      // rect ставит onMouseDown (grab-трекинг) — тест целится сразу в scrub
      this.rect = { width, height: 8, left: 0, right: width, top: 0, bottom: 8 } as DOMRect
      return this.scrub({ x, y: 4, event: new MouseEvent('mousemove') })
    }
  }

  it('середина трека → duration/2; самый конец клампится до duration − 0.1', () => {
    const video = makeVideo(100)
    const mpl = new TestMPL({ withTime: true })
    mpl.setMedia({ media: video, streamable: true, duration: 100 })

    mpl.scrubAt(50, 100)
    expect(video.currentTime).toBeCloseTo(50, 0)

    mpl.scrubAt(100, 100)
    expect(video.currentTime).toBeCloseTo(99.9, 5)

    mpl.cleanup()
  })

  it('streamable добавляет полосу progress-line__loaded', () => {
    const video = makeVideo(100)
    const mpl = new MediaProgressLine({ withTime: true })
    mpl.setMedia({ media: video, streamable: true, duration: 100 })
    expect(mpl.container.querySelector('.progress-line__loaded')).not.toBeNull()
    mpl.cleanup()
  })
})

describe('VolumeSelector: mute-тоггл меняет иконку и media.muted', () => {
  it('volume_up → volume_off → volume_up', () => {
    const video = makeVideo()
    video.volume = 1
    const vs = new VolumeSelector({ listenerSetter: new ListenerSetter(), media: video })
    const icon = () => vs.btn.querySelector('.button-icon')!.textContent

    expect(icon()).toBe(glyph('volume_up'))

    vs.onMuteClick()
    expect(video.muted).toBe(true)
    expect(icon()).toBe(glyph('volume_off'))

    vs.onMuteClick()
    expect(video.muted).toBe(false)
    expect(icon()).toBe(glyph('volume_up'))
  })

  it('пороги иконок tweb: < 0.25 → volume_mute, 0.25..0.5 → volume_down', () => {
    const video = makeVideo()
    const vs = new VolumeSelector({ listenerSetter: new ListenerSetter(), media: video })
    const icon = () => vs.btn.querySelector('.button-icon')!.textContent

    vs.setVolume({ volume: 0.1, muted: false })
    expect(icon()).toBe(glyph('volume_mute'))

    vs.setVolume({ volume: 0.4, muted: false })
    expect(icon()).toBe(glyph('volume_down'))
  })
})
