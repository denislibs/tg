// Круглый чекбокс выбора — порт tweb .checkbox-field-round: невыбранное кольцо;
// при выборе акцентный круг вкатывается (.2s, задержка .05s, ease-in-out), затем
// рисуется белая галочка (.15s, задержка .15s). Используется в мультивыборе.
import { type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import s from './Checkbox.module.scss'

const EASE = 'easeInOut' as const

export interface CheckboxProps {
  checked: boolean
  /** цвет заливки (по умолчанию --tg-accent) */
  accent?: string
  /** цвет кольца (по умолчанию --tg-textFaint) */
  ring?: string
  size?: number
  /** square — квадрат со скруглением (tweb .checkbox-field, add members) */
  shape?: 'round' | 'square'
  /** нельзя переключить (уже участник) — приглушён */
  disabled?: boolean
}

export default function Checkbox({ checked, accent = 'var(--tg-accent)', ring = 'var(--tg-textFaint)', size = 18, shape = 'round', disabled = false }: CheckboxProps) {
  const style = {
    width: size, height: size, '--cb-accent': accent, '--cb-ring': ring,
    '--cb-radius': shape === 'square' ? '31%' : '50%',
    opacity: disabled ? 0.45 : 1,
  } as CSSProperties
  return (
    <div className={s.root} style={style}>
      <div className={s.ring} />
      <motion.div
        className={s.fill}
        initial={false}
        animate={{ scale: checked ? 1 : 0 }}
        transition={{ duration: 0.2, delay: checked ? 0.05 : 0, ease: EASE }}
      />
      <svg className={s.svg} viewBox="0 0 24 24" width={size} height={size}>
        <motion.path
          d="M7 12.5 L10.5 16 L17 8.5"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.15, delay: checked ? 0.15 : 0, ease: EASE }}
        />
      </svg>
    </div>
  )
}
