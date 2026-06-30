// useRipple — React-порт логики tweb src/components/ripple.ts.
// Возвращает обработчик pointerdown и узел-контейнер с «каплями». Хост должен быть
// position:relative (контейнер сам overflow:hidden + border-radius:inherit). Размер
// круга = расстояние от клика до дальнего угла (формула tweb), круг центрируется в
// точке клика, растёт через keyframe scale, гаснет (.hiding) на pointerup.
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import s from './Ripple.module.scss'

interface Drop {
  key: number
  x: number
  y: number
  size: number
  hiding: boolean
}

export function useRipple(): {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  ripple: ReactNode
} {
  const [drops, setDrops] = useState<Drop[]>([])
  const idRef = useRef(0)

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    // Left mouse button only (touch/pen always); ignore right/middle.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    // tweb's radius: distance from the click to the farthest corner.
    const size = Math.sqrt(
      (Math.abs(cy - rect.height / 2) + rect.height / 2) ** 2 +
        (Math.abs(cx - rect.width / 2) + rect.width / 2) ** 2,
    )
    const key = idRef.current++
    setDrops((d) => [...d, { key, x: cx - size / 2, y: cy - size / 2, size, hiding: false }])
    const hide = () => setDrops((d) => d.map((it) => (it.key === key ? { ...it, hiding: true } : it)))
    window.addEventListener('pointerup', hide, { once: true })
    window.addEventListener('pointercancel', hide, { once: true })
  }, [])

  const remove = useCallback((key: number) => {
    setDrops((d) => d.filter((it) => it.key !== key))
  }, [])

  const ripple = (
    <span className={s.root} aria-hidden>
      {drops.map((d) => (
        <span
          key={d.key}
          className={d.hiding ? `${s.circle} ${s.hiding}` : s.circle}
          style={{ left: d.x, top: d.y, width: d.size, height: d.size }}
          onTransitionEnd={() => {
            if (d.hiding) remove(d.key)
          }}
        />
      ))}
    </span>
  )

  return { onPointerDown, ripple }
}
