import { type CSSProperties } from 'react'
import classNames from '../../lib/classNames'
import s from './Slider.module.scss'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  /** цвет трека/ползунка (по умолчанию --tg-accent) */
  color?: string
  className?: string
}

// Ползунок (нативный range), стилизованный под tweb.
export default function Slider({ value, min = 0, max = 100, step = 1, onChange, color, className }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const style = { '--fill': `${pct}%`, ...(color ? { '--sl-color': color } : {}) } as CSSProperties
  return (
    <input
      type="range"
      className={classNames(s.slider, className ?? '')}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={style}
    />
  )
}
