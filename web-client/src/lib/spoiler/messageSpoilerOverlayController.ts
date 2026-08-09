// Ручка «оверлей спойлеров бабла ↔ воркер»: аналог tweb
// `DotRenderer.attachTextSpoilerOverlay` (components/dotRenderer.ts).
//
// Канва бабла отдаётся воркеру через transferControlToOffscreen — страница после
// этого только меряет DOM и шлёт геометрию/цвета/команды раскрытия, а рисует всё
// воркер. Соединение рефкаунтное: последний отпустивший гасит воркер вместе с
// GL-контекстом.
import { retainSpoilerRenderer, type SpoilerRendererConnection } from './spoilerRendererConnection'
import {
  animationsEnabled,
  isWorkerSimSupported,
  spoilerSimDpr,
  TEXT_SPOILER_HEIGHT,
  TEXT_SPOILER_WIDTH,
} from './spoilerSupport'
import type {
  SpoilerOverlayRect,
  SpoilerOverlayUpdate,
  SpoilerRendererOutMessage,
} from './spoilerRenderer.worker'

export interface MessageSpoilerOverlayHandle {
  readonly dpr: number
  update: (payload: Omit<SpoilerOverlayUpdate, 'type' | 'id'>) => void
  unwrap: (coords: [number, number], maxDist: number, duration: number) => void
  wrap: (duration: number) => void
  reset: () => void
  clear: () => void
  play: () => void
  pause: () => void
  /** снять оверлей и отпустить воркер; после вызова ручка мертва */
  detach: () => void
}

export type { SpoilerOverlayRect }

let createdIndex = 0

/** Оверлей вообще применим (иначе бабл остаётся на CSS-фолбэке из `_spoiler.scss`). */
export const canUseMessageSpoilerOverlay = () => animationsEnabled() && isWorkerSimSupported()

export function attachMessageSpoilerOverlay(
  canvas: HTMLCanvasElement,
  callbacks: { onPainted: () => void; onUnavailable: () => void },
): MessageSpoilerOverlayHandle | null {
  if (!canUseMessageSpoilerOverlay()) return null

  let offscreen: OffscreenCanvas
  try {
    offscreen = canvas.transferControlToOffscreen()
  } catch {
    return null
  }

  const id = ++createdIndex
  const dpr = spoilerSimDpr()

  let connection: SpoilerRendererConnection | undefined
  const onMessage = (message: SpoilerRendererOutMessage) => {
    if (message.type === 'overlay-painted') {
      if (message.id === id) callbacks.onPainted()
    } else if (message.type === 'text-init-failed' || message.type === 'connection-error') {
      // симуляции не будет — бабл обязан вернуться на CSS-фолбэк, иначе спойлер
      // останется пустым местом (или, хуже, откроется)
      callbacks.onUnavailable()
    }
  }

  connection = retainSpoilerRenderer(onMessage)
  // симуляция одна на весь клиент: повторный text-init воркер игнорирует
  connection.postMessage({
    type: 'text-init',
    width: TEXT_SPOILER_WIDTH,
    height: TEXT_SPOILER_HEIGHT,
    dpr: spoilerSimDpr(),
  })
  connection.postMessage({ type: 'overlay-attach', id, canvas: offscreen, dpr }, [offscreen])

  return {
    dpr,
    update: (payload) => connection?.postMessage({ type: 'overlay-update', id, ...payload }),
    unwrap: (coords, maxDist, duration) =>
      connection?.postMessage({ type: 'overlay-unwrap', id, coords, maxDist, duration }),
    wrap: (duration) => connection?.postMessage({ type: 'overlay-wrap', id, duration }),
    reset: () => connection?.postMessage({ type: 'overlay-reset', id }),
    clear: () => connection?.postMessage({ type: 'overlay-clear', id }),
    play: () => connection?.postMessage({ type: 'overlay-play', id }),
    pause: () => connection?.postMessage({ type: 'overlay-pause', id }),
    detach: () => {
      if (!connection) return
      connection.postMessage({ type: 'overlay-detach', id })
      connection.release()
      connection = undefined
    },
  }
}
