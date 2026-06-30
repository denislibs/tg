// useRipple — React-порт логики tweb src/components/ripple.ts.
// Возвращает обработчик pointerdown и узел-контейнер с «каплями». Хост должен быть
// position:relative (контейнер сам overflow:hidden + border-radius:inherit).
//
// Размер круга = расстояние от клика до дальнего угла (формула tweb) → при scale до
// --ripple-end-scale круг полностью заливает элемент. Ключевое: гашение начинается
// ТОЛЬКО когда круг доехал до конца (animationend) И указатель отпущен — поэтому
// даже на быстрый клик заливка всегда доигрывается до полного круга, а не мигает.
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import s from './Ripple.module.scss'

const FADE = 350 // opacity fade-out (ms), = --ripple-duration .7s / 2 (см. Ripple.module.scss)

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
  // Per-drop gate: fade only once the grow finished AND the pointer was released.
  const gate = useRef(new Map<number, { up: boolean; grown: boolean }>())

  const startHide = useCallback((key: number) => {
    setDrops((d) => d.map((it) => (it.key === key ? { ...it, hiding: true } : it)))
    window.setTimeout(() => {
      setDrops((d) => d.filter((it) => it.key !== key))
      gate.current.delete(key)
    }, FADE)
  }, [])

  const maybeHide = useCallback(
    (key: number) => {
      const g = gate.current.get(key)
      if (g && g.up && g.grown) startHide(key)
    },
    [startHide],
  )

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
      gate.current.set(key, { up: false, grown: false })
      setDrops((d) => [...d, { key, x: cx - size / 2, y: cy - size / 2, size, hiding: false }])

      const up = () => {
        const g = gate.current.get(key)
        if (g) {
          g.up = true
          maybeHide(key)
        }
      }
      window.addEventListener('pointerup', up, { once: true })
      window.addEventListener('pointercancel', up, { once: true })
    },
    [maybeHide],
  )

  const onGrown = useCallback(
    (key: number) => {
      const g = gate.current.get(key)
      if (g) {
        g.grown = true
        maybeHide(key)
      }
    },
    [maybeHide],
  )

  const ripple = (
    <span className={s.root} aria-hidden>
      {drops.map((d) => (
        <span
          key={d.key}
          className={d.hiding ? `${s.circle} ${s.hiding}` : s.circle}
          style={{ left: d.x, top: d.y, width: d.size, height: d.size }}
          onAnimationEnd={() => onGrown(d.key)}
        />
      ))}
    </span>
  )

  return { onPointerDown, ripple }
}
