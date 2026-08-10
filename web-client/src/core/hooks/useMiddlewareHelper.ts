// React-адаптер вендореного tweb-примитива актуальности (@helpers/middleware):
// хелпер живёт жизнь компонента, на unmount уничтожается — все выданные им
// middleware протухают, опоздавшие .then/onload отбрасываются вызывающим кодом.
// Паттерны использования — в web-client/CLAUDE.md («Асинхронщина и актуальность»).
// StrictMode-безопасно: destroy() в clean() пересоздаёт details, поэтому после
// ремаунта тот же хелпер снова выдаёт живые middleware (пин в middleware.test.ts).
import { useEffect, useRef } from 'react'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'

export function useMiddlewareHelper(): MiddlewareHelper {
  const ref = useRef<MiddlewareHelper | null>(null)
  ref.current ??= getMiddleware()
  useEffect(() => {
    const helper = ref.current!
    return () => helper.destroy()
  }, [])
  return ref.current
}
