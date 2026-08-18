// Ручка «оверлей спойлеров бабла ↔ воркер».
//
// Сама механика живёт в `DotRenderer.attachTextSpoilerOverlay`
// (`components/dotRenderer.ts`) — там же, где она в tweb; этот модуль лишь
// подаёт её React-компоненту `MessageSpoilerOverlay` в привычной ему форме
// (play/pause/detach одним объектом). Второй реализации не заводим.
//
// Канва бабла отдаётся воркеру через transferControlToOffscreen — страница после
// этого только меряет DOM и шлёт геометрию/цвета/команды раскрытия, а рисует всё
// воркер. Соединение рефкаунтное: последний отпустивший гасит воркер вместе с
// GL-контекстом.
import DotRenderer from '@components/dotRenderer'
import { animationsEnabled, isWorkerSimSupported } from './spoilerSupport'
import type { SpoilerOverlayRect, SpoilerOverlayUpdate } from './spoilerRenderer.worker'

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

/** Оверлей вообще применим (иначе бабл остаётся на CSS-фолбэке из `_spoiler.scss`). */
export const canUseMessageSpoilerOverlay = () => animationsEnabled() && isWorkerSimSupported()

export function attachMessageSpoilerOverlay(
  canvas: HTMLCanvasElement,
  callbacks: { onPainted: () => void; onUnavailable: () => void },
): MessageSpoilerOverlayHandle | null {
  if (!canUseMessageSpoilerOverlay()) return null

  const attached = DotRenderer.attachTextSpoilerOverlay({
    canvas,
    onPainted: callbacks.onPainted,
    onUnavailable: callbacks.onUnavailable,
  })
  if (!attached) return null

  const { animation, dpr, overlay, detach } = attached

  return {
    dpr,
    update: overlay.update,
    unwrap: overlay.unwrap,
    wrap: overlay.wrap,
    reset: overlay.reset,
    clear: overlay.clear,
    play: () => animation.play(),
    pause: () => animation.pause(),
    detach,
  }
}
