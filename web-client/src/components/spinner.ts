// Порт `tweb/src/components/spinner.tsx` (компонент `Spinner`, :17-38) —
// крутилка-дуга на SVG. Не путать с `shared/ui/Spinner` (React-обёртка над
// глобальным `.preloader-container.preloader-swing` из `_preloader.scss`):
// в оригинале это ДВА разных узла, и опрос показывает именно этот, маленький.
//
// Форма против оригинала — ванильная фабрика по приёму `progressRing.ts`:
// вызывающий (лента чата) не тянет ни react, ни solid. Вариант оригинала
// `SpinnerElement` (кастомный элемент) предмета не имеет — его потребителей
// у нас нет.
//
// Позиционируется АБСОЛЮТОМ, поэтому требует контейнера (примечание tweb :15).
import styles from './spinner.module.scss'

const SIZE = 24
const RADIUS = SIZE / 2

export interface SpinnerOptions {
  /** Толщина дуги, доля радиуса (0-1]. По умолчанию — как в tweb, `1 / radius`. */
  thickness?: number
  stroke?: string
}

/** Узел 1:1 с JSX оригинала (spinner.tsx:22-37). */
export function createSpinner(opts: SpinnerOptions = {}): SVGSVGElement {
  const thickness = opts.thickness ?? 1 / RADIUS
  const strokeWidth = thickness * RADIUS

  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  element.setAttributeNS(null, 'class', styles.spinner)
  element.setAttributeNS(null, 'viewBox', '0 0 24 24')
  element.setAttributeNS(null, 'width', '100')
  element.setAttributeNS(null, 'height', '100')

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttributeNS(null, 'cx', '' + RADIUS)
  circle.setAttributeNS(null, 'cy', '' + RADIUS)
  circle.setAttributeNS(null, 'r', '' + (RADIUS - strokeWidth - 0.5))
  circle.setAttributeNS(null, 'fill', 'none')
  circle.setAttributeNS(null, 'stroke', opts.stroke ?? 'white')
  circle.setAttributeNS(null, 'stroke-width', '' + strokeWidth)
  circle.setAttributeNS(null, 'stroke-linecap', 'round')
  circle.setAttributeNS(null, 'stroke-dashoffset', '0')
  element.append(circle)

  return element
}
