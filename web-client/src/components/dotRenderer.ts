// * thanks https://github.com/dkaraush/particles for webgl version
//
// DotRenderer — порт tweb `components/dotRenderer.ts`. Один класс на ОБА
// сценария спойлера: медийный (плитка 480×480, из неё каждый спойлер вырезает
// свой кусок) и текстовый (тайл 240×120 — блеф-маска почты и оверлей спойлеров
// в баблах). Симуляция ОДНА на сценарий, канвасы-цели лишь сэмплят её со своим
// случайным сдвигом и поворотом/отражением — так десяток спойлеров на экране
// стоит одной симуляции.
//
// Два пути, ровно как в оригинале:
//   • воркерный (`createWithWorker`) — канвас цели уезжает в воркер через
//     transferControlToOffscreen, главный поток только шлёт play/pause/reveal;
//   • legacy (`create`) — WebGL2 в OffscreenCanvas недоступен, симуляция крутится
//     здесь, а каждая цель копирует из неё свой кусок в 2d-контекст.
//
// Шейдеры, как в оригинале, лежат отдельным ассетом и фетчатся по URL: страница
// знает адреса (`?url` — их выдаёт сборщик) и передаёт их и воркеру, и
// главнопоточному ядру. Поэтому GLSL не вкомпилен ни в главный чанк, ни в
// воркерный, хотя `dotRendererCore` нужен обоим (legacy-путь крутит симуляцию
// прямо здесь).
import { MOUNT_CLASS_TO } from '@config/debug'
import { animate } from '@helpers/animation'
import callbackify from '@helpers/callbackify'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import applyColorOnContext from '@helpers/canvas/applyColorOnContext'
import { animateValue, simpleEasing } from '@helpers/animateValue'
import type { Middleware } from '@helpers/middleware'
import getUnsafeRandomInt from '@helpers/number/getUnsafeRandomInt'
import DotRendererCore, {
  buildDotRendererConfig,
  drawClippingCircle,
  getDefaultParticlesCount,
  type DotRendererConfig,
  type DotRendererShaderURLs,
} from '@lib/spoiler/dotRendererCore'
import {
  retainSpoilerRenderer,
  type SpoilerRendererConnection,
} from '@lib/spoiler/spoilerRendererConnection'
import BluffSpoilerController from '@lib/spoiler/bluffSpoilerController'
import {
  spoilerSimDpr,
  TEXT_SPOILER_HEIGHT,
  TEXT_SPOILER_WIDTH,
} from '@lib/spoiler/spoilerSupport'
import type { SpoilerOverlayUpdate } from '@lib/spoiler/spoilerRenderer.worker'
import animationIntersector, {
  type AnimationItemGroup,
  type AnimationItemWrapper,
} from '@components/animationIntersector'
// `no-inline` обязателен: без него сборщик зашивает шейдер base64-строкой в этот
// же чанк, и весь смысл (GLSL отдельным кэшируемым ассетом, а не в JS обоих
// потоков) теряется.
import spoilerFragmentShaderURL from '@lib/spoiler/spoiler_fragment.glsl?url&no-inline'
import spoilerVertexShaderURL from '@lib/spoiler/spoiler_vertex.glsl?url&no-inline'

// tweb: `{vertex: 'assets/img/spoiler_vertex.glsl', fragment: …}` — у нас адреса
// ассетов выдаёт сборщик, форма та же.
const SHADER_URLS: DotRendererShaderURLs = {
  vertex: spoilerVertexShaderURL,
  fragment: spoilerFragmentShaderURL,
}

export const IMAGE_SPOILER_SIZE = 480

// tweb getTextSpoilerConfig — текстовый спойлер мельче и шустрее медийного.
// Дублёр этой же функции живёт в воркере (там конфиг и строится); здесь она
// нужна legacy-пути, который крутит симуляцию в главном потоке.
const getTextSpoilerConfig = (dpr: number): Partial<DotRendererConfig> => ({
  particlesCount: 4 * getDefaultParticlesCount(TEXT_SPOILER_WIDTH, TEXT_SPOILER_HEIGHT),
  noiseSpeed: 5,
  maxVelocity: 10,
  timeScale: 1.2,
  radius: 1.8 * dpr,
  forceMult: 0.2,
  velocityMult: 0.4,
  dampingMult: 2.2,
  longevity: 5.0,
})

/**
 * Обёртка «одна цель — один item анимации» для `animationIntersector`: сама
 * ничего не рисует, только переводит play/pause/remove в колбэки владельца.
 */
export class AnimationItemNested implements AnimationItemWrapper {
  public autoplay = true
  public loop = true
  public paused = true

  constructor(
    private options: {
      onPlay: () => void
      onPause: () => void
      onDestroy?: () => void
    },
  ) {}

  public remove() {
    this.pause()
    this.options.onDestroy?.()
  }

  public play() {
    if (!this.paused) {
      return
    }

    this.paused = false
    this.options.onPlay()
  }

  public pause() {
    if (this.paused) {
      return
    }

    this.paused = true
    this.options.onPause()
  }
}

export interface ImageSpoilerControls {
  canvas: HTMLCanvasElement
  /** legacy-путь отдаёт результат `DotRendererCore.init()`, воркерный — свой deferred */
  readyResult: boolean | Promise<boolean> | CancellablePromise<void> | undefined
  revealWithAnimation: (event: Event, underLyingCanvas: HTMLCanvasElement) => CancellablePromise<void> | false
}

export default class DotRenderer implements AnimationItemWrapper {
  private static createdIndex = -1

  private static imageSpoilerInstance: DotRenderer | undefined
  private static textSpoilerInstance: DotRenderer | undefined

  private static createdImageSpoilers = new WeakMap<HTMLCanvasElement, ImageSpoilerControls>()

  private drawCallbacks: Map<HTMLElement, () => void> = new Map()
  private targetCanvasesCount = 0

  public canvas: HTMLCanvasElement
  private core: DotRendererCore | undefined

  public paused: boolean
  public autoplay: boolean
  public tempId: number

  public dpr: number

  public loop: boolean = true
  private initPromise: boolean | Promise<boolean> | undefined

  constructor() {
    const canvas = (this.canvas = document.createElement('canvas'))
    this.dpr = window.devicePixelRatio
    canvas.classList.add('canvas-thumbnail', 'canvas-dots')

    this.paused = true
    this.autoplay = true
    this.tempId = 0
    try {
      this.core = new DotRendererCore(canvas, SHADER_URLS)
    } catch {
      // отступление от tweb: там контекст просто оказался бы null и всё упало бы
      // позже. WebGL2 нет и в главном потоке — рисовать нечем, цели останутся под
      // нижним уровнем деградации (stripped-превью у медиа, CSS-заливка у текста).
    }
  }

  private resize(width: number, height: number, config: Partial<DotRendererConfig> = {}) {
    this.core?.resize(width, height, this.dpr, buildDotRendererConfig(width, height, this.dpr, config))
  }

  private draw() {
    if (!this.core?.inited) {
      return
    }

    this.core.draw()
    this.drawCallbacks.forEach((draw) => draw())
  }

  public remove() {
    this.pause()
    this.destroy()
  }

  public pause() {
    if (this.paused) {
      return
    }

    this.paused = true
    ++this.tempId
  }

  public play() {
    if (!this.paused) {
      return
    }

    this.paused = false
    const tempId = ++this.tempId
    if (this.core) this.core.lastDrawTime = Date.now()

    animate(() => {
      if (this.tempId !== tempId || this.paused) {
        return false
      }

      this.draw()
      return true
    })
  }

  private init() {
    return (this.initPromise ??= callbackify(this.core?.init() ?? false, (ok) => {
      if (ok) this.draw()
      return ok
    }))
  }

  private destroy() {
    this.core?.destroy()
  }

  /**
   * Точка входа медийного спойлера. Отдаёт канвас точек, признак готовности
   * (его ждёт `wrapMediaSpoiler`, чтобы не показать пустой прямоугольник) и
   * функцию раскрытия по клику.
   */
  public static create(options: {
    width?: number
    height?: number
    middleware: Middleware
    animationGroup: AnimationItemGroup
    config?: Partial<DotRendererConfig>
  }): ImageSpoilerControls {
    if (BluffSpoilerController.isWorkerSimSupported()) {
      return this.createWithWorker(options)
    }

    const { width, height, middleware, animationGroup, config } = options
    let instance = this.imageSpoilerInstance
    if (!instance) {
      instance = this.imageSpoilerInstance = new DotRenderer()
      instance.resize(IMAGE_SPOILER_SIZE, IMAGE_SPOILER_SIZE)
      MOUNT_CLASS_TO.dotRenderer = instance
    }

    const dpr = window.devicePixelRatio
    const { canvas, rotate, flipX, flipY } = this.createTargetCanvas(width, height, dpr)
    const context = canvas.getContext('2d')!

    let revealAnimation:
      | {
          underlyingCanvasClickCoords: { x: number; y: number }
          transformedCoords: { x: number; y: number }
          progress: number
          maxDist: number
          maxDistUnderlyingCanvas: number
          underLyingCtx: CanvasRenderingContext2D
        }
      | undefined

    const x = getUnsafeRandomInt(0, instance.canvas.width - canvas.width)
    const y = getUnsafeRandomInt(0, instance.canvas.height - canvas.height)

    const draw = () => {
      const { width, height } = canvas
      const isRevealed = (revealAnimation?.progress ?? 0) >= 1

      if (isRevealed) return

      context.clearRect(0, 0, width, height)

      if (!revealAnimation) {
        context.drawImage(instance.canvas, x, y, width, height, 0, 0, width, height)
      } else {
        const {
          progress,
          transformedCoords,
          underLyingCtx,
          maxDist,
          maxDistUnderlyingCanvas,
          underlyingCanvasClickCoords,
        } = revealAnimation

        // Zoom (push) the particles
        const scaledProgress = progress ** 2 * 0.5
        context.drawImage(
          instance.canvas,
          x + transformedCoords.x * scaledProgress,
          y + transformedCoords.y * scaledProgress,
          width * (1 - scaledProgress),
          height * (1 - scaledProgress),
          0,
          0,
          width,
          height,
        )

        // Draw a clipping circle growing from where the user clicked
        drawClippingCircle(context, progress, transformedCoords, maxDist, instance.dpr)
        drawClippingCircle(
          underLyingCtx,
          progress,
          underlyingCanvasClickCoords,
          maxDistUnderlyingCanvas,
          instance.dpr,
        )
      }

      if (config?.color) {
        applyColorOnContext(context, '#' + config.color.toString(16), 0, 0, width, height)
      }
    }

    ++instance.targetCanvasesCount
    const animation = new AnimationItemNested({
      onPlay: () => {
        instance.drawCallbacks.set(canvas, draw)
        instance.play()
      },
      onPause: () => {
        instance.drawCallbacks.delete(canvas)
        if (!instance.drawCallbacks.size) {
          instance.pause()
        }
      },
      onDestroy: () => {
        if (!--instance.targetCanvasesCount) {
          instance.remove()
          this.imageSpoilerInstance = undefined
        }
      },
    })

    animationIntersector.addAnimation({
      animation,
      group: animationGroup,
      observeElement: canvas,
      controlled: middleware,
      type: 'dots',
    })

    const revealWithAnimation = (event: Event, underLyingCanvas: HTMLCanvasElement) => {
      const geometry = this.measureReveal(event, canvas, rotate, flipX, flipY, instance.dpr)
      if (!geometry) return false
      const { rectX, rectY, bcr, transX, transY, maxDist, duration } = geometry

      revealAnimation = {
        underlyingCanvasClickCoords: {
          x: (rectX * underLyingCanvas.width) / bcr.width,
          y: (rectY * underLyingCanvas.height) / bcr.height,
        },
        transformedCoords: {
          x: transX * instance.dpr,
          y: transY * instance.dpr,
        },
        maxDist,
        maxDistUnderlyingCanvas: (maxDist / canvas.width) * underLyingCanvas.width,
        underLyingCtx: underLyingCanvas.getContext('2d')!,
        progress: 0,
      }

      const deferred = deferredPromise<void>()

      animateValue(
        0,
        1,
        duration,
        (v) => {
          revealAnimation!.progress = v
          draw()
        },
        {
          onEnd: () => { deferred.resolve!() },
          easing: simpleEasing,
        },
      )

      return deferred
    }

    const result: ImageSpoilerControls = {
      canvas,
      readyResult: width ? instance.init() : undefined,
      revealWithAnimation,
    }

    this.createdImageSpoilers.set(canvas, result)

    return result
  }

  private static connection: SpoilerRendererConnection | undefined
  private static connectionUsers = 0 // media targets + overlay targets
  private static mediaInited = false
  private static textInited = false
  private static mediaWorkerReady: CancellablePromise<void> | undefined
  private static textWorkerReady: CancellablePromise<void> | undefined

  private static retainConnection() {
    ++this.connectionUsers
    return (this.connection ??= retainSpoilerRenderer((message) => {
      if (message.type === 'media-inited') {
        this.mediaWorkerReady?.resolve!()
      } else if (message.type === 'media-init-failed') {
        // симуляции не будет — не держим `wrapMediaSpoiler` в ожидании:
        // stripped-превью и так закрывает медиа
        this.mediaWorkerReady?.resolve!()
      } else if (message.type === 'overlay-painted') {
        this.textWorkerReady?.resolve!()
      } else if (message.type === 'text-init-failed' || message.type === 'connection-error') {
        this.textWorkerReady?.resolve!()
        this.mediaWorkerReady?.resolve!()
      }
    }))
  }

  private static releaseConnection() {
    if (--this.connectionUsers || !this.connection) return

    this.connection.release()
    this.connection = undefined
    this.mediaInited = this.textInited = false
    this.mediaWorkerReady = this.textWorkerReady = undefined
  }

  private static getShaderURLs() {
    return {
      vertexURL: new URL(SHADER_URLS.vertex, window.location.href).href,
      fragmentURL: new URL(SHADER_URLS.fragment, window.location.href).href,
    }
  }

  private static initMediaSim() {
    if (this.mediaInited) return
    this.mediaInited = true

    this.mediaWorkerReady = deferredPromise<void>()
    const dpr = window.devicePixelRatio
    this.connection?.postMessage({
      type: 'media-init',
      width: IMAGE_SPOILER_SIZE,
      height: IMAGE_SPOILER_SIZE,
      dpr,
      config: buildDotRendererConfig(IMAGE_SPOILER_SIZE, IMAGE_SPOILER_SIZE, dpr),
      ...this.getShaderURLs(),
    })
  }

  private static initTextSim() {
    if (this.textInited) return
    this.textInited = true

    this.textWorkerReady = deferredPromise<void>()
    const dpr = spoilerSimDpr()
    this.connection?.postMessage({
      type: 'text-init',
      width: TEXT_SPOILER_WIDTH,
      height: TEXT_SPOILER_HEIGHT,
      dpr,
      config: buildDotRendererConfig(
        TEXT_SPOILER_WIDTH,
        TEXT_SPOILER_HEIGHT,
        dpr,
        getTextSpoilerConfig(dpr),
      ),
      ...this.getShaderURLs(),
    })
  }

  /**
   * Shared between the worker and the legacy paths: the target canvas with the
   * per-instance rotation/flip disguising that all the spoilers sample the same
   * simulation
   */
  private static createTargetCanvas(width: number | undefined, height: number | undefined, dpr: number) {
    const index = ++this.createdIndex

    const canvas = document.createElement('canvas')
    canvas.classList.add('canvas-thumbnail', 'canvas-dots')
    if (width) {
      canvas.width = width * dpr
      canvas.height = (height ?? width) * dpr
    }

    const rotate = index % 4 === 1
    const flipX = index % 4 === 2
    const flipY = index % 4 === 3

    const transforms: string[] = [
      rotate && 'rotate(180deg)',
      flipX && 'scaleX(-1)',
      flipY && 'scaleY(-1)',
    ].filter(Boolean) as string[]
    if (transforms.length) {
      canvas.style.transform = transforms.join(' ')
    }

    return { canvas, rotate, flipX, flipY }
  }

  /**
   * Геометрия раскрытия — общая для обоих путей (в tweb она продублирована в
   * `create` и `createWithWorker` слово в слово). Возвращает `false`, если
   * событие без координат: раскрывать «из точки» неоткуда.
   */
  private static measureReveal(
    event: Event,
    canvas: HTMLCanvasElement,
    rotate: boolean,
    flipX: boolean,
    flipY: boolean,
    dpr: number,
  ) {
    if (!('clientX' in event && 'clientY' in event)) return false
    const bcr = canvas.getBoundingClientRect()

    const rectX = (event.clientX as number) - bcr.left
    const rectY = (event.clientY as number) - bcr.top
    let transX = rectX
    let transY = rectY

    if (Number(rotate) + Number(flipX) === 1) {
      transX = bcr.width - rectX
    }
    if (Number(rotate) + Number(flipY) === 1) {
      transY = bcr.height - rectY
    }

    const distToMargin = Math.max(
      Math.hypot(rectX, rectY),
      Math.hypot(bcr.width - rectX, rectY),
      Math.hypot(rectX, bcr.height - rectY),
      Math.hypot(bcr.width - rectX, bcr.height - rectY),
    )
    const maxDist = distToMargin * dpr + 50
    const duration = 800 + (400 /* px/ms */ - distToMargin)

    return { bcr, rectX, rectY, transX, transY, maxDist, duration }
  }

  /**
   * Same as the legacy path above, but the simulation, the per-target drawing and
   * the reveal effect all run inside a worker on transferred OffscreenCanvases —
   * the main thread only forwards play/pause/reveal events. Only the clipping hole
   * on the underlying thumbnail stays here, that canvas is owned by the media code.
   */
  private static createWithWorker({
    width,
    height,
    middleware,
    animationGroup,
    config,
  }: Parameters<(typeof DotRenderer)['create']>[0]): ImageSpoilerControls {
    const connection = this.retainConnection()
    this.initMediaSim()
    const dpr = window.devicePixelRatio
    const { canvas, rotate, flipX, flipY } = this.createTargetCanvas(width, height, dpr)
    const id = this.createdIndex

    const simSize = IMAGE_SPOILER_SIZE * dpr
    const x = getUnsafeRandomInt(0, simSize - canvas.width)
    const y = getUnsafeRandomInt(0, simSize - canvas.height)

    const offscreen = canvas.transferControlToOffscreen()
    connection.postMessage(
      {
        type: 'media-attach',
        id,
        canvas: offscreen,
        x,
        y,
        color: config?.color ? '#' + config.color.toString(16) : undefined,
      },
      [offscreen],
    )

    const animation = new AnimationItemNested({
      onPlay: () => this.connection?.postMessage({ type: 'media-play', id }),
      onPause: () => this.connection?.postMessage({ type: 'media-pause', id }),
      onDestroy: () => {
        this.connection?.postMessage({ type: 'media-detach', id })
        this.releaseConnection()
      },
    })

    animationIntersector.addAnimation({
      animation,
      group: animationGroup,
      observeElement: canvas,
      controlled: middleware,
      type: 'dots',
    })

    const revealWithAnimation = (event: Event, underLyingCanvas: HTMLCanvasElement) => {
      const geometry = this.measureReveal(event, canvas, rotate, flipX, flipY, dpr)
      if (!geometry) return false
      const { rectX, rectY, bcr, transX, transY, maxDist, duration } = geometry

      this.connection?.postMessage({
        type: 'media-reveal',
        id,
        coords: { x: transX * dpr, y: transY * dpr },
        maxDist,
        duration,
      })

      const underLyingCtx = underLyingCanvas.getContext('2d')!
      const underlyingCanvasClickCoords = {
        x: (rectX * underLyingCanvas.width) / bcr.width,
        y: (rectY * underLyingCanvas.height) / bcr.height,
      }
      const maxDistUnderlyingCanvas = (maxDist / canvas.width) * underLyingCanvas.width

      const deferred = deferredPromise<void>()

      animateValue(
        0,
        1,
        duration,
        (v) => {
          drawClippingCircle(underLyingCtx, v, underlyingCanvasClickCoords, maxDistUnderlyingCanvas, dpr)
        },
        {
          onEnd: () => { deferred.resolve!() },
          easing: simpleEasing,
        },
      )

      return deferred
    }

    const result: ImageSpoilerControls = {
      canvas,
      readyResult: width ? this.mediaWorkerReady : undefined,
      revealWithAnimation,
    }

    this.createdImageSpoilers.set(canvas, result)

    return result
  }

  public static getImageSpoilerByElement(element: HTMLElement) {
    return this.createdImageSpoilers.get(element as HTMLCanvasElement)
  }

  private static getTextSpoilerInstance() {
    if (this.textSpoilerInstance) return this.textSpoilerInstance

    const instance = (this.textSpoilerInstance = new DotRenderer())

    /**
     * Bigger DPR will make a visible separation between drawn chunks (when text spoilers are huge)
     * Do not make this bigger, unless there is a way to mirror the dot on the other side when it is close to some margin
     */
    instance.dpr = spoilerSimDpr()
    instance.resize(TEXT_SPOILER_WIDTH, TEXT_SPOILER_HEIGHT, getTextSpoilerConfig(instance.dpr))

    MOUNT_CLASS_TO.textSpoilerRenderer = instance

    return instance
  }

  /**
   * Legacy-путь текстового спойлера: цель рисует себя сама (`draw`), сэмплируя
   * канвас главнопоточной симуляции (`sourceCanvas`).
   */
  public static attachTextSpoilerTarget({
    middleware,
    animationGroup,
    canvas,
    draw,
  }: {
    canvas: HTMLCanvasElement
    draw: () => void
    middleware: Middleware
    animationGroup: AnimationItemGroup
  }) {
    const instance = this.getTextSpoilerInstance()

    ++instance.targetCanvasesCount

    const animation = new AnimationItemNested({
      onPlay: () => {
        instance.drawCallbacks.set(canvas, draw)
        instance.play()
      },
      onPause: () => {
        instance.drawCallbacks.delete(canvas)
        if (!instance.drawCallbacks.size) {
          instance.pause()
        }
      },
      onDestroy: () => {
        if (!--instance.targetCanvasesCount) {
          instance.remove()
          this.textSpoilerInstance = undefined
        }
      },
    })

    animationIntersector.addAnimation({
      animation,
      group: animationGroup,
      observeElement: canvas,
      controlled: middleware,
      type: 'dots',
    })

    return {
      animation,
      sourceCanvas: instance.canvas,
      dpr: instance.dpr,
      readyResult: instance.init(),
    }
  }

  /**
   * The worker counterpart of attachTextSpoilerTarget: the overlay canvas is
   * transferred to the worker, which draws and animates it from pushed geometry —
   * the DOM measurements stay on the main thread (see MessageSpoilerOverlay)
   */
  public static attachTextSpoilerOverlay({
    canvas,
    middleware,
    animationGroup,
    onPainted,
    onUnavailable,
  }: {
    canvas: HTMLCanvasElement
    middleware: Middleware
    animationGroup: AnimationItemGroup
    onPainted: () => void
    onUnavailable: () => void
  }) {
    let offscreen: OffscreenCanvas
    try {
      offscreen = canvas.transferControlToOffscreen()
    } catch {
      return null
    }

    const connection = this.retainConnection()
    this.initTextSim()

    const id = ++this.createdIndex
    const dpr = spoilerSimDpr()

    // отступление от tweb: помимо play/pause/reveal странице нужны два ответа
    // воркера — «первый кадр нарисован» и «симуляции не будет». Первый пускает
    // настоящий текст под оверлей, второй возвращает бабл на CSS-фолбэк. В tweb
    // фолбэка нет вовсе, поэтому нет и второго сигнала.
    const listener = retainSpoilerRenderer((message) => {
      if (message.type === 'overlay-painted') {
        if (message.id === id) onPainted()
      } else if (message.type === 'text-init-failed' || message.type === 'connection-error') {
        onUnavailable()
      }
    })

    connection.postMessage({ type: 'overlay-attach', id, canvas: offscreen, dpr }, [offscreen])

    let released = false
    const animation = new AnimationItemNested({
      onPlay: () => this.connection?.postMessage({ type: 'overlay-play', id }),
      onPause: () => this.connection?.postMessage({ type: 'overlay-pause', id }),
      onDestroy: () => {
        if (released) return
        released = true
        this.connection?.postMessage({ type: 'overlay-detach', id })
        listener.release()
        this.releaseConnection()
      },
    })

    animationIntersector.addAnimation({
      animation,
      group: animationGroup,
      observeElement: canvas,
      controlled: middleware,
      type: 'dots',
    })

    return {
      animation,
      dpr,
      readyResult: this.textWorkerReady,
      overlay: {
        update: (payload: Omit<SpoilerOverlayUpdate, 'type' | 'id'>) =>
          this.connection?.postMessage({ type: 'overlay-update', id, ...payload }),
        unwrap: (coords: [number, number], maxDist: number, duration: number) =>
          this.connection?.postMessage({ type: 'overlay-unwrap', id, coords, maxDist, duration }),
        wrap: (duration: number) => this.connection?.postMessage({ type: 'overlay-wrap', id, duration }),
        reset: () => this.connection?.postMessage({ type: 'overlay-reset', id }),
        clear: () => this.connection?.postMessage({ type: 'overlay-clear', id }),
      },
    }
  }

  /**
   * Блеф-спойлер: маскированный текст (у нас — адрес почты на экране
   * восстановления доступа), у которого маскируется не канвас, а САМ элемент —
   * кадр симуляции уезжает ему в `mask-image`. Поэтому здесь нет канваса-цели:
   * элемент только «числится» анимацией, а всё рисование — в
   * `BluffSpoilerController`.
   */
  public static attachBluffTextSpoilerTarget(element: HTMLElement) {
    BluffSpoilerController.observeReconnection(element, (el) => this.attachBluffTextSpoilerTarget(el))

    ++BluffSpoilerController.instancesCount

    // Весь рендер (симуляция + кодирование) идёт в воркере, главный поток только
    // получает готовые URL масок
    if (BluffSpoilerController.isWorkerSimSupported()) {
      const dpr = spoilerSimDpr()
      BluffSpoilerController.setupWorkerSim({
        width: TEXT_SPOILER_WIDTH,
        height: TEXT_SPOILER_HEIGHT,
        dpr,
        config: buildDotRendererConfig(
          TEXT_SPOILER_WIDTH,
          TEXT_SPOILER_HEIGHT,
          dpr,
          getTextSpoilerConfig(dpr),
        ),
        ...this.getShaderURLs(),
      })

      const animation = new AnimationItemNested({
        onPlay: () => BluffSpoilerController.activate(element),
        onPause: () => BluffSpoilerController.deactivate(element),
        onDestroy: () => {
          if (!--BluffSpoilerController.instancesCount) {
            BluffSpoilerController.destroy()
          }
        },
      })

      animationIntersector.addAnimation({
        animation,
        group: 'BLUFF-SPOILER',
        // controlled: true, // should not be controlled! elements might reappear in the DOM after being removed
        observeElement: element,
        type: 'dots',
      })

      return
    }

    const instance = this.getTextSpoilerInstance()

    ++instance.targetCanvasesCount

    const animation = new AnimationItemNested({
      onPlay: () => {
        instance.drawCallbacks.set(element, () => BluffSpoilerController.draw(element, instance.canvas))
        instance.play()
      },
      onPause: () => {
        instance.drawCallbacks.delete(element)
        if (!instance.drawCallbacks.size) {
          instance.pause()
        }
      },
      onDestroy: () => {
        if (!--instance.targetCanvasesCount) {
          instance.remove()
          this.textSpoilerInstance = undefined
        }
        if (!--BluffSpoilerController.instancesCount) {
          BluffSpoilerController.destroy()
        }
      },
    })

    animationIntersector.addAnimation({
      animation,
      group: 'BLUFF-SPOILER',
      // controlled: true, // should not be controlled! elements might reappear in the DOM after being removed
      observeElement: element,
      type: 'dots',
    })

    void instance.init()
  }
}

MOUNT_CLASS_TO['DotRenderer'] = DotRenderer
