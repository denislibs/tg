// useRipple — React-порт логики tweb src/components/ripple.ts (тайминг скопирован
// 1:1 из tweb `_handler`, без отсебятины). Возвращает обработчик pointerdown и
// узел-контейнер с «каплями». Хост должен быть position:relative (контейнер сам
// overflow:hidden + border-radius:inherit).
//
// Размер круга = расстояние от клика до дальнего угла (формула tweb). Гашение —
// как в tweb: при elapsed < duration круг ещё растёт, а hiding ставится в
// max(delay − duration/2, 0) и удаление в delay (delay = max(duration − elapsed,
// duration/2)); иначе hiding сразу + удаление через duration/2.
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import s from './Ripple.module.scss'

const DURATION = 700 // --ripple-duration .7s (Ripple.module.scss)

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
      const size = Math.sqrt(
        (Math.abs(cy - rect.height / 2) + rect.height / 2) ** 2 +
          (Math.abs(cx - rect.width / 2) + rect.width / 2) ** 2,
      )
      const key = idRef.current++
      const startTime = Date.now()
      setDrops((d) => [...d, { key, x: cx - size / 2, y: cy - size / 2, size, hiding: false }])

      // tweb `_handler` 1:1.
      const onUp = () => {
        const elapsed = Date.now() - startTime
        if (elapsed < DURATION) {
          const delay = Math.max(DURATION - elapsed, DURATION / 2)
          window.setTimeout(() => setHiding(key), Math.max(delay - DURATION / 2, 0))
          window.setTimeout(() => remove(key), delay)
        } else {
          setHiding(key)
          window.setTimeout(() => remove(key), DURATION / 2)
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
