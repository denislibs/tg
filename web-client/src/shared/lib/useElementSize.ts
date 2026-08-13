import { useCallback, useRef, useState } from 'react'

/**
 * Callback-ref, который сообщает ширину и высоту узла и держит их актуальными
 * через ResizeObserver — обобщение соседнего `useMeasuredHeight` (тот же приём:
 * `ResizeObserver` + `Math.round(offset*)`, только на оба измерения, а не
 * только на высоту). Аналог концепции tweb `hooks/useElementSize.ts`
 * (там — Solid-примитив на `createRoot`/`createStore`; здесь — React
 * callback-ref в стиле уже существующего в этом репозитории `useMeasuredHeight`,
 * т.к. Solid-реактивность на React не переносится 1:1).
 *
 * При размонтировании (ref получает `null`) размеры сбрасываются в 0 — как и
 * `onHeight(0)` у `useMeasuredHeight`.
 */
export function useElementSize(): { ref: (el: HTMLElement | null) => void; width: number; height: number } {
  const roRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const ref = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) {
      setSize({ width: 0, height: 0 })
      return
    }
    const apply = () => setSize({ width: Math.round(el.offsetWidth), height: Math.round(el.offsetHeight) })
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    roRef.current = ro
  }, [])

  return { ref, width: size.width, height: size.height }
}
