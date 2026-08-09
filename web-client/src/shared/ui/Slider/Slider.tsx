import { type CSSProperties } from 'react'
import classNames from '../../lib/classNames'
import s from './Slider.module.scss'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  /** цвет трека/ползунка (по умолчанию --primary-color) */
  color?: string
  className?: string
}

// Ползунок — разметка tweb RangeSelector (`.progress-line`, стили —
// styles/tweb/_ckin.scss):
//   div.progress-line.use-transform > div.progress-line__filled
//                                   + input.progress-line__seek[type=range]
// Полоса-фон рисуется псевдоэлементом `:before`, заполненная часть — отдельным
// div'ом (в режиме use-transform он всегда width:100% и масштабируется по X,
// чтобы не дёргать layout), кругляш-ползунок — `:after` у заполненной части.
// Нативный input лежит поверх прозрачным и даёт клавиатуру/драг.
export default function Slider({ value, min = 0, max = 100, step = 1, onChange, color, className }: SliderProps) {
  const frac = max > min ? (value - min) / (max - min) : 0
  const style = {
    ['--progress' as string]: String(frac),
    ...(color ? { ['--color' as string]: color } : {}),
  } as CSSProperties
  return (
    <div className={classNames('progress-line', 'use-transform', s.root, className ?? '')} style={style}>
      <div className="progress-line__filled" style={{ transform: `scaleX(${frac})` }} />
      <input
        className="progress-line__seek"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
