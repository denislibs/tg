// GrowHeightReveal — порт tweb `helpers/solid/animations.tsx: GrowHeightReveal`.
//
//   <Animated type="grow-height" noItemClass mode="add-remove" appear>
//     <Show when={...}><div style={{overflow:'hidden'}}>{children}</div></Show>
//   </Animated>
//
// Обёртка `div[style="overflow:hidden"]` ОСТАЁТСЯ в DOM после раскрытия (её
// видно в живом дереве экрана входа) — `overflow: hidden` делает её блочным
// контекстом форматирования, поэтому `clientHeight` равен полной высоте
// содержимого вместе с его отрицательными марджинами; именно это значение и
// анимируется от нуля.
//
// Кейфреймы и тайминги 1:1: `growKeyframes('height', clientHeight)` =
// [{height: 0, opacity: 0}, {height: Npx, opacity: 1}], duration 200,
// easing — `getTransition('standard')`.
import { useEffect, useRef, useState, type ReactNode } from 'react'

const DURATION = 200
// tweb config/transitions.ts: standard → cubic-bezier(.4, 0, .2, 1)
const EASING = 'cubic-bezier(.4, 0, .2, 1)'

export default function GrowHeightReveal({
  when,
  appear = true,
  className,
  children,
}: {
  when: boolean
  /** не проигрывать раскрытие на первом кадре (tweb `appear`) */
  appear?: boolean
  /** класс на самой обёртке — для содержимого, вылезающего за родителя */
  className?: string
  children: ReactNode
}) {
  // `mode="add-remove"`: узел живёт в DOM, пока не доиграет схлопывание.
  const [mounted, setMounted] = useState(when)
  const ref = useRef<HTMLDivElement>(null)
  // null — ещё ни одного прогона эффекта (первый кадр)
  const prev = useRef<boolean | null>(null)

  if (when && !mounted) setMounted(true)

  useEffect(() => {
    const wasFirst = prev.current === null
    const was = prev.current
    prev.current = when
    const el = ref.current

    if (when) {
      if (!el || (wasFirst && !appear) || was === true) return
      el.animate(
        [
          { height: '0px', opacity: 0 },
          { height: `${el.clientHeight}px`, opacity: 1 },
        ],
        { duration: DURATION, easing: EASING },
      )
      return
    }

    if (wasFirst || was === false || !mounted) return
    if (!el) {
      setMounted(false)
      return
    }
    let cancelled = false
    const anim = el.animate(
      [
        { height: `${el.clientHeight}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: DURATION, easing: EASING },
    )
    void anim.finished.then(
      () => {
        if (!cancelled) setMounted(false)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [when, appear, mounted])

  if (!mounted) return null
  return (
    <div ref={ref} className={className} style={{ overflow: 'hidden' }}>
      {children}
    </div>
  )
}
