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
// Хук возвращает готовую строку классов состояния — компонент подмешивает её
// в className своего узла.
import { useEffect, useRef, useState } from 'react'

export function useSetTransition(forwards: boolean, className: string, duration = 200): string {
  const [cls, setCls] = useState(forwards ? `${className} forwards` : '')
  const mounted = useRef(false)

  useEffect(() => {
    // на первом рендере состояние уже отражено в initial state — без анимации
    if (!mounted.current) {
      mounted.current = true
      return
    }

    setCls(forwards ? `${className} forwards animating` : `${className} backwards animating`)
    const id = window.setTimeout(() => {
      setCls(forwards ? `${className} forwards` : '')
    }, duration)
    return () => window.clearTimeout(id)
  }, [forwards, className, duration])

  return cls
}
