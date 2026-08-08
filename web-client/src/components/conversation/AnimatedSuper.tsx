// AnimatedSuper — порт tweb `components/animatedSuper.ts`: контейнер, в котором
// содержимое сменяется вертикальным слайдом. Ряды абсолютные и наложены друг на
// друга; при смене индекса уходящий ряд получает `is-hiding` + направление
// (`from-top` / `from-bottom`), приходящий стартует со смещения и едет в 0.
// Направление задаёт сам вызывающий (в tweb — `animate(index, previousIndex)`:
// вниз по списку = fromTop).
//
// Стили — styles/tweb/_animatedSuper.scss (дословный порт партиала).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'

/** длительность --pm-transition (base.scss:57) — через неё снимаем ушедший ряд */
const TRANSITION_MS = 200

interface Row {
  key: number
  node: ReactNode
  /** ряд уходит: true — направление сверху, false — снизу */
  hidingFromTop?: boolean
}

export default function AnimatedSuper({
  index,
  children,
  className,
  rowClassName,
}: {
  /** номер текущего содержимого: его изменение и запускает слайд */
  index: number
  children: ReactNode
  className?: string
  rowClassName?: string
}) {
  const [rows, setRows] = useState<Row[]>([{ key: index, node: children }])
  const prevIndex = useRef(index)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (prevIndex.current === index) {
      // содержимое того же ряда обновилось — просто перерисовать
      setRows((rs) => rs.map((r) => (r.key === index ? { ...r, node: children } : r)))
      return
    }
    // tweb animate(): вниз по списку (индекс вырос) — уходящий ряд уезжает вверх
    const fromTop = index > prevIndex.current
    prevIndex.current = index
    setRows((rs) => [
      ...rs.map((r) => ({ ...r, hidingFromTop: fromTop })),
      { key: index, node: children },
    ])
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setRows((rs) => rs.filter((r) => r.key === index)), TRANSITION_MS)
    return () => clearTimeout(timer.current)
  }, [index, children])

  return (
    <div className={classNames('animated-super', className ?? '')}>
      {rows.map((r) => (
        <div
          key={r.key}
          className={classNames(
            'animated-super-row',
            rowClassName ?? '',
            r.hidingFromTop === undefined ? '' : 'is-hiding',
            r.hidingFromTop === true ? 'from-top' : r.hidingFromTop === false ? 'from-bottom' : '',
          )}
        >
          {r.node}
        </div>
      ))}
    </div>
  )
}
