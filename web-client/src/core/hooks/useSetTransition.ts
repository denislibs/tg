// src/core/hooks/useSetTransition.ts
// Порт tweb `components/singleTransition.ts` (SetTransition) на React.
//
// tweb ведёт «переключаемые» состояния тремя классами на одном узле:
//   forwards=true  → className + `forwards`, плюс `animating` на время duration;
//   forwards=false → className + `backwards` + `animating` на время duration,
//                    после чего снимаются и `backwards`, и сам className.
// Именно поэтому CSS вроде `.bubbles.is-selecting.forwards` (вход) и
// `.bubbles.is-selecting` (выход) даёт разные transition-кривые, а класс
// остаётся на узле до конца обратной анимации.
//
// Сами правила живут не здесь, а в `core/dom/setTransition.ts`
// (`transitionClasses`) — один экземпляр на React-обёртку и на императивный
// `setTransition`, который ведёт те же классы прямо на узле. Хук — надстройка:
// он лишь хранит фазу в состоянии и отдаёт готовую строку классов, которую
// компонент подмешивает в className своего узла.
import { useEffect, useRef, useState } from 'react'
import { transitionClasses } from '../dom/setTransition'

const next = (current: string, className: string, forwards: boolean, animating: boolean) =>
  transitionClasses(current ? current.split(' ') : [], className, forwards, animating).join(' ')

export function useSetTransition(forwards: boolean, className: string, duration = 200): string {
  const [cls, setCls] = useState(() => next('', className, forwards, false))
  const mounted = useRef(false)

  useEffect(() => {
    // на первом рендере состояние уже отражено в initial state — без анимации
    if (!mounted.current) {
      mounted.current = true
      return
    }

    setCls((prev) => next(prev, className, forwards, true))
    const id = window.setTimeout(() => setCls((prev) => next(prev, className, forwards, false)), duration)
    return () => window.clearTimeout(id)
  }, [forwards, className, duration])

  return cls
}
