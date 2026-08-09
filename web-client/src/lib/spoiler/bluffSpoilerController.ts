// BluffSpoilerController — «блеф-спойлер»: порт tweb `components/bluffSpoilerController.ts`.
// Это он рисует замаскированный адрес почты на экране восстановления пароля:
// буквы под маской — сплошные плашки (`.bluff-spoiler-letter{background: currentColor}`),
// а живость даёт mask-image, который 15 раз в секунду подменяется кадром симуляции
// частиц из воркера.
//
// Маска — групповой эффект: одного inline-обновления на обёртке хватает на всё
// поддерево букв, и инвалидация стиля ограничена этим элементом (глобальное
// правило заставляло бы браузер обходить документ на каждом кадре).
import { retainSpoilerRenderer, type SpoilerRendererConnection } from './spoilerRendererConnection'
import {
  animationsEnabled,
  isWorkerSimSupported,
  spoilerSimDpr,
  TEXT_SPOILER_HEIGHT,
  TEXT_SPOILER_WIDTH,
} from './spoilerSupport'
import type { SpoilerRendererOutMessage } from './spoilerRenderer.worker'

// ЧЕСТНЫЙ ФОЛБЭК (в tweb его нет): статическая зернистая маска того же тайла.
// Ставится, когда живой симуляции нет или она не поднялась — без маски буквы
// превратятся в сплошные плашки, а с `opacity: 0` из `_spoiler.scss` адрес просто
// исчезнет. Уходить с неё нельзя, пока WebGL2 может быть недоступен (старый
// браузер, выключённое аппаратное ускорение, headless).
const STATIC_MASK_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='1'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 8 -4'/%3E%3C/filter%3E%3Crect width='240' height='120' filter='url(%23n)'/%3E%3C/svg%3E"

// Живой кадр может и не приехать без единой ошибки (например, кодек откажет на
// convertToBlob) — тогда через этот срок включаем статический фолбэк.
// отступление от tweb: у оригинала такой страховки нет, спойлер просто остался бы
// невидимым.
const FIRST_FRAME_TIMEOUT = 1500

const maskProperty = CSS.supports('mask-image', 'none') ? 'mask-image' : '-webkit-mask-image'

const activeElements = new Set<HTMLElement>()
const appliedMaskURLs = new WeakMap<HTMLElement, string>()

let connection: SpoilerRendererConnection | undefined
let latestMaskURL: string | undefined
/** Ждём кадр из воркера; false — сидим на статическом фолбэке. */
let live = false
let firstFrameTimeoutId: number | undefined

const applyMask = (element: HTMLElement) => {
  const url = latestMaskURL ?? (live ? undefined : STATIC_MASK_URL)
  if (!url || appliedMaskURLs.get(element) === url) return

  appliedMaskURLs.set(element, url)
  element.style.setProperty(maskProperty, `url("${url}")`)
  element.classList.add('is-visible')
}

/** Живой рендер отвалился — все активные элементы возвращаются на статику. */
const fallBackToStatic = () => {
  if (!live) return
  live = false
  latestMaskURL = undefined
  // держать воркер, который больше не даёт кадров, незачем
  connection?.release()
  connection = undefined
  activeElements.forEach(applyMask)
}

const onMessage = (message: SpoilerRendererOutMessage) => {
  if (message.type === 'bluff-mask') {
    if (firstFrameTimeoutId !== undefined) {
      clearTimeout(firstFrameTimeoutId)
      firstFrameTimeoutId = undefined
    }
    if (!activeElements.size) return

    latestMaskURL = message.url
    activeElements.forEach(applyMask)
  } else if (message.type === 'text-init-failed' || message.type === 'connection-error') {
    fallBackToStatic()
  }
}

const startWorkerSim = () => {
  if (connection) {
    connection.postMessage({ type: 'bluff-play' })
    return
  }

  connection = retainSpoilerRenderer(onMessage)
  live = true

  connection.postMessage({
    type: 'text-init',
    width: TEXT_SPOILER_WIDTH,
    height: TEXT_SPOILER_HEIGHT,
    dpr: spoilerSimDpr(),
  })
  connection.postMessage({ type: 'bluff-play' })

  firstFrameTimeoutId = window.setTimeout(() => {
    firstFrameTimeoutId = undefined
    fallBackToStatic()
  }, FIRST_FRAME_TIMEOUT)
}

/**
 * Подключает элемент-обёртку спойлера к симуляции. Возвращает функцию отписки:
 * последний отписавшийся гасит симуляцию и отпускает воркер (тот завершается
 * вместе со своим GL-контекстом).
 */
function retainBluffSpoiler(element: HTMLElement) {
  activeElements.add(element)

  // при выключенных анимациях симуляция не крутится вхолостую — сразу статика
  if (animationsEnabled() && isWorkerSimSupported()) startWorkerSim()

  applyMask(element)

  return () => {
    activeElements.delete(element)
    appliedMaskURLs.delete(element)
    if (activeElements.size) return

    if (firstFrameTimeoutId !== undefined) {
      clearTimeout(firstFrameTimeoutId)
      firstFrameTimeoutId = undefined
    }
    latestMaskURL = undefined
    live = false
    if (connection) {
      connection.postMessage({ type: 'bluff-pause' })
      connection.release()
      connection = undefined
    }
  }
}

/**
 * ref-колбэк React 19: возвращённая функция вызывается при размонтировании
 * (поэтому вызова с `null` не будет).
 */
export const bluffSpoilerRef = (element: HTMLElement | null) => {
  if (!element) return
  return retainBluffSpoiler(element)
}
