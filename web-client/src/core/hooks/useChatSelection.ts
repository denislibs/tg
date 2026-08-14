// src/core/hooks/useChatSelection.ts
// View-model hook for the feed's multi-select mode (extracted from Chat).
// Owns the selected-id set + the "selection mode" flag, the refs the drag handler
// reads without a stale closure, and the press-and-drag selection wiring. Behaviour
// is unchanged — the component drives reset/menu actions through the returned setters.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useDragSelect } from './useDragSelect'
import { pushEsc } from '../hotkeys'
import { useIsActiveChat } from '../chat/chatInstanceContext'

export interface ChatSelection {
  /** Selected message ids. Non-empty ⇒ selection mode (see `selecting`). */
  selected: Set<number>
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>
  /** Explicit flag: selection mode can be on with nothing selected yet. */
  selectionMode: boolean
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  /** selectionMode || selected.size > 0 */
  selecting: boolean
  selectedRef: React.MutableRefObject<Set<number>>
  dragSuppressClickRef: React.MutableRefObject<boolean>
  toggleSelect: (id: number) => void
  clearSelection: () => void
  dragSelect: ReturnType<typeof useDragSelect>
}

export function useChatSelection(scrollRef: RefObject<HTMLDivElement | null>): ChatSelection {
  const isActive = useIsActiveChat()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const selecting = selectionMode || selected.size > 0

  // Latest selection in a ref so the drag-select handler reads it without a stale
  // closure; suppressClickRef makes the trailing click after a drag a no-op.
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dragSuppressClickRef = useRef(false)

  const toggleSelect = useCallback((id: number) => {
    if (dragSuppressClickRef.current) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => { setSelected(new Set()); setSelectionMode(false) }, [])

  const dragSelect = useDragSelect({
    scrollRef,
    enabled: selecting,
    selectedRef,
    setSelected,
    suppressClickRef: dragSuppressClickRef,
  })

  // Esc exits multi-select — через глобальный Esc-стек (core/hotkeys), LIFO
  // поверх других оверлеев. Гейт активности: стек Esc — общий на все смонтированные
  // инстансы чата; без гейта мультиселект, оставленный включённым в фоновом
  // (скрытом) инстансе, продолжал бы класть свой обработчик в стек и перехватывал
  // бы Esc у активного инстанса.
  useEffect(() => {
    if (!selecting || !isActive) return
    return pushEsc(clearSelection)
  }, [selecting, isActive, clearSelection])

  return {
    selected, setSelected, selectionMode, setSelectionMode, selecting,
    selectedRef, dragSuppressClickRef, toggleSelect, clearSelection, dragSelect,
  }
}
