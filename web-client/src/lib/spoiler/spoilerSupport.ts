// Общие проверки доступности спойлер-рендера: их спрашивают оба потребителя —
// «блеф-спойлер» адреса почты (bluffSpoilerController) и оверлей спойлеров в
// сообщениях (components/messages/MessageSpoilerOverlay).
//
// В tweb `isWorkerSimSupported` — статический метод `BluffSpoilerController`;
// у нас он вынесен сюда (одна реализация на подсистему), а метод оригинала
// оставлен тонкой делегацией — вызовы выглядят как в tweb.
import { hasSpoilerRendererFailed } from './spoilerRendererConnection'

// tweb components/dotRenderer.ts — размер тайла симуляции; его же ждёт
// `styles/tweb/_spoiler.scss` (`mask-size: 240px 120px; mask-repeat: repeat`)
export const TEXT_SPOILER_WIDTH = 240
export const TEXT_SPOILER_HEIGHT = 120

/**
 * dpr симуляции ограничен двойкой (tweb): для блеф-маски кадр перекодируется в
 * data-URL, а её вес растёт квадратично; оверлею тот же кламп даёт общий тайл.
 */
export const spoilerSimDpr = () => Math.min(2, window.devicePixelRatio)

/** Анимации выключены — крутить симуляцию вхолостую нельзя. */
export const animationsEnabled = () =>
  !document.body.classList.contains('animation-level-0') &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

let workerSimSupported: boolean | undefined

/**
 * WebGL2 в OffscreenCanvas — то же, что понадобится воркеру. Контекст сразу
 * отпускаем: проверка одноразовая, а число живых GL-контекстов у браузера
 * ограничено (отступление от tweb — там пробный контекст остаётся висеть).
 */
export function isWorkerSimSupported() {
  if (hasSpoilerRendererFailed()) return false
  if (workerSimSupported === undefined) {
    try {
      const canvas = new OffscreenCanvas(1, 1)
      const context = canvas.getContext('webgl2')
      context?.getExtension('WEBGL_lose_context')?.loseContext()
      workerSimSupported = !!context
    } catch {
      workerSimSupported = false
    }
  }
  return workerSimSupported
}
