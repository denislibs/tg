// Одна зона приёма файлов — порт tweb `src/components/chat/dragAndDrop.ts`.
//
// Дерево 1:1 с tweb (dragAndDrop.ts:18-53):
//
//   div.drop.z-depth-1[.has-icon][.is-dragover]
//     div.drop-icon.disable-hover      > span.tgico
//     div.drop-header.disable-hover
//     div.drop-subtitle.disable-hover
//     div.drop-outline-wrapper.disable-hover
//       svg.drop-outline > path.drop-outline-path
//
// Стили — глобальный `styles/tweb/_chatDrop.scss` (портирован дословно): фон,
// радиус, цвет-по-ховеру, бегущий пунктир рамки (`drop-outline-move`).
import { useCallback, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import generatePathData from './generatePathData'

export default function ChatDragAndDrop({
  icon,
  header,
  subtitle,
  onDrop,
}: {
  icon?: IconName
  header: string
  subtitle?: string
  onDrop: (e: DragEvent<HTMLDivElement>) => void
}) {
  const [dragover, setDragover] = useState(false)
  const outlineRef = useRef<HTMLDivElement>(null)
  const [outline, setOutline] = useState({ w: 0, h: 0, d: '' })

  // tweb `setPath()`: svg растягивается по обёртке, радиус 10, отступ radius/2 —
  // чтобы обводка толщиной 2 не срезалась краем вьюбокса.
  const setPath = useCallback(() => {
    const el = outlineRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const radius = 10
    const pos = radius / 2
    setOutline({
      w: rect.width,
      h: rect.height,
      d: generatePathData(pos, pos, rect.width - radius, rect.height - radius, radius, radius, radius, radius),
    })
  }, [])

  // tweb зовёт setPath() один раз — сразу после монтирования зоны (drops
  // создаются на каждое перетаскивание заново). У нас зона может пережить
  // ресайз окна во время drag, поэтому ещё и ResizeObserver.
  useLayoutEffect(() => {
    setPath()
    const el = outlineRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(setPath)
    ro.observe(el)
    return () => ro.disconnect()
  }, [setPath])

  return (
    <div
      className={classNames('drop', 'z-depth-1', icon ? 'has-icon' : '', dragover ? 'is-dragover' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
    >
      {icon && (
        <div className="drop-icon disable-hover">
          {/* размер глифа даёт `.drop-icon { font-size: 6rem }` — наследуем */}
          <TgIcon name={icon} size="inherit" />
        </div>
      )}
      <div className="drop-header disable-hover">{header}</div>
      {subtitle && <div className="drop-subtitle disable-hover">{subtitle}</div>}
      <div ref={outlineRef} className="drop-outline-wrapper disable-hover">
        <svg
          className="drop-outline"
          preserveAspectRatio="none"
          viewBox={`0 0 ${outline.w} ${outline.h}`}
          width={outline.w}
          height={outline.h}
        >
          <path className="drop-outline-path" d={outline.d} />
        </svg>
      </div>
    </div>
  )
}
