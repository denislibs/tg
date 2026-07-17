// Кольцо прогресса загрузки (tweb ProgressivePreloader / .preloader-circular):
// тёмный диск, вращающаяся белая дуга, длина дуги = прогресс (totalLength
// 149.82 — окружность как у оригинального svg viewBox 27 27 54 54).
import s from './RadialProgress.module.scss'

const TOTAL = 149.82

export default function RadialProgress({ progress, size = 54 }: {
  /** 0..1 */
  progress: number
  size?: number
}) {
  const dash = Math.max(5, progress * TOTAL)
  return (
    <div className={s.disc} data-radial-progress style={{ width: size, height: size }}>
      <svg className={s.spin} viewBox="27 27 54 54">
        <circle
          className={s.path}
          cx="54"
          cy="54"
          r="23.85"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ strokeDasharray: `${dash}, ${TOTAL}` }}
        />
      </svg>
    </div>
  )
}
