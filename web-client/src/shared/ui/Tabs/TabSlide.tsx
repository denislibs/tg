// TabSlide — горизонтальный слайд контента при переключении табов (tweb
// TransitionSlider 'tabs': новый экран въезжает с ±100%, старый уезжает в
// противоположную сторону). Направление считается по позиции таба в `order`.
// Родитель должен резать горизонтальный overflow (overflow-x: hidden).
import { useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../../../motion'
import type { TabValue } from './Tabs'

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
  // таб правее прежнего → контент едет влево (въезд с +100%), и наоборот
  const prevRef = useRef(tab)
  const dirRef = useRef(1)
  if (prevRef.current !== tab) {
    dirRef.current = order.indexOf(tab) >= order.indexOf(prevRef.current) ? 1 : -1
    prevRef.current = tab
  }
  const dir = dirRef.current

  return (
    <AnimatePresence mode="popLayout" custom={dir} initial={false}>
      <motion.div
        key={String(tab)}
        className={className}
        custom={dir}
        variants={{
          enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
          center: { x: '0%' },
          exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: DUR.in, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
