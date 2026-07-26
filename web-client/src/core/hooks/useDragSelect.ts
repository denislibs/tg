// src/core/hooks/useDragSelect.ts
// Drag-to-select for the message feed (tweb's selection.ts onMouseDown behaviour):
// while in selection mode, press on a bubble and drag — every bubble the pointer
// passes (and all the ones in between, so a fast drag never skips) toggles in one
// direction. The direction is decided once, from the START bubble: pressing on an
// UNselected message selects along the drag; pressing on a selected one deselects.
//
// mousedown is bound via the returned React handler (fresh closure each render, so
// no stale state). The short-lived mousemove/mouseup are bound imperatively only
// for the duration of one drag. A plain click (down+up, no move) is left to the
// row's own onClick — we only take over once the pointer actually moves, and then
// flip suppressClickRef so that trailing click doesn't double-toggle.
import { useCallback, type MutableRefObject, type RefObject, type MouseEvent as ReactMouseEvent } from 'react'

interface Options {
  scrollRef: RefObject<HTMLElement | null>
  enabled: boolean
  selectedRef: MutableRefObject<Set<number>>
  setSelected: (updater: (prev: Set<number>) => Set<number>) => void
  // set true the moment a drag moves, so the row's trailing onClick is ignored
  suppressClickRef: MutableRefObject<boolean>
}

const midOf = (el: Element | null): number | null => {
  const node = el?.closest('[data-mid]') as HTMLElement | null
  const mid = node ? Number(node.dataset.mid) : NaN
  return Number.isFinite(mid) && mid > 0 ? mid : null
}

export function useDragSelect({ scrollRef, enabled, selectedRef, setSelected, suppressClickRef }: Options) {
  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (!enabled || e.button !== 0) return
      const startMid = midOf(e.target as Element)
      if (startMid == null) return

      // Ordered list of message ids currently in the DOM — the universe the drag
      // range is sliced from (read once at drag start; the window is stable mid-drag).
      const order = Array.from(scrollRef.current?.querySelectorAll('[data-mid]') ?? [])
        .map((n) => Number((n as HTMLElement).dataset.mid))
        .filter((m) => Number.isFinite(m) && m > 0)
      const startIdx = order.indexOf(startMid)
      if (startIdx < 0) return

      // Direction fixed by the start bubble (tweb): unselected → select, else deselect.
      const select = !selectedRef.current.has(startMid)
      let moved = false

      const applyTo = (mid: number) => {
        const idx = order.indexOf(mid)
        if (idx < 0) return
        const [lo, hi] = idx < startIdx ? [idx, startIdx] : [startIdx, idx]
        setSelected((prev) => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) {
            if (select) next.add(order[i])
            else next.delete(order[i])
          }
          return next
        })
      }

      const onMove = (ev: MouseEvent) => {
        if (!moved) {
          moved = true
          suppressClickRef.current = true
          document.body.classList.add('rt-no-select')
        }
        const mid = midOf(document.elementFromPoint(ev.clientX, ev.clientY))
        if (mid != null) applyTo(mid)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.classList.remove('rt-no-select')
        // let the trailing click (if any) fire and be ignored, then re-arm clicks
        if (moved) setTimeout(() => { suppressClickRef.current = false }, 0)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [enabled, scrollRef, selectedRef, setSelected, suppressClickRef],
  )

  return { onMouseDown }
}
