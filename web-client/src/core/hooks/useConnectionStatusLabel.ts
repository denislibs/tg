// src/core/hooks/useConnectionStatusLabel.ts
import { useEffect, useState } from 'react'

// tweb connectionStatus.ts:19 INITIAL_DELAY — статус не показывается
// в первые 2с после старта, чтобы не мигать на каждом холодном заходе.
const INITIAL_DELAY = 2000

export function useConnectionStatusLabel(loaded: boolean): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setElapsed(true), INITIAL_DELAY)
    return () => clearTimeout(t)
  }, [])
  return elapsed && !loaded
}
