// TabSlide — порт tweb TransitionSlider типа 'tabs' (`components/transition.ts:44-93`
// slideTabs + `components/transition.ts:300-323` selectTab) на React.
//
// Механизм tweb 1:1, без JS-анимирования:
//   • контейнер — `.tabs-container[data-animation="tabs"]` (_slider.scss:164-216):
//     CSS-grid, все табы лежат в одной ячейке; `.tabs-tab` скрыт (display: none),
//     показывается классом `.active`; переход — `transform var(--tabs-transition)`;
//   • на переключении оба кадра ЖИВУТ в DOM: уходящему и приходящему выставляются
//     инлайновые transform ∓width, делается reflow, после чего у приходящего
//     transform снимается — он въезжает к 0, а уходящий уезжает наружу;
//   • направление: `toRight = prevId < id` (индекс в `order`), контейнер получает
//     `animating`, а при !toRight ещё и `backwards` (transition.ts:305-307);
//   • уходящий кадр снимается по transitionend, фолбэк-таймер `transitionTime + 100`
//     (transition.ts:349); transitionTime у horizontalMenu — 200мс, как --tabs-transition.
//
// Родитель должен резать горизонтальный overflow (overflow-x: hidden).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import classNames from '../../lib/classNames'
import type { TabValue } from './Tabs'

const TRANSITION_TIME = 200 // tweb horizontalMenu(transitionTime = 200) == var(--tabs-transition)

interface Frame {
  tab: TabValue
  node: ReactNode
}

export default function TabSlide({
  tab,
  order,
  className,
  children,
}: {
  tab: TabValue
  /** значения табов в порядке отображения — по нему считается направление */
  order: readonly TabValue[]
  className?: string
  children: ReactNode
}) {
  const els = useRef(new Map<TabValue, HTMLDivElement>())
  // последний отрисованный кадр: из него берётся уходящий контент (роль
  // AnimatePresence — держать старый узел в DOM, пока играет слайд)
  const lastRef = useRef<Frame>({ tab, node: children })
  const [exiting, setExiting] = useState<Frame | null>(null)
  const backwardsRef = useRef(false)

  if (lastRef.current.tab !== tab) {
    // tweb: toRight = prevId < id; при !toRight контейнер получает `backwards`
    backwardsRef.current = order.indexOf(tab) < order.indexOf(lastRef.current.tab)
    setExiting(lastRef.current) // правка состояния во время рендера — React перерисует сразу
  }
  lastRef.current = { tab, node: children }

  const exitingTab = exiting?.tab
  useLayoutEffect(() => {
    if (exitingTab === undefined) return
    const to = els.current.get(tab)
    const from = els.current.get(exitingTab)
    if (!to || !from) return

    // slideTabs (transition.ts:56-70): ширина берётся у уходящего кадра, оба
    // получают стартовые transform, reflow фиксирует их, затем приходящий едет к 0.
    const width = from.getBoundingClientRect().width
    const [left, right] = backwardsRef.current ? [to, from] : [from, to]
    left.style.transform = `translate3d(${-width}px, 0, 0)`
    right.style.transform = `translate3d(${width}px, 0, 0)`
    void to.offsetWidth // reflow
    to.style.transform = ''

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== from) return
      setExiting((cur) => (cur?.tab === exitingTab ? null : cur))
    }
    from.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(() => {
      setExiting((cur) => (cur?.tab === exitingTab ? null : cur))
    }, TRANSITION_TIME + 100)
    return () => {
      window.clearTimeout(timer)
      from.removeEventListener('transitionend', onEnd)
    }
  }, [exitingTab, tab])

  // Оба кадра — одним массивом с ключами: так React сохраняет DOM-узел уходящего
  // таба (иначе он пересоздался бы и слайд начался бы с пустого места).
  const frames: Frame[] = exiting ? [exiting, { tab, node: children }] : [{ tab, node: children }]

  return (
    <div
      className={classNames(
        'tabs-container',
        exiting ? 'animating' : '',
        exiting && backwardsRef.current ? 'backwards' : '',
      )}
      data-animation="tabs"
    >
      {frames.map((f) => (
        <div
          key={String(f.tab)}
          ref={(el) => {
            if (el) els.current.set(f.tab, el)
            else els.current.delete(f.tab)
          }}
          className={classNames('tabs-tab', 'active', className ?? '')}
        >
          {f.node}
        </div>
      ))}
    </div>
  )
}
