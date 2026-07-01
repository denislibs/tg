import { type CSSProperties } from 'react'
import s from './Spinner.module.scss'

interface SpinnerProps {
  size?: number
  /** толщина кольца */
  thickness?: number
  /** цвет (currentColor по умолчанию наследуется) */
  color?: string
  className?: string
}

// Крутящееся кольцо — замена MUI CircularProgress.
export default function Spinner({ size = 24, thickness = 2, color, className }: SpinnerProps) {
  const style: CSSProperties = { width: size, height: size, borderWidth: thickness }
  if (color) style.color = color
  return <span className={`${s.spinner}${className ? ` ${className}` : ''}`} style={style} />
}
