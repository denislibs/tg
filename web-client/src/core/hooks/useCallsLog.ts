import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { MyMessage } from '../models'

// Журнал звонков (GET /calls) для экрана «Звонки». Read-путь через managers:
// эфемерные данные экрана, не realtime-сущность стора. null = ещё грузится.
//
// Записи журнала — обычные СЛУЖЕБНЫЕ СООБЩЕНИЯ (`messageActionPhoneCall`), а
// карточки собеседников едут вектором `users` того же ответа: имя и аватарку
// экран берёт из зеркала карточек, как и любой другой список.
export function useCallsLog(): MyMessage[] | null {
  const managers = useManagers()
  const [calls, setCalls] = useState<MyMessage[] | null>(null)
  useEffect(() => {
    let alive = true
    void managers.calls.log()
      .then((r) => {
        if (!alive) return
        setCalls(r.messages)
      })
      .catch(() => { if (alive) setCalls([]) })
    return () => { alive = false }
  }, [managers])
  return calls
}
