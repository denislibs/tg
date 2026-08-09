// Порт tweb `src/components/sidebarLeft/pendingSuggestion.tsx` — каркас плашек
// подсказок в левой колонке: выбирает вариант по приоритету, оборачивает его в
// `.suggestionContainer` и показывает/прячет анимацией grow-height.
//
// Место в разметке — как в tweb (appDialogsManager.ts:1079-1082): контейнер
// препендится в `.chatlist-overlay`, то есть встаёт НАД табами папок и внутри
// того же абсолютного оверлея. Высоту оверлея меряет ResizeObserver и кладёт в
// `--chatlist-overlay-height`, которую `.folders-scrollable` читает как
// `padding-top` (styles/tweb/_leftSidebar.scss:418) — поэтому плашка РАЗДВИГАЕТ
// список чатов, а не наезжает на него.
//
// Отступления от tweb:
//   • анимация — тот же WAAPI grow-height (`helpers/solid/animations.tsx:9-21`,
//     keyframes [{height:0,opacity:0},{height:H,opacity:1}], 200мс,
//     cubic-bezier(.4,.0,.2,1)), но выход играется вручную: у React нет
//     Solid'ового AnimationList, который держит узел до конца анимации;
//   • `body.has-pending-suggestion` ставится по выбранному типу, а не по
//     созданному элементу — результат тот же.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import useNotificationsSuggestion from './notificationsSuggestion'
import selectPendingSuggestion, { type PendingSuggestionType } from './selectPendingSuggestion'
import type { PendingSuggestionController } from './pendingSuggestionController'
import s from './pendingSuggestion.module.scss'

// tweb helpers/solid/animations.tsx:9-15 + SimpleAnimation (duration 200,
// easing из getTransition('standard')).
const DURATION = 200
const EASING = 'cubic-bezier(.4, .0, .2, 1)'
const growKeyframes = (height: number): Keyframe[] => [
  { height: '0px', opacity: 0 },
  { height: height + 'px', opacity: 1 },
]

export default function PendingSuggestion({ collapsed }: { collapsed?: boolean }) {
  const suggestions: Record<PendingSuggestionType, PendingSuggestionController> = {
    notifications: useNotificationsSuggestion(),
  }

  const type = selectPendingSuggestion({ notifications: suggestions.notifications.available })

  // Тип, который сейчас в DOM: при уходе держим прошлый, пока играет анимация.
  const [rendered, setRendered] = useState<PendingSuggestionType | undefined>(type)
  // undefined на старте — чтобы первая отрисовка тоже проигралась (tweb `appear`).
  const shownRef = useRef<PendingSuggestionType | undefined>(undefined)
  const boxRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<Animation | null>(null)

  if (type && rendered !== type) setRendered(type)

  useEffect(() => {
    document.body.classList.toggle('has-pending-suggestion', !!type)
  }, [type])

  useLayoutEffect(() => {
    if (shownRef.current === type) return
    const appearing = !shownRef.current && !!type
    const leaving = !!shownRef.current && !type
    shownRef.current = type
    const el = boxRef.current
    if (!el || (!appearing && !leaving)) return

    animRef.current?.cancel()
    const frames = growKeyframes(el.offsetHeight)
    const anim = el.animate(leaving ? frames.slice().reverse() : frames, {
      duration: DURATION,
      easing: EASING,
    })
    animRef.current = anim
    if (leaving) {
      anim.onfinish = () => {
        animRef.current = null
        setRendered(undefined)
      }
    }
  }, [type])

  useEffect(() => () => { animRef.current?.cancel() }, [])

  if (!rendered) return null
  const Suggestion = suggestions[rendered].component
  return (
    <div ref={boxRef} className={s.suggestionContainer}>
      <Suggestion collapsed={collapsed} />
    </div>
  )
}
