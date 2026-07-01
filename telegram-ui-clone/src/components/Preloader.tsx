import s from './Preloader.module.scss'

// tweb-style circular preloader: a constant 3/4 (75%) arc with round caps that
// spins at one rotation per second — no growing/shrinking dash.
export default function Preloader({
  size = 40,
  stroke = 3,
  color = 'currentColor',
}: {
  size?: number
  stroke?: number
  color?: string
}) {
  const c = size / 2
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  return (
    <svg className={s.svg} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.75} ${circ}`}
      />
    </svg>
  )
}
