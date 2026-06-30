// useRipple — React-порт логики tweb src/components/ripple.ts.
// Возвращает обработчик pointerdown и узел-контейнер с «каплями». Хост должен быть
// position:relative (контейнер сам overflow:hidden + border-radius:inherit).
//
// Размер круга = расстояние от клика до дальнего угла (формула tweb), круг
// центрируется в точке клика и растёт через keyframe scale. Гашение (.hiding) —
// как в tweb: с гарантированным минимальным временем жизни, чтобы при быстром
// клике круг успел вырасти, а не мигнул (tweb: delay = max(duration−elapsed,
// duration/2); hiding в delay−duration/2; удаление в delay).
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import s from './Ripple.module.scss'

const DURATION = 700 // --ripple-duration .7s (desktop)

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

  const setHiding = useCallback((key: number) => {
    setDrops((d) => d.map((it) => (it.key === key ? { ...it, hiding: true } : it)))
  }, [])
  const remove = useCallback((key: number) => {
    setDrops((d) => d.filter((it) => it.key !== key))
  }, [])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
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
      const startTime = Date.now()
      setDrops((d) => [...d, { key, x: cx - size / 2, y: cy - size / 2, size, hiding: false }])

      const onUp = () => {
        const elapsed = Date.now() - startTime
        if (elapsed >= DURATION) {
          setHiding(key)
          window.setTimeout(() => remove(key), DURATION / 2)
        } else {
          const delay = Math.max(DURATION - elapsed, DURATION / 2)
          window.setTimeout(() => setHiding(key), Math.max(delay - DURATION / 2, 0))
          window.setTimeout(() => remove(key), delay)
        }
      }
      window.addEventListener('pointerup', onUp, { once: true })
      window.addEventListener('pointercancel', onUp, { once: true })
    },
    [setHiding, remove],
  )

  const ripple = (
    <span className={s.root} aria-hidden>
      {drops.map((d) => (
        <span
          key={d.key}
          className={d.hiding ? `${s.circle} ${s.hiding}` : s.circle}
          style={{ left: d.x, top: d.y, width: d.size, height: d.size }}
        />
      ))}
    </span>
  )

  return { onPointerDown, ripple }
}
