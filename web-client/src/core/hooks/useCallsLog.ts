import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { CallLogEntry } from '../managers/callsManager'

// Журнал звонков (GET /calls) для экрана «Звонки». Read-путь через managers:
// эфемерные данные экрана, не realtime-сущность стора. null = ещё грузится.
export function useCallsLog(): CallLogEntry[] | null {
  const managers = useManagers()
  const [calls, setCalls] = useState<CallLogEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    void managers.calls.log()
      .then((c) => { if (alive) setCalls(c) })
      .catch(() => { if (alive) setCalls([]) })
    return () => { alive = false }
  }, [managers])
  return calls
}
