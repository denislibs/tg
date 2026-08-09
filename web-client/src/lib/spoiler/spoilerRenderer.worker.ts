// Воркер-рендерер спойлеров: порт tweb `components/spoilerRenderer.worker.ts`.
// Держит WebGL2-симуляцию частиц (DotRendererCore) на OffscreenCanvas, крутит её
// таймером и раздаёт странице кадры: «блеф-спойлеру» (замаскированный адрес почты)
// — перекодированными в data-URL масками, оверлею спойлеров в сообщениях —
// готовыми пикселями прямо в его трансфернутый канвас.
//
// Симуляция ОДНА на весь клиент: и блеф-маска, и баблы сэмплят один и тот же
// тайл 240×120 — это ровно схема tweb.
//
// отступление от tweb: у нас только dedicated Worker (в tweb ветка SharedWorker
// закрыта флагом IS_SHARED_WORKER_OFFSCREEN_CANVAS_SUPPORTED = false), поэтому
// вместо набора PortState (по вкладке) и карт симуляций по dpr — одно состояние
// на воркер: вкладка тут ровно одна и dpr у неё один. Ветка media-* не
// портирована (потребителей нет): её место — этот switch.
//
// отступление от tweb: конфиг симуляции строится ЗДЕСЬ, а не на странице
// (в tweb он приходит в `text-init`). Так `dotRendererCore` и шейдеры остаются
// в чанке воркера и не тянутся в главный чанк вслед за RichText.
import DotRendererCore, {
  buildDotRendererConfig,
  getDefaultParticlesCount,
  type DotRendererConfig,
} from './dotRendererCore'
import { drawImageFromSource } from './drawImageFromSource'
import { defaultEasing, unwrapEasing, type EasingFunction } from './bezierEasing'

export interface SpoilerRendererSimInit {
  width: number
  height: number
  dpr: number
}

/** Прямоугольник слова спойлера: координаты — CSS-пиксели относительно оверлея. */
export interface SpoilerOverlayRect {
  left: number
  top: number
  width: number
  height: number
  color?: string
}

export interface SpoilerOverlayUpdate {
  type: 'overlay-update'
  id: number
  /** размер канвы — уже в device-пикселях */
  width: number
  height: number
  rects: SpoilerOverlayRect[]
  backgroundColor: string
  particleColor: string
}

export type SpoilerRendererInMessage =
  | ({ type: 'text-init' } & SpoilerRendererSimInit)
  | { type: 'bluff-play' }
  | { type: 'bluff-pause' }
  | { type: 'overlay-attach'; id: number; canvas: OffscreenCanvas; dpr: number }
  | SpoilerOverlayUpdate
  | { type: 'overlay-unwrap'; id: number; coords: [number, number]; maxDist: number; duration: number }
  | { type: 'overlay-wrap'; id: number; duration: number }
  | { type: 'overlay-reset' | 'overlay-clear' | 'overlay-play' | 'overlay-pause' | 'overlay-detach'; id: number }

export type SpoilerRendererOutMessage =
  | { type: 'bluff-mask'; url: string }
  // WebGL2 не поднялся уже в воркере (страница проверяет отдельно, но драйвер
  // может отказать именно здесь) — потребитель обязан уйти на статический фолбэк
  | { type: 'text-init-failed' }
  // отступление от tweb (там страница ждёт только `text-inited`): подтверждаем не
  // готовность симуляции, а ФАКТ первой отрисовки слов. Страница показывает
  // настоящий текст (`can-show-spoiler-text`) только после этого — иначе сбой
  // между инитом и первым кадром обнажил бы спойлер.
  | { type: 'overlay-painted'; id: number }
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

// tweb components/dotRenderer.ts getTextSpoilerConfig — текстовый спойлер мельче
// и шустрее медийного
const getTextSpoilerConfig = (
  width: number,
  height: number,
  dpr: number,
): Partial<DotRendererConfig> => ({
  particlesCount: 4 * getDefaultParticlesCount(width, height),
  noiseSpeed: 5,
  maxVelocity: 10,
  timeScale: 1.2,
  radius: 1.8 * dpr,
  forceMult: 0.2,
  velocityMult: 0.4,
  dampingMult: 2.2,
  longevity: 5.0,
})

interface TextSim {
  core: DotRendererCore
  canvas: OffscreenCanvas
  encoding: boolean
  lastEncodeTime: number
}

interface Unwrap {
  coords: [number, number]
  maxDist: number
  from: number
  to: number
  duration: number
  startTime: number
  easing: EasingFunction
}

/**
 * Оверлей спойлеров одного бабла: геометрию и цвета (они DOM-зависимые) меряет
 * страница и присылает сюда, рисование и анимация раскрытия — здесь.
 */
interface OverlayTarget {
  id: number
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  /** частицы подкрашиваются по каждому прямоугольнику отдельно — на этой канве */
  scratch: OffscreenCanvas
  scratchContext: OffscreenCanvasRenderingContext2D
  dpr: number
  rects: SpoilerOverlayRect[]
  backgroundColor: string
  particleColor: string
  playing: boolean
  needsRedraw: boolean
  painted: boolean
  unwrap?: Unwrap
}

let textSim: TextSim | null = null
let textSimFailed = false
let bluffPlaying = false
let timerId: number | undefined
const overlayTargets = new Map<number, OverlayTarget>()

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

// tweb applyColorOnContext: перекрасить уже нарисованное, не трогая прозрачное.
const applyColorOnContext = (
  context: OffscreenCanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  context.globalCompositeOperation = 'source-atop'
  context.fillStyle = color
  context.fillRect(x, y, width, height)
  context.globalCompositeOperation = 'source-over'
}

const getUnwrapProgress = (unwrap: Unwrap) => {
  const linear = Math.min((Date.now() - unwrap.startTime) / unwrap.duration, 1)
  return unwrap.from + (unwrap.to - unwrap.from) * unwrap.easing(linear)
}

const isUnwrapSettled = (unwrap: Unwrap) => Date.now() - unwrap.startTime >= unwrap.duration

const drawOverlayTarget = (target: OverlayTarget) => {
  const { canvas, context, scratch, scratchContext, dpr, rects, backgroundColor, particleColor } = target
  const sourceCanvas = textSim?.core.inited ? textSim.canvas : undefined

  let { unwrap } = target
  if (unwrap && !unwrap.to && isUnwrapSettled(unwrap)) {
    // обратное «заворачивание» доиграло
    unwrap = target.unwrap = undefined
  }

  const progress = unwrap ? getUnwrapProgress(unwrap) : 0
  const coords = unwrap?.coords

  context.clearRect(0, 0, canvas.width, canvas.height)

  for (const rect of rects) {
    const x = rect.left
    const y = Math.max(0, rect.top)
    const dw = rect.width
    const dh = rect.height

    context.fillStyle = rect.color || backgroundColor
    context.fillRect(x * dpr, y * dpr, dw * dpr, dh * dpr)

    if (!sourceCanvas) continue

    scratchContext.clearRect(x * dpr, y * dpr, dw * dpr, dh * dpr)
    if (!coords) {
      drawImageFromSource(
        scratchContext, sourceCanvas,
        x * dpr, y * dpr, dw * dpr, dh * dpr,
        x * dpr, y * dpr, dw * dpr, dh * dpr,
      )
    } else {
      // частицы «поддуваются» от точки клика
      const scaledProgress = progress ** 2 * 0.4
      drawImageFromSource(
        scratchContext,
        sourceCanvas,
        (x + (coords[0] - x) * scaledProgress) * dpr,
        (y + (coords[1] - y) * scaledProgress) * dpr,
        dw * (1 - scaledProgress) * dpr,
        dh * (1 - scaledProgress) * dpr,
        x * dpr,
        y * dpr,
        dw * dpr,
        dh * dpr,
      )
    }

    applyColorOnContext(scratchContext, particleColor, x * dpr, y * dpr, dw * dpr, dh * dpr)

    context.drawImage(
      scratch,
      x * dpr, y * dpr, dw * dpr, dh * dpr,
      x * dpr, y * dpr, dw * dpr, dh * dpr,
    )
  }

  if (unwrap && coords && unwrap.maxDist) {
    // растущий из точки клика круг вырезает нарисованное — так текст «проявляется»
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = 'white'
    context.shadowBlur = ((unwrap.maxDist / 3.5) * dpr * progress)
    context.shadowColor = 'white'
    context.beginPath()
    context.arc(coords[0] * dpr, coords[1] * dpr, unwrap.maxDist * progress * dpr, 0, 2 * Math.PI)
    context.fill()
    context.globalCompositeOperation = 'source-over'
    context.restore()
  }

  target.needsRedraw = false

  if (!target.painted && sourceCanvas && rects.length) {
    target.painted = true
    ctx.postMessage({ type: 'overlay-painted', id: target.id })
  }
}

const isOverlayTargetActive = (target: OverlayTarget) =>
  target.playing ||
  target.needsRedraw ||
  !!(target.unwrap && (!target.unwrap.to || !isUnwrapSettled(target.unwrap)))

const anyOverlayActive = () => {
  for (const target of overlayTargets.values()) if (isOverlayTargetActive(target)) return true
  return false
}

const needsFrame = () => bluffPlaying || anyOverlayActive()

const frame = () => {
  const sim = textSim
  if (sim && needsFrame()) {
    sim.core.draw()

    const now = Date.now()
    if (bluffPlaying && !sim.encoding && now - sim.lastEncodeTime >= ENCODE_INTERVAL) {
      sim.lastEncodeTime = now
      encodeBluffMask(sim)
    }
  }

  for (const target of overlayTargets.values()) {
    if (isOverlayTargetActive(target)) drawOverlayTarget(target)
  }

  // setTimeout, а не requestAnimationFrame: из канваса симуляции ничего не
  // презентится, темп нужен только шагам симуляции (и rAF в воркере без
  // трансфернутого канваса всё равно не тикает)
  timerId = needsFrame() ? ctx.setTimeout(frame, FRAME_INTERVAL) : undefined
}

const ensureLoop = () => {
  if (timerId !== undefined || !needsFrame()) return

  if (textSim) textSim.core.lastDrawTime = Date.now() // чтобы первый dt не был гигантским
  frame()
}

/** Симуляция создаётся один раз на воркер; повторные `text-init` — no-op. */
const initTextSim = (message: SpoilerRendererSimInit) => {
  if (textSim) return
  if (textSimFailed) {
    ctx.postMessage({ type: 'text-init-failed' })
    return
  }

  try {
    const canvas = new OffscreenCanvas(message.width * message.dpr, message.height * message.dpr)
    const core = new DotRendererCore(
      canvas,
      buildDotRendererConfig(
        message.width,
        message.height,
        message.dpr,
        getTextSpoilerConfig(message.width, message.height, message.dpr),
      ),
    )
    if (!core.init()) throw new Error('init failed')
    textSim = { core, canvas, encoding: false, lastEncodeTime: 0 }
  } catch {
    textSimFailed = true
    ctx.postMessage({ type: 'text-init-failed' })
    return
  }

  ensureLoop()
}

// Разрушать симуляцию отдельным сообщением не нужно: последний потребитель
// отпускает мост, тот делает terminate() — поток умирает вместе с GL-контекстом.
ctx.onmessage = (event) => {
  const message = event.data
  switch (message.type) {
    case 'text-init': {
      initTextSim(message)
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

    case 'overlay-attach': {
      const context = message.canvas.getContext('2d')
      if (!context) break

      const scratch = new OffscreenCanvas(message.canvas.width, message.canvas.height)
      const scratchContext = scratch.getContext('2d')
      if (!scratchContext) break

      overlayTargets.set(message.id, {
        id: message.id,
        canvas: message.canvas,
        context,
        scratch,
        scratchContext,
        dpr: message.dpr,
        rects: [],
        backgroundColor: 'transparent',
        particleColor: 'white',
        playing: false,
        needsRedraw: false,
        painted: false,
      })
      break
    }

    case 'overlay-update': {
      const target = overlayTargets.get(message.id)
      if (!target) break
      if (target.canvas.width !== message.width || target.canvas.height !== message.height) {
        target.canvas.width = target.scratch.width = message.width
        target.canvas.height = target.scratch.height = message.height
      }
      target.rects = message.rects
      target.backgroundColor = message.backgroundColor
      target.particleColor = message.particleColor
      target.needsRedraw = true
      ensureLoop()
      break
    }

    case 'overlay-unwrap': {
      const target = overlayTargets.get(message.id)
      if (!target) break
      target.unwrap = {
        coords: message.coords,
        maxDist: message.maxDist,
        from: 0,
        to: 1,
        duration: message.duration,
        startTime: Date.now(),
        easing: unwrapEasing,
      }
      ensureLoop()
      break
    }

    case 'overlay-wrap': {
      const target = overlayTargets.get(message.id)
      if (!target?.unwrap) break
      target.unwrap = {
        ...target.unwrap,
        from: getUnwrapProgress(target.unwrap),
        to: 0,
        duration: message.duration,
        startTime: Date.now(),
        easing: defaultEasing,
      }
      ensureLoop()
      break
    }

    case 'overlay-reset': {
      const target = overlayTargets.get(message.id)
      if (!target) break
      target.unwrap = undefined
      target.needsRedraw = true
      ensureLoop()
      break
    }

    case 'overlay-clear': {
      const target = overlayTargets.get(message.id)
      if (!target) break
      target.rects = []
      target.context.clearRect(0, 0, target.canvas.width, target.canvas.height)
      break
    }

    case 'overlay-play': {
      const target = overlayTargets.get(message.id)
      if (!target) break
      target.playing = true
      ensureLoop()
      break
    }

    case 'overlay-pause': {
      const target = overlayTargets.get(message.id)
      if (target) target.playing = false
      break
    }

    case 'overlay-detach': {
      overlayTargets.delete(message.id)
      break
    }
  }
}
