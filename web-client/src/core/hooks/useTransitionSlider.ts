// src/core/hooks/useTransitionSlider.ts
// Порт tweb `components/transition.ts` (TransitionSlider) на React — та часть,
// где переход играет ЧИСТЫЙ CSS: `slide-fade`, `fade`, `zoom-fade`, `tabs`
// (в оригинале это ветка без `animationFunction`, transition.ts:313-322).
//
// Механика оригинала (transition.ts:291-333, снятие классов :340-352):
//   уходящий:  `.active` остаётся, добавляется `.from`; по окончании снимаются оба;
//   приходящий: сразу `.active`, затем `.to`; по окончании снимается `.to`;
//   контейнер:  `.animating` на время перехода + `.backwards`, когда новый индекс
//               МЕНЬШЕ предыдущего (`toRight = prevId < id`, :307-308).
// Правила для этих классов уже портированы (`styles/tweb/_transition.scss`):
// `.transition > .transition-item:not(.active)` скрыт, а `.from`/`.to` внутри
// `.animating` играют кейфреймы.
//
// Ветка `animationFunction` (навигация слайдера с JS-transform и brightness)
// сюда НЕ портирована: ею владеет `core/dom/navigationTransition.ts`, у неё
// другой контракт (императивный, с inline-стилями на узлах).
import { useEffect, useRef, useState } from 'react'
import liteMode from '@helpers/liteMode'

/** tweb TRANSITION_TIME (transition.ts:146) — совпадает с длительностью кейфреймов. */
export const TRANSITION_TIME = 400

export interface TransitionSlider {
  /** классы контейнера поверх собственных (`transition slide-fade` и т.п.) */
  containerClass: string
  /** классы i-го `.transition-item` */
  itemClass: (index: number) => string
}

export function useTransitionSlider(active: number, duration = TRANSITION_TIME): TransitionSlider {
  // prev — предыдущий активный индекс, живой ТОЛЬКО во время перехода
  // (`from` в оригинале). -1 = перехода нет.
  const [phase, setPhase] = useState<{ prev: number; backwards: boolean } | null>(null)
  const appliedRef = useRef(active)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const prev = appliedRef.current
    if (prev === active) return
    appliedRef.current = active
    // tweb: `animateFirst: false` — первая раскладка без анимации; у нас роль
    // «первой» играет монтирование (эффект не сработает: prev === active).
    if (!liteMode.isAvailable('animations')) return
    setPhase({ prev, backwards: active < prev })
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setPhase(null), duration)
    return () => window.clearTimeout(timerRef.current)
  }, [active, duration])

  return {
    containerClass: phase ? (phase.backwards ? 'animating backwards' : 'animating') : '',
    itemClass: (index: number) => {
      if (!phase) return index === active ? 'active' : ''
      if (index === active) return 'active to'
      if (index === phase.prev) return 'active from'
      return ''
    },
  }
}
