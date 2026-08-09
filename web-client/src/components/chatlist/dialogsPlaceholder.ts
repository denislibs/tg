// Скелетон списка диалогов одним <canvas> поверх чатлиста — порт
// TWEB/src/helpers/dialogsPlaceholder.ts (+ TWEB/src/helpers/canvas/shimmer.ts,
// canvas/drawCircle.ts, canvas/roundRect.ts).
//
// Как это работает: канвас залит --surface-color и целиком перекрывает список,
// «дырки» строк (аватар + две линии + статус) вырезаны через destination-out, в
// дырки светит бегущий градиент-блик. Когда диалоги пришли, канвас не снимают —
// его СТИРАЮТ построчной волной сверху вниз (тоже destination-out), из-под
// которой проступают уже отрисованные DOM-строки.
//
// Отличия от tweb — только в источниках окружения (см. src/... ниже):
// liteMode → класс animation-level-0 на body; rootScope 'theme_changed' →
// MutationObserver на <html>; mediaSizes 'resize' → window resize;
// customProperties → getComputedStyle(<html>) при каждом перезапуске отрисовки.
import { easeInOutSine } from '../../shared/lib/easeInOutSine'

// Геометрия строки — tweb dialogsPlaceholder.ts:66-76.
const AVATAR_SIZE = 54
const AVATAR_MARGIN_RIGHT = 10
const MARGIN_VERTICAL = 9
const MARGIN_LEFT = 17
const TOTAL_HEIGHT = AVATAR_SIZE + MARGIN_VERTICAL * 2 // 72
const LINE_HEIGHT = 10
const LINE_BORDER_RADIUS = 6
const LINE_MARGIN_VERTICAL = 8
const STATUS_WIDTH = 24
const STATUS_MARGIN_RIGHT = 24 // tweb :345 — литерал в отрисовке статуса

// Волна стирания — tweb dialogsPlaceholder.ts:169-170.
const DETACH_DURATION = 150
const DETACH_DELAY = 15

// Шиммер — tweb shimmer.ts:13-16 (+ :83 — старт прохода после паузы).
const SHIMMER_PAUSE_INTERVAL = 850
const SHIMMER_INC = 0.032
const SHIMMER_LIGHT_SPREAD = 0.55
const SHIMMER_LIGHT_RESTART = -0.6

const animationsEnabled = () => !document.body.classList.contains('animation-level-0')

const customProperty = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

// Порт canvas/drawCircle.ts (drawCircleFromStart) — x/y задают левый верхний угол
// описанного квадрата, координаты в CSS-пикселях, канвас — в физических.
function fillCircleFromStart(ctx: CanvasRenderingContext2D, dpr: number, x: number, y: number, radius: number) {
  ctx.beginPath()
  ctx.arc((x + radius) * dpr, (y + radius) * dpr, radius * dpr, 0, 2 * Math.PI, false)
  ctx.closePath()
  ctx.fill()
}

// Порт canvas/roundRect.ts для одинакового радиуса у всех углов.
function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  x *= dpr
  y *= dpr
  width *= dpr
  height *= dpr
  radius *= dpr

  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
  ctx.fill()
}

/**
 * Alpha стирания строки `row` через `elapsed` мс после начала волны (0 — строка ещё
 * не тронута, 1 — стёрта целиком). Порт tweb dialogsPlaceholder.ts:173-181: каждая
 * строка ждёт свой каскад DELAY*row, а строки за пределами пришедших (`row >=
 * availableLength`) стартуют вместе с последней пришедшей — под ними пусто, тянуть
 * каскад дальше незачем.
 */
export function detachRowProgress({ elapsed, row, availableLength, length }: {
  elapsed: number
  row: number
  availableLength: number
  length: number
}): number {
  const delay = availableLength < length && row >= availableLength
    ? DETACH_DELAY * (availableLength - 1)
    : DETACH_DELAY * row
  const elapsedRowTime = elapsed - delay
  if (elapsedRowTime <= 0) return 0
  return easeInOutSine(elapsedRowTime, 0, 1, DETACH_DURATION)
}

interface ShimmerColors {
  background: string
  surface: string
}

// Порт shimmer.ts. Из четырёх «анимаций» tweb в массиве лежит четыре раза 'slide',
// т.е. ветка glow и переключение анимаций мертвы — оставлен только slide.
class Shimmer {
  private ctx: CanvasRenderingContext2D | null = null
  private colors: ShimmerColors = { background: '', surface: '' }
  private fillStyle: CanvasPattern | null = null
  private currTime = Date.now()
  private diffTime = 0
  private paused = false
  private pausedTime = 0
  private lightSource = 0

  public settings(ctx: CanvasRenderingContext2D, fillStyle: CanvasPattern | null, colors: ShimmerColors) {
    this.ctx = ctx
    this.fillStyle = fillStyle
    this.colors = colors
  }

  private keepTime() {
    this.diffTime = Date.now() - this.currTime
    this.currTime = Date.now()
  }

  private animateSlide(ctx: CanvasRenderingContext2D): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0)
    const smartInc = SHIMMER_INC * (this.diffTime / (1000 / 60))
    if (this.paused) {
      if ((Date.now() - this.pausedTime) > SHIMMER_PAUSE_INTERVAL) {
        this.lightSource = SHIMMER_LIGHT_RESTART
        this.paused = false
        return this.animateSlide(ctx)
      }
    } else {
      this.lightSource += smartInc
      if (this.lightSource > (1 + SHIMMER_LIGHT_SPREAD)) {
        this.paused = true
        this.pausedTime = Date.now()
      }
    }

    const lightCenter = clamp(this.lightSource, 0, 1)
    const lightLeft = clamp(this.lightSource - SHIMMER_LIGHT_SPREAD, 0, 1)
    const lightRight = clamp(this.lightSource + SHIMMER_LIGHT_SPREAD, 0, 1)

    gradient.addColorStop(lightLeft, this.colors.background)
    gradient.addColorStop(lightCenter, this.colors.surface)
    gradient.addColorStop(lightRight, this.colors.background)

    return gradient
  }

  public on() {
    const { ctx } = this
    if (!ctx) return

    const { width, height } = ctx.canvas
    this.keepTime()
    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = this.animateSlide(ctx)
    ctx.fillRect(0, 0, width, height)

    if (this.fillStyle) {
      ctx.fillStyle = this.fillStyle
      ctx.fillRect(0, 0, width, height)
    }
  }
}

interface RowValues {
  firstLineWidth: number
  secondLineWidth: number
  statusWidth: number
}

export class DialogsPlaceholder {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private shimmer = new Shimmer()
  private tempId = 0
  private detachTime = 0
  private dpr = 1
  private length = 0
  private dialogHeight = 0 // физические пиксели
  private availableLength = 0
  private generatedValues: RowValues[] = []
  private colors: ShimmerColors = { background: '', surface: '' }
  private getRect: () => { width: number; height: number } = () => ({ width: 0, height: 0 })
  private blockScrollable?: HTMLElement
  private themeObserver?: MutationObserver

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.classList.add('dialogs-placeholder-canvas')
    this.ctx = this.canvas.getContext('2d')
  }

  public attach({ container, blockScrollable }: {
    container: HTMLElement
    blockScrollable?: HTMLElement
  }) {
    this.detachTime = 0
    this.getRect = () => container.getBoundingClientRect()
    if (blockScrollable) {
      this.blockScrollable = blockScrollable
      blockScrollable.style.overflowY = 'hidden'
    }

    this.updateCanvasSize()
    this.startAnimation()
    container.append(this.canvas)

    this.themeObserver = new MutationObserver(this.renderDetails)
    this.themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme', 'style'] })
    window.addEventListener('resize', this.onResize)
  }

  /** Запускает волну стирания; канвас снимет сам, когда волна дойдёт до низа. */
  public detach(availableLength: number) {
    if (this.detachTime) {
      return
    }

    this.availableLength = availableLength
    this.detachTime = Date.now()

    // `!length` — канвас не рисовался (нулевой размер контейнера), стирать нечего,
    // но снять его и вернуть скролл всё равно надо.
    if (!animationsEnabled() || !this.length) {
      this.remove()
    }
  }

  /** Снять канвас немедленно, без волны. */
  public remove() {
    this.stopAnimation()
    this.themeObserver?.disconnect()
    this.themeObserver = undefined
    window.removeEventListener('resize', this.onResize)

    if (this.canvas.parentElement) {
      this.canvas.remove()

      if (this.blockScrollable) {
        this.blockScrollable.style.overflowY = ''
        this.blockScrollable = undefined
      }
    }
  }

  private updateCanvasSize() {
    const { canvas } = this
    const rect = this.getRect()
    const dpr = this.dpr = window.devicePixelRatio
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
  }

  private renderDetachAnimationFrame() {
    const { ctx, detachTime, length, availableLength } = this

    if (!ctx || !detachTime) {
      return
    } else if (!animationsEnabled()) {
      this.remove()
      return
    }

    const { width } = this.canvas
    const elapsed = Date.now() - detachTime

    ctx.globalCompositeOperation = 'destination-out'

    let completed = true
    for (let i = 0; i < length; ++i) {
      const progress = detachRowProgress({ elapsed, row: i, availableLength, length })
      if (progress < 1) {
        completed = false
      }

      if (!progress) { // строка ещё не начала стираться
        continue
      }

      ctx.beginPath()
      ctx.rect(0, this.dialogHeight * i, width, this.dialogHeight)
      ctx.fillStyle = `rgba(0, 0, 0, ${progress})`
      ctx.fill()
    }

    ctx.globalCompositeOperation = 'source-over'

    if (completed) {
      this.remove()
    }
  }

  private renderFrame() {
    this.shimmer.on()
    this.renderDetachAnimationFrame()
  }

  private startAnimation() {
    const { ctx, canvas } = this
    const tempId = ++this.tempId
    // Пустой канвас (колонка ещё не разложена / скрыта) — createPattern на нём
    // бросает InvalidStateError, поэтому просто не начинаем рисовать.
    if (!ctx || !canvas.width || !canvas.height) {
      return
    }

    this.colors = {
      background: customProperty('--background-color'),
      surface: customProperty('--surface-color'),
    }
    this.shimmer.settings(ctx, this.createPattern(), this.colors)

    const middleware = () => this.tempId === tempId

    this.renderFrame()
    const tick = () => {
      if (!middleware()) {
        return
      }

      // Первый кадр уже нарисован синхронно, так что при выключенных анимациях
      // скелетон просто застывает (tweb помечает это место как «цикл надо было бы
      // останавливать» — сохраняем как есть).
      if (animationsEnabled()) {
        this.renderFrame()
      }

      if (middleware()) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }

  private stopAnimation() {
    ++this.tempId
  }

  private renderDetails = () => {
    this.stopAnimation()
    this.startAnimation()
  }

  private onResize = () => {
    const { width, height } = this.canvas
    const { dpr } = this
    this.updateCanvasSize()
    if (this.canvas.width === width && this.canvas.height === height && this.dpr === dpr) {
      return
    }

    this.renderDetails()
  }

  /** Заливка --surface-color с вырезанными дырками строк — ей закрашивается блик. */
  private createPattern(): CanvasPattern | null {
    const { canvas, ctx, dpr } = this

    const patternCanvas = document.createElement('canvas')
    const patternContext = patternCanvas.getContext('2d')
    patternCanvas.width = canvas.width
    patternCanvas.height = canvas.height
    if (!ctx || !patternContext) {
      return null
    }

    patternContext.fillStyle = this.colors.surface
    patternContext.fillRect(0, 0, patternCanvas.width, patternCanvas.height)

    patternContext.fillStyle = '#000'
    patternContext.globalCompositeOperation = 'destination-out'

    this.dialogHeight = TOTAL_HEIGHT * dpr
    const length = this.length = Math.ceil(canvas.height / this.dialogHeight)
    for (let i = 0; i < length; ++i) {
      this.drawChat(patternContext, i, i * TOTAL_HEIGHT)
    }

    return ctx.createPattern(patternCanvas, 'no-repeat')
  }

  /** Дырки одной строки: аватар, две линии текста и статус справа. y — в CSS-пикселях. */
  private drawChat(ctx: CanvasRenderingContext2D, i: number, y: number) {
    const generatedValues = this.generatedValues[i] ??= {
      firstLineWidth: 40 + Math.random() * 100, // 120
      secondLineWidth: 120 + Math.random() * 130, // 240
      statusWidth: STATUS_WIDTH + Math.random() * 16,
    }
    const { firstLineWidth, secondLineWidth, statusWidth } = generatedValues
    const { dpr } = this

    fillCircleFromStart(ctx, dpr, MARGIN_LEFT, y + MARGIN_VERTICAL, AVATAR_SIZE / 2)
    const marginLeft = MARGIN_LEFT + AVATAR_SIZE + AVATAR_MARGIN_RIGHT

    fillRoundRect(ctx, dpr, marginLeft, y + MARGIN_VERTICAL + LINE_MARGIN_VERTICAL, firstLineWidth, LINE_HEIGHT, LINE_BORDER_RADIUS)
    fillRoundRect(ctx, dpr, marginLeft, y + TOTAL_HEIGHT - MARGIN_VERTICAL - LINE_HEIGHT - LINE_MARGIN_VERTICAL, secondLineWidth, LINE_HEIGHT, LINE_BORDER_RADIUS)
    fillRoundRect(ctx, dpr, ctx.canvas.width / dpr - STATUS_MARGIN_RIGHT - statusWidth, y + MARGIN_VERTICAL + LINE_MARGIN_VERTICAL, statusWidth, LINE_HEIGHT, LINE_BORDER_RADIUS)
  }
}
