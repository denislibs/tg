import s from './SpinnerArc.module.scss'

// tweb-style circular preloader: a constant 3/4 (75%) arc with round caps that
// spins at one rotation per second — no growing/shrinking dash.
//
// Переименован из Preloader.tsx: путь `components/preloader.ts` занял порт
// tweb ProgressivePreloader (кейс-инсенситив ФС не различает Preloader/preloader,
// extensionless-импорты ломались — TS1149). Этот React-спиннер — временный
// стенд-ин загрузки медиа в Chat.tsx; Стадия E (медиа-суперпорт) заменит его
// настоящим ProgressivePreloader и удалит файл.
export default function SpinnerArc({
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
