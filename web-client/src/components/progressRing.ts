/**
 * Порт tweb `components/progressRing.tsx` — кольцо прогресса на SVG. Один модуль
 * на ВСЕХ потребителей, как в оригинале: кружок в ленте
 * (`components/wrappers/video.ts`, ветка `doc.type === 'round'`) и превью записи
 * кружка (`components/composer/RoundRecordPreview.tsx`, порт
 * `chat/recording/videoRecordingPanel.tsx`). Разметка/классы/атрибуты — 1:1 с
 * оригиналом, потому что на них построены CSS-правила (`.progress-ring`,
 * `.progress-ring__circle`). Размер живого кольца меняет `setSize` хендла
 * (tweb 1faad1d59 — им пользуется resize кружков в `wrappers/video.ts`).
 *
 * `progress` — 0..1 (0 = пустое кольцо, 1 = полное). Кольцо повёрнуто на -90°,
 * поэтому заполняется по часовой от 12 часов.
 *
 * ── Форма против оригинала ──────────────────────────────────────────────────
 * В tweb это Solid-компонент (`ProgressRing`) + императивная обёртка
 * `createProgressRing`, которая держит свой реактивный рут и отдаёт хендл
 * `{element, circle, setProgress, destroy}`. Solid'а у нас нет, а собрать ядро
 * на React нельзя: единственный способ отдать из React-компонента живой DOM-узел
 * — `createRoot` из `react-dom/client`, то есть враппер ленты
 * (`wrappers/video.ts`, ванильный бабл) начал бы тянуть react/react-dom — ровно
 * та причина, по которой у нас уже разъезжались реализации иконки. Поэтому ядро
 * ванильное (строит те же узлы, что JSX оригинала), а ХЕНДЛ повторяет оригинал
 * дословно: те же поля (`setSize` — с 1faad1d59), та же семантика `destroy`
 * (после него `setProgress`/`setSize` молчат — аналог диспоуза реактивного
 * рута), тот же контракт «вызывающий может писать `stroke-dashoffset` сам,
 * компонент не спорит» (`video.ts` так и делает — гонит кадры кружка руками).
 */
import classNames from '@shared/lib/classNames'

export interface ProgressRingProps {
  size: number
  strokeWidth?: number
  stroke?: string
  strokeOpacity?: number
  progress: number
  class?: string
}

export const DEFAULT_STROKE_WIDTH = 3.5

// Общая формула радиуса: и компонент, и императивный пересчёт размера в
// `wrappers/video.ts` считают одно и то же значение (отступ `strokeWidth * 2` —
// константа оригинала: на дефолтных 3.5 это halfSize - 7).
export function getProgressRingRadius(size: number, strokeWidth: number = DEFAULT_STROKE_WIDTH): number {
  return size / 2 - strokeWidth * 2
}

/** tweb 1faad1d59 (progressRing.tsx:36-38). */
export function getProgressRingCircumference(size: number, strokeWidth: number = DEFAULT_STROKE_WIDTH): number {
  return 2 * Math.PI * getProgressRingRadius(size, strokeWidth)
}

const NS = 'http://www.w3.org/2000/svg'

/** `stroke-dashoffset` для доли заполнения (tweb `dashoffset()`, :40). */
function getDashoffset(circumference: number, progress: number): number {
  return circumference * (1 - Math.max(0, Math.min(1, progress || 0)))
}

/**
 * Тот же узел, что рисует JSX оригинала (progressRing.tsx:42-65):
 * `svg.progress-ring[width/height, transform: rotate(-90deg)] >
 *  circle.progress-ring__circle[stroke, stroke-opacity, stroke-width, cx, cy, r,
 *  fill="transparent", style: stroke-dasharray/stroke-dashoffset]`.
 */
export default function ProgressRing(props: ProgressRingProps): SVGSVGElement {
  const strokeWidth = props.strokeWidth ?? DEFAULT_STROKE_WIDTH

  const element = document.createElementNS(NS, 'svg')
  element.setAttributeNS(null, 'class', classNames('progress-ring', props.class ?? ''))
  element.style.transform = 'rotate(-90deg)'

  const circle = document.createElementNS(NS, 'circle')
  circle.setAttributeNS(null, 'class', 'progress-ring__circle')
  circle.setAttributeNS(null, 'stroke', props.stroke ?? 'white')
  circle.setAttributeNS(null, 'stroke-opacity', '' + (props.strokeOpacity ?? 0.3))
  circle.setAttributeNS(null, 'stroke-width', '' + strokeWidth)
  circle.setAttributeNS(null, 'fill', 'transparent')
  element.append(circle)

  applyGeometry(element, props.size, strokeWidth, props.progress)
  return element
}

/** Геометрия от размера — то, что у оригинала пересчитывают реактивные
 *  `radius()`/`circumference()`/`dashoffset()` при смене `size` (progressRing.tsx:41-44). */
function applyGeometry(element: SVGSVGElement, size: number, strokeWidth: number, progress: number): void {
  const circle = element.firstElementChild as SVGCircleElement
  const radius = getProgressRingRadius(size, strokeWidth)
  const circumference = getProgressRingCircumference(size, strokeWidth)
  element.setAttributeNS(null, 'width', '' + size)
  element.setAttributeNS(null, 'height', '' + size)
  circle.setAttributeNS(null, 'cx', '' + size / 2)
  circle.setAttributeNS(null, 'cy', '' + size / 2)
  circle.setAttributeNS(null, 'r', '' + radius)
  circle.style.strokeDasharray = `${circumference} ${circumference}`
  circle.style.strokeDashoffset = '' + getDashoffset(circumference, progress)
}

export interface ProgressRingHandle {
  element: SVGSVGElement
  circle: SVGCircleElement
  setProgress: (progress: number) => void
  /** tweb 1faad1d59: размер ведётся императивно, как и прогресс — пересчёт
   *  геометрии прогресса не теряет. */
  setSize: (size: number) => void
  destroy: () => void
}

/**
 * Императивный хендл для не-React вызывающих (tweb `createProgressRing`,
 * :82-107). `destroy()` — конец жизни кольца: дальше `setProgress` не пишет
 * (в оригинале ту же роль играет диспоуз реактивного рута). Элемент из DOM
 * убирает вызывающий, как и в tweb.
 */
export function createProgressRing(
  opts: Omit<ProgressRingProps, 'progress'> & { progress?: number },
): ProgressRingHandle {
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH
  let progress = opts.progress ?? 0
  let size = opts.size
  const element = ProgressRing({ ...opts, progress })
  const circle = element.firstElementChild as SVGCircleElement
  let destroyed = false

  return {
    element,
    circle,
    setProgress: (value: number) => {
      if(destroyed) return
      progress = value
      circle.style.strokeDashoffset = '' + getDashoffset(getProgressRingCircumference(size, strokeWidth), progress)
    },
    setSize: (value: number) => {
      if(destroyed) return
      size = value
      applyGeometry(element, size, strokeWidth, progress)
    },
    destroy: () => {
      destroyed = true
    },
  }
}
