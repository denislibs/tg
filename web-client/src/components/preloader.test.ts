// Тесты порта tweb `components/preloader.ts` (см. `preloader.ts` рядом).
//
// Фейковые таймеры sinon в vitest подменяют и `requestAnimationFrame` (кадр =
// 16 мс), и `Date` — поэтому raf-отложенные переходы (`useRafs` у SetTransition),
// `fastRaf` и замер `elapsedTime` в `attachPromise` прокручиваются
// `advanceTimersByTime`. Гейт анимаций — `liteMode.isAvailable('animations')`,
// т.е. настройка «Без анимаций» (`reduceMotion`), как в setTransition.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProgressivePreloader from './preloader'
import deferredPromise from '@helpers/cancellablePromise'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { useSettingsStore } from '@/settings'

// eslint-disable-next-line no-loss-of-precision -- константа tweb, round-trip точный (см. preloader.ts)
const TOTAL_LENGTH = 149.82473754882812
const TOTAL_LENGTH_STREAMABLE = 118.61124420166016

function host(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
  useSettingsStore.setState({ reduceMotion: false })
})

afterEach(() => {
  vi.useRealTimers()
  useSettingsStore.setState({ reduceMotion: false })
  document.body.replaceChildren()
})

describe('ProgressivePreloader: DOM tweb', () => {
  it('attach строит дерево tweb: container > you-spin-me-round > svg 27 27 54 54 + circle, иконки close/download', () => {
    const p = new ProgressivePreloader()
    const el = host()
    p.attach(el)

    const container = el.firstElementChild!
    expect(container.classList.contains('preloader-container')).toBe(true)

    const spin = container.firstElementChild!
    expect(spin.classList.contains('you-spin-me-round')).toBe(true)

    const svg = spin.firstElementChild!
    expect(svg.classList.contains('preloader-circular')).toBe(true)
    expect(svg.getAttribute('viewBox')).toBe('27 27 54 54')

    const circle = svg.firstElementChild!
    expect(circle.classList.contains('preloader-path-new')).toBe(true)
    expect(p.circle).toBe(circle)

    expect(container.querySelector('svg.preloader-close')).not.toBeNull()
    expect(container.querySelector('svg.preloader-download')).not.toBeNull()
    expect(p.totalLength).toBe(TOTAL_LENGTH)
  })

  it('streamable: viewBox 25 25 50 50, totalLength стримового кольца, класс preloader-streamable', () => {
    const p = new ProgressivePreloader({ streamable: true })
    const el = host()
    p.attach(el)

    expect(p.preloader.classList.contains('preloader-streamable')).toBe(true)
    expect(p.preloader.querySelector('svg.preloader-circular')!.getAttribute('viewBox')).toBe('25 25 50 50')
    expect(p.totalLength).toBe(TOTAL_LENGTH_STREAMABLE)
  })

  it('cancelable=false: иконок нет, класс preloader-swing', () => {
    const p = new ProgressivePreloader({ cancelable: false })
    const el = host()
    p.attach(el)

    expect(p.preloader.classList.contains('preloader-swing')).toBe(true)
    expect(p.preloader.querySelector('svg.preloader-close')).toBeNull()
    expect(p.preloader.querySelector('svg.preloader-download')).toBeNull()
  })
})

describe('ProgressivePreloader: setProgress', () => {
  it('setProgress(50) → strokeDasharray = max(5, 0.5·totalLength), totalLength', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    p.setProgress(50)
    expect(p.circle.style.strokeDasharray).toBe(`${Math.max(5, 0.5 * TOTAL_LENGTH)}, ${TOTAL_LENGTH}`)
  })

  it('setProgress(1): пол дуги — минимум 5 (tweb Math.max(5, …))', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    p.setProgress(1)
    expect(p.circle.style.strokeDasharray).toBe(`5, ${TOTAL_LENGTH}`)
  })

  it('setProgress(0) сбрасывает strokeDasharray', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    p.setProgress(50)
    p.setProgress(0)
    expect(p.circle.style.strokeDasharray).toBe('')
  })
})

describe('ProgressivePreloader: manual/клик', () => {
  it('setManual → класс manual + сброс прогресса', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    p.setProgress(50)
    p.setManual()
    expect(p.preloader.classList.contains('manual')).toBe(true)
    expect(p.circle.style.strokeDasharray).toBe('')
  })

  it('клик не в manual → promise.cancel', () => {
    const p = new ProgressivePreloader()
    const d = deferredPromise<void>()
    d.cancel = vi.fn()
    p.attach(host(), false, d)
    click(p.preloader)
    expect(d.cancel).toHaveBeenCalledTimes(1)
  })

  it('клик в manual → loadFunc, cancel не зовётся', () => {
    const p = new ProgressivePreloader()
    const d = deferredPromise<void>()
    d.cancel = vi.fn()
    const loadFunc = vi.fn()
    p.attach(host(), false, d)
    p.setDownloadFunction(loadFunc)
    p.setManual()
    click(p.preloader)
    expect(loadFunc).toHaveBeenCalledTimes(1)
    expect(d.cancel).not.toHaveBeenCalled()
  })
})

describe('ProgressivePreloader: attach/detach — is-visible через SetTransition', () => {
  it('attach: класс is-visible приезжает через 2 rAF (узел только что вставлен), detach снимает и удаляет узел', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    // узел вставлен сразу, но класс отложен на два кадра (useRafs = 2)
    expect(p.preloader.parentElement).not.toBeNull()
    expect(p.preloader.classList.contains('is-visible')).toBe(false)
    vi.advanceTimersByTime(16)
    expect(p.preloader.classList.contains('is-visible')).toBe(false)
    vi.advanceTimersByTime(16)
    expect(p.preloader.classList.contains('is-visible')).toBe(true)
    expect(p.preloader.classList.contains('animating')).toBe(true)
    vi.advanceTimersByTime(200) // TRANSITION_TIME
    expect(p.preloader.classList.contains('animating')).toBe(false)

    p.detach()
    vi.advanceTimersByTime(16) // useRafs: 1
    expect(p.preloader.classList.contains('backwards')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(p.preloader.classList.contains('is-visible')).toBe(false)
    expect(p.preloader.parentElement).toBeNull()
  })

  it('при выключенных анимациях attach/detach синхронны', () => {
    useSettingsStore.setState({ reduceMotion: true })
    const p = new ProgressivePreloader()
    p.attach(host())
    expect(p.preloader.classList.contains('is-visible')).toBe(true)
    p.detach()
    expect(p.preloader.parentElement).toBeNull()
  })

  it('attach(…, reset=true) сбрасывает прогресс', () => {
    useSettingsStore.setState({ reduceMotion: true })
    const p = new ProgressivePreloader()
    const el = host()
    p.attach(el)
    p.setProgress(50)
    p.detach()
    p.attach(el, true)
    expect(p.circle.style.strokeDasharray).toBe('')
  })
})

describe('ProgressivePreloader: attachPromise', () => {
  it('notify двигает прогресс; notify ПРОТУХШЕГО промиса игнорируется (tempId-гард)', () => {
    const p = new ProgressivePreloader()
    p.attach(host())
    const stale = deferredPromise<void>()
    const fresh = deferredPromise<void>()
    p.attachPromise(stale)
    p.attachPromise(fresh)

    stale.notifyAll!({ done: 90, total: 100 })
    expect(p.circle.style.strokeDasharray).toBe('') // протухший не сдвинул

    fresh.notifyAll!({ done: 50, total: 100 })
    expect(p.circle.style.strokeDasharray).toBe(`${Math.max(5, 0.5 * TOTAL_LENGTH)}, ${TOTAL_LENGTH}`)
  })

  it('быстрый резолв (< 150 мс): setProgress(100) и мгновенный detach', async () => {
    useSettingsStore.setState({ reduceMotion: true })
    const p = new ProgressivePreloader()
    p.attach(host())
    const d = deferredPromise<void>()
    p.attachPromise(d)
    d.resolve!()
    await d
    await Promise.resolve()
    expect(p.detached).toBe(true)
    expect(p.preloader.parentElement).toBeNull()
  })

  it('долгий резолв: detach отложен на 150 мс (дождаться перехода дуги к 100%)', async () => {
    useSettingsStore.setState({ reduceMotion: true })
    const p = new ProgressivePreloader()
    p.attach(host())
    const d = deferredPromise<void>()
    p.attachPromise(d)
    vi.advanceTimersByTime(300) // elapsedTime > TRANSITION_TIME·0.75
    d.resolve!()
    await d
    await Promise.resolve()
    expect(p.circle.style.strokeDasharray).toBe(`${TOTAL_LENGTH}, ${TOTAL_LENGTH}`)
    expect(p.detached).toBe(false)
    vi.advanceTimersByTime(150)
    expect(p.detached).toBe(true)
  })

  it('reject + tryAgainOnFail → повторный attach и manual через кадр', async () => {
    useSettingsStore.setState({ reduceMotion: true })
    const p = new ProgressivePreloader()
    p.attach(host())
    const d = deferredPromise<void>()
    p.attachPromise(d)
    d.reject!(new Error('fail'))
    await d.catch(() => {})
    await Promise.resolve()
    expect(p.detached).toBe(false)
    vi.advanceTimersByTime(16) // fastRaf
    expect(p.preloader.classList.contains('manual')).toBe(true)
  })

  it('isUpload: второй attachPromise при живом промисе игнорируется, tryAgainOnFail снят', () => {
    const p = new ProgressivePreloader({ isUpload: true })
    p.attach(host())
    const first = deferredPromise<void>()
    const second = deferredPromise<void>()
    p.attachPromise(first)
    p.attachPromise(second)
    expect(p.promise).toBe(first)

    // isUpload в конструкторе гасит tryAgainOnFail — ретрая по фейлу у аплоада нет
    second.notifyAll!({ done: 50, total: 100 })
    expect(p.circle.style.strokeDasharray).toBe('')
  })
})
