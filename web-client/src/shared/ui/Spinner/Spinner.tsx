import { type CSSProperties } from 'react'
import classNames from '../../lib/classNames'
import s from './Spinner.module.scss'

interface SpinnerProps {
  size?: number
  /** толщина кольца */
  thickness?: number
  /** цвет (по умолчанию #fff — как --color у tweb .preloader-container) */
  color?: string
  className?: string
}

// Крутящееся кольцо — разметка tweb `preloader.ts:95-97`:
//   .preloader-container.preloader-swing.is-visible.forwards
//     > .you-spin-me-round > svg.preloader-circular > circle.preloader-path-new
// Вращение (`rotate` 1s linear), длина дуги (112.36/149.82 = 75%), скругление
// концов и цвет (--color) — из `_preloader.scss`.
//
// Отступление: у tweb `.preloader-container` — ОВЕРЛЕЙ (absolute; inset: 0;
// margin: auto; 54x54), его вешает JS поверх медиа/кнопки. Наш Spinner стоит
// в потоке, поэтому позиционирование и размер переопределяем в модуле.
// Полный порт preloader-подсистемы — вместе с медиа (фаза 5).
export default function Spinner({ size = 24, thickness = 2, color, className }: SpinnerProps) {
  const style = {
    width: size,
    height: size,
    ...(color ? { '--color': color } : {}),
    '--preloader-stroke-width': String(thickness),
  } as CSSProperties
  return (
    <div
      className={classNames('preloader-container', 'preloader-swing', 'is-visible', 'forwards', s.root, className ?? '')}
      style={style}
    >
      <div className="you-spin-me-round">
        <svg className="preloader-circular" viewBox="27 27 54 54">
          <circle className="preloader-path-new" cx="54" cy="54" r="24" fill="none" strokeMiterlimit="10" />
        </svg>
      </div>
    </div>
  )
}
