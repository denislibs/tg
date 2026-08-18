/**
 * Порт tweb `components/progressRing.tsx` — кольцо прогресса на SVG. Один модуль
 * на ВСЕХ потребителей, как в оригинале: кружок в ленте
 * (`components/wrappers/video.ts`, ветка `doc.type === 'round'`) и превью записи
 * кружка (`components/composer/RoundRecordPreview.tsx`, порт
 * `chat/recording/videoRecordingPanel.tsx`). Разметка/классы/атрибуты — 1:1 с
 * оригиналом, потому что на них построены CSS-правила (`.progress-ring`,
 * `.progress-ring__circle`) и глобальный resize-хендлер tweb, который правит уже
 * созданный элемент (`video.ts:54-74`, у нас пока не портирован — см. шапку
 * `wrappers/video.ts`).
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
 * дословно: те же поля, та же семантика `destroy` (после него `setProgress`
 * молчит — аналог диспоуза реактивного рута), тот же контракт «вызывающий может
 * писать `stroke-dashoffset` сам, компонент не спорит» (`video.ts` так и делает
 * — гонит кадры кружка руками).
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
  const radius = getProgressRingRadius(props.size, strokeWidth)
  const circumference = 2 * Math.PI * radius

  const element = document.createElementNS(NS, 'svg')
  element.setAttributeNS(null, 'class', classNames('progress-ring', props.class ?? ''))
  element.setAttributeNS(null, 'width', '' + props.size)
  element.setAttributeNS(null, 'height', '' + props.size)
  element.style.transform = 'rotate(-90deg)'

  const circle = document.createElementNS(NS, 'circle')
  circle.setAttributeNS(null, 'class', 'progress-ring__circle')
  circle.setAttributeNS(null, 'stroke', props.stroke ?? 'white')
  circle.setAttributeNS(null, 'stroke-opacity', '' + (props.strokeOpacity ?? 0.3))
  circle.setAttributeNS(null, 'stroke-width', '' + strokeWidth)
  circle.setAttributeNS(null, 'cx', '' + props.size / 2)
  circle.setAttributeNS(null, 'cy', '' + props.size / 2)
  circle.setAttributeNS(null, 'r', '' + radius)
  circle.setAttributeNS(null, 'fill', 'transparent')
  circle.style.strokeDasharray = `${circumference} ${circumference}`
  circle.style.strokeDashoffset = '' + getDashoffset(circumference, props.progress)
  element.append(circle)

  return element
}

export interface ProgressRingHandle {
  element: SVGSVGElement
  circle: SVGCircleElement
  setProgress: (progress: number) => void
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
  const element = ProgressRing({ ...opts, progress: opts.progress ?? 0 })
  const circle = element.firstElementChild as SVGCircleElement
  const circumference = 2 * Math.PI * getProgressRingRadius(opts.size, opts.strokeWidth ?? DEFAULT_STROKE_WIDTH)
  let destroyed = false

  return {
    element,
    circle,
    setProgress: (progress: number) => {
      if(destroyed) return
      circle.style.strokeDashoffset = '' + getDashoffset(circumference, progress)
    },
    destroy: () => {
      destroyed = true
    },
  }
}
