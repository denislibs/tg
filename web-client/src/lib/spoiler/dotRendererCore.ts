// DotRendererCore — WebGL2-симуляция частиц спойлера: порт tweb
// `components/dotRendererCore.ts` (в самом tweb это порт https://github.com/dkaraush/particles).
// Частицы живут в буфере атрибутов и переносятся между двумя буферами через
// transform feedback: вершинный шейдер и считает физику (curl-noise), и рисует точку.
//
// Класс не знает про DOM: работает и с HTMLCanvasElement, и с OffscreenCanvas —
// первая ветка нужна главному потоку (legacy-путь `DotRenderer`, когда WebGL2 в
// OffscreenCanvas недоступен), вторая — воркеру.
//
// отступление от tweb: шейдеры не фетчатся по URL (`assets/img/spoiler_*.glsl`),
// а импортируются `?raw` и вкомпиливаются в чанк. Компиляция становится
// синхронной — отпадает сетевой запрос, который мог бы не долететь (у нас нет
// папки `public/assets/img`, шейдеры жили бы отдельным ассетом). Форма API от
// этого не меняется: `init()` по-прежнему возвращает `MaybePromise<boolean>` и
// мемоизируется в `initPromise`, а вызывающий разворачивает его `callbackify` —
// ровно как в оригинале.
//
// отступление от tweb: 15 отдельных полей-`WebGLUniformLocation` свёрнуты в одну
// карту `uniforms` — тот же набор юниформ, тот же порядок заливки.
import fragmentShaderSource from './spoiler_fragment.glsl?raw'
import vertexShaderSource from './spoiler_vertex.glsl?raw'

import { IS_MOBILE } from '@environment/userAgent'

export interface DotRendererConfig {
  particlesCount: number
  radius: number
  seed: number
  noiseScale: number
  noiseSpeed: number
  forceMult: number
  velocityMult: number
  dampingMult: number
  maxVelocity: number
  longevity: number
  noiseMovement: number
  timeScale: number
  color: number
}

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v)

export function getDefaultParticlesCount(width: number, height: number) {
  return clamp(((width * height) / (500 * 500)) * 1000 * (IS_MOBILE ? 5 : 10), 500, 10000)
}

export function buildDotRendererConfig(
  width: number,
  height: number,
  dpr: number,
  config: Partial<DotRendererConfig> = {},
): DotRendererConfig {
  return {
    particlesCount: getDefaultParticlesCount(width, height),
    radius: dpr * 1.6,
    seed: Math.random() * 10,
    noiseScale: 6,
    noiseSpeed: 0.6,
    forceMult: 0.6,
    velocityMult: 1,
    dampingMult: 0.9999,
    maxVelocity: 6,
    longevity: 1.4,
    noiseMovement: 4,
    timeScale: 0.65,
    color: 0xffffff,
    ...config,
  }
}

/**
 * Растущий из точки клика круг, вырезающий уже нарисованное (tweb
 * `drawClippingCircle`). Им «проявляется» и слой точек, и подложка-превью под ним.
 */
export function drawClippingCircle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  progress: number,
  coords: { x: number; y: number },
  maxDist: number,
  dpr: number,
) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'white'
  ctx.shadowBlur = (maxDist / 3.5) * dpr * progress
  ctx.shadowColor = 'white'
  ctx.beginPath()
  ctx.arc(coords.x, coords.y, maxDist * progress, 0, 2 * Math.PI)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

// Юниформы шейдера: имя в GLSL → поле конфига. Порядок не важен, значения
// заливаются перед каждым `drawArrays`.
const UNIFORMS: Readonly<Record<string, keyof DotRendererConfig>> = {
  r: 'radius',
  seed: 'seed',
  noiseScale: 'noiseScale',
  noiseSpeed: 'noiseSpeed',
  dampingMult: 'dampingMult',
  velocityMult: 'velocityMult',
  forceMult: 'forceMult',
  longevity: 'longevity',
  maxVelocity: 'maxVelocity',
  noiseMovement: 'noiseMovement',
}

// 4 атрибута частицы (position vec2, velocity vec2, time float, duration float) —
// 6 float'ов, 24 байта на частицу.
const PARTICLE_STRIDE = 24

export default class DotRendererCore {
  public inited = false
  public lastDrawTime = 0
  public dpr = 1
  public config: DotRendererConfig

  public readonly canvas: OffscreenCanvas | HTMLCanvasElement

  private readonly context: WebGL2RenderingContext

  private reset = true
  private time = 0
  private bufferIndex = 0
  private buffer: [WebGLBuffer, WebGLBuffer] | null = null
  private bufferParticlesCount = 0
  private program: WebGLProgram | null = null
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private initPromise: boolean | undefined

  /** Бросает, если WebGL2 недоступен — вызывающий обязан поймать и деградировать. */
  constructor(canvas: OffscreenCanvas | HTMLCanvasElement, config: DotRendererConfig) {
    const context = canvas.getContext('webgl2')
    if (!context) throw new Error('webgl2 is not available')

    this.canvas = canvas
    this.context = context as WebGL2RenderingContext
    this.config = config
  }

  /**
   * tweb `resize`: меняет размер канвы и конфиг симуляции на лету. Уже
   * проинициализированная симуляция сразу перерисовывается — иначе один кадр
   * останется с прежним viewport'ом.
   */
  public resize(width: number, height: number, dpr: number, config: DotRendererConfig) {
    this.dpr = dpr
    this.canvas.width = width * dpr
    this.canvas.height = height * dpr
    this.config = config

    if (this.inited) {
      this.draw()
    }
  }

  private genBuffer() {
    const gl = this.context
    if (this.buffer) {
      gl.deleteBuffer(this.buffer[0])
      gl.deleteBuffer(this.buffer[1])
    }

    this.bufferParticlesCount = Math.ceil(this.config.particlesCount)
    const buffer: WebGLBuffer[] = []
    for (let i = 0; i < 2; ++i) {
      buffer[i] = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer[i])
      gl.bufferData(gl.ARRAY_BUFFER, this.bufferParticlesCount * PARTICLE_STRIDE, gl.DYNAMIC_DRAW)
    }
    this.buffer = [buffer[0], buffer[1]]
  }

  private compileShader(type: number, source: string) {
    const gl = this.context
    const shader = gl.createShader(type)
    if (!shader) throw new Error('createShader failed')

    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('compile shader error:\n' + gl.getShaderInfoLog(shader))
    }
    return shader
  }

  /**
   * Компилирует шейдеры и заводит буферы. `false` — драйвер не смог, деградируем.
   * Мемоизируется (tweb `initPromise`): повторный вызов не пересобирает программу.
   */
  public init() {
    if (this.initPromise !== undefined) return this.initPromise

    const gl = this.context
    try {
      const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource)
      const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource)

      const program = (this.program = gl.createProgram())
      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      // Выходы вершинного шейдера пишутся обратно в буфер — это и есть шаг симуляции.
      gl.transformFeedbackVaryings(
        program,
        ['outPosition', 'outVelocity', 'outTime', 'outDuration'],
        gl.INTERLEAVED_ATTRIBS,
      )
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('program link error:\n' + gl.getProgramInfoLog(program))
      }
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)

      for (const name of ['time', 'deltaTime', 'size', 'reset', 'color', ...Object.keys(UNIFORMS)]) {
        this.uniforms.set(name, gl.getUniformLocation(program, name))
      }

      this.genBuffer()

      gl.clearColor(0, 0, 0, 0)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      this.inited = true
      this.lastDrawTime = Date.now()
      return (this.initPromise = true)
    } catch {
      this.destroy()
      return (this.initPromise = false)
    }
  }

  private u(name: string) {
    return this.uniforms.get(name) ?? null
  }

  /** Один шаг симуляции + отрисовка кадра в канвас. */
  public draw() {
    if (!this.inited || !this.buffer || !this.program) return

    const gl = this.context
    const config = this.config
    const now = Date.now()
    const dt = Math.min((now - this.lastDrawTime) / 1_000, 1) * config.timeScale
    this.lastDrawTime = now

    this.time += dt

    // tweb: конфиг мог подрасти через resize — буфер надо перезалить и начать заново
    if (this.bufferParticlesCount < config.particlesCount) {
      this.genBuffer()
      this.reset = true
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.uniform1f(this.u('reset'), this.reset ? 1 : 0)
    if (this.reset) {
      this.time = 0
      this.reset = false
    }
    gl.uniform1f(this.u('time'), this.time)
    gl.uniform1f(this.u('deltaTime'), dt)
    gl.uniform2f(this.u('size'), this.canvas.width, this.canvas.height)
    for (const [name, key] of Object.entries(UNIFORMS)) {
      gl.uniform1f(this.u(name), config[key])
    }
    gl.uniform3f(
      this.u('color'),
      ((config.color >> 16) & 0xff) / 0xff,
      ((config.color >> 8) & 0xff) / 0xff,
      (config.color & 0xff) / 0xff,
    )

    // Читаем из текущего буфера, пишем в парный — на следующем кадре меняем местами.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer[this.bufferIndex])
    this.bindAttributes()
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffer[1 - this.bufferIndex])
    this.bindAttributes()
    gl.beginTransformFeedback(gl.POINTS)
    gl.drawArrays(gl.POINTS, 0, config.particlesCount)
    gl.endTransformFeedback()
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)

    this.bufferIndex = 1 - this.bufferIndex
  }

  private bindAttributes() {
    const gl = this.context
    // location, размер в float'ах, смещение в байтах — раскладка частицы в буфере
    const layout: [number, number, number][] = [
      [0, 2, 0],
      [1, 2, 8],
      [2, 1, 16],
      [3, 1, 20],
    ]
    for (const [location, size, offset] of layout) {
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, PARTICLE_STRIDE, offset)
      gl.enableVertexAttribArray(location)
    }
  }

  public destroy() {
    const gl = this.context
    if (this.buffer) {
      gl.deleteBuffer(this.buffer[0])
      gl.deleteBuffer(this.buffer[1])
      this.buffer = null
    }
    if (this.program) {
      gl.deleteProgram(this.program)
      this.program = null
    }
    this.uniforms.clear()
    this.inited = false

    // отступление от tweb: там контекст остаётся жить до сборки мусора. Спойлер —
    // опциональный эффект, держать за него GPU-память после размонтирования нельзя.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
