// Воркер-рендерер спойлеров: порт tweb `components/spoilerRenderer.worker.ts`.
// Держит WebGL2-симуляцию частиц (DotRendererCore) на OffscreenCanvas, крутит её
// таймером и раздаёт странице кадры — перекодированные в data-URL маски.
//
// Симуляция ОДНА на весь клиент: и «блеф-спойлер» (замаскированный адрес почты),
// и — когда портируем оверлей спойлеров в сообщениях — баблы сэмплят один и тот же
// тайл 240×120, это ровно схема tweb.
//
// отступление от tweb: у нас только dedicated Worker (в tweb ветка SharedWorker
// закрыта флагом IS_SHARED_WORKER_OFFSCREEN_CANVAS_SUPPORTED = false), поэтому
// вместо набора PortState (по вкладке) и карт симуляций по dpr — одно состояние
// на воркер: вкладка тут ровно одна и dpr у неё один. Ветки media-* / overlay-*
// не портированы (потребителей нет): их место — этот switch.
import DotRendererCore, { type DotRendererConfig } from './dotRendererCore'

export interface SpoilerRendererSimInit {
  width: number
  height: number
  dpr: number
  config: DotRendererConfig
}

export type SpoilerRendererInMessage =
  | ({ type: 'text-init' } & SpoilerRendererSimInit)
  | { type: 'bluff-play' }
  | { type: 'bluff-pause' }

export type SpoilerRendererOutMessage =
  | { type: 'bluff-mask'; url: string }
  // WebGL2 не поднялся уже в воркере (страница проверяет отдельно, но драйвер
  // может отказать именно здесь) — потребитель обязан уйти на статический фолбэк
  | { type: 'text-init-failed' }
  // синтезируется мостом spoilerRendererConnection, отсюда не приходит
  | { type: 'connection-error' }

// В tsconfig нет lib "webworker" (проект типизируется под DOM), поэтому глобалы
// воркера описываем узко — ровно тем, чем пользуемся.
interface WorkerContext {
  onmessage: ((event: MessageEvent<SpoilerRendererInMessage>) => void) | null
  postMessage: (message: SpoilerRendererOutMessage) => void
  setTimeout: (handler: () => void, timeout: number) => number
}
const ctx = self as unknown as WorkerContext

const FRAME_INTERVAL = 1000 / 60
const ENCODE_INTERVAL = 4 * (1000 / 60) // раз в 4 кадра (при 60fps) — чтобы не жечь CPU

interface TextSim {
  core: DotRendererCore
  canvas: OffscreenCanvas
  encoding: boolean
  lastEncodeTime: number
}

let textSim: TextSim | null = null
let bluffPlaying = false
let timerId: number | undefined

const toDataURL = (blob: Blob) =>
  blob.arrayBuffer().then((buffer) => {
    // data:-URL резолвится синхронно, когда на него ссылается CSS; blob: грузится
    // асинхронно на каждой подмене и мигает маской (обоснование — из tweb).
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return `data:${blob.type};base64,${btoa(binary)}`
  })

const encodeBluffMask = (sim: TextSim) => {
  sim.encoding = true
  // webp здесь пиксель-в-пиксель как png, но вдвое легче; браузеры без webp
  // молча кодируют png
  sim.canvas
    .convertToBlob({ type: 'image/webp', quality: 1 })
    .then(toDataURL)
    .then(
      (url) => {
        sim.encoding = false
        if (bluffPlaying) ctx.postMessage({ type: 'bluff-mask', url })
      },
      () => {
        sim.encoding = false
      },
    )
}

const frame = () => {
  const sim = textSim
  if (sim && bluffPlaying) {
    sim.core.draw()

    const now = Date.now()
    if (!sim.encoding && now - sim.lastEncodeTime >= ENCODE_INTERVAL) {
      sim.lastEncodeTime = now
      encodeBluffMask(sim)
    }
  }

  // setTimeout, а не requestAnimationFrame: из канваса симуляции ничего не
  // презентится, темп нужен только шагам симуляции (и rAF в воркере без
  // трансфернутого канваса всё равно не тикает)
  timerId = bluffPlaying ? ctx.setTimeout(frame, FRAME_INTERVAL) : undefined
}

const ensureLoop = () => {
  if (timerId !== undefined || !bluffPlaying || !textSim) return

  textSim.core.lastDrawTime = Date.now() // чтобы первый dt не был гигантским
  frame()
}

// Разрушать симуляцию отдельным сообщением не нужно: последний потребитель
// отпускает мост, тот делает terminate() — поток умирает вместе с GL-контекстом.
ctx.onmessage = (event) => {
  const message = event.data
  switch (message.type) {
    case 'text-init': {
      if (textSim) break

      try {
        const canvas = new OffscreenCanvas(message.width * message.dpr, message.height * message.dpr)
        const core = new DotRendererCore(canvas, message.config)
        if (!core.init()) throw new Error('init failed')
        textSim = { core, canvas, encoding: false, lastEncodeTime: 0 }
      } catch {
        ctx.postMessage({ type: 'text-init-failed' })
        break
      }

      ensureLoop()
      break
    }

    case 'bluff-play': {
      bluffPlaying = true
      ensureLoop()
      break
    }

    case 'bluff-pause': {
      bluffPlaying = false
      break
    }
  }
}
