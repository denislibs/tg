// Мост «страница ↔ воркер-рендерер»: порт tweb `components/spoilerRendererConnection.ts`.
// Потребители (блеф-спойлер почты, в будущем — оверлей спойлеров в сообщениях)
// берут рефкаунт-ручку со своим слушателем; сам воркер один на вкладку и живёт,
// пока есть хотя бы один держатель.
//
// отступление от tweb: ветка SharedWorker не портирована — в tweb она закрыта
// флагом IS_SHARED_WORKER_OFFSCREEN_CANVAS_SUPPORTED = false (кросс-процессный
// present убивает рендерер), то есть в реальности всегда работает dedicated Worker.
import type { SpoilerRendererInMessage, SpoilerRendererOutMessage } from './spoilerRenderer.worker'

export interface SpoilerRendererConnection {
  postMessage: (message: SpoilerRendererInMessage) => void
  release: () => void
}

const messageListeners = new Set<(message: SpoilerRendererOutMessage) => void>()
let worker: Worker | undefined
let users = 0
let failed = false

/** Воркер уже падал — новые спойлеры сразу идут на статический фолбэк. */
export function hasSpoilerRendererFailed() {
  return failed
}

function onError(error: ErrorEvent) {
  console.error('[spoiler-renderer] worker failed, falling back to the static mask', error.message)
  failed = true
  messageListeners.forEach((listener) => listener({ type: 'connection-error' }))
}

function connect() {
  const created = new Worker(new URL('./spoilerRenderer.worker.ts', import.meta.url), {
    type: 'module',
  })
  created.addEventListener('error', onError)
  created.addEventListener('message', (event: MessageEvent<SpoilerRendererOutMessage>) => {
    messageListeners.forEach((listener) => listener(event.data))
  })
  return created
}

export function retainSpoilerRenderer(
  onMessage: (message: SpoilerRendererOutMessage) => void,
): SpoilerRendererConnection {
  ++users
  worker ??= connect()
  messageListeners.add(onMessage)

  let released = false
  return {
    postMessage: (message) => {
      if (!released) worker?.postMessage(message)
    },
    release: () => {
      if (released) return
      released = true

      messageListeners.delete(onMessage)
      if (!--users && worker) {
        // terminate убивает поток вместе с GL-контекстом симуляции — отдельного
        // 'bye' (он в tweb нужен SharedWorker'у, чтобы забыть состояние вкладки)
        // dedicated-воркеру не требуется
        worker.terminate()
        worker = undefined
      }
    },
  }
}
