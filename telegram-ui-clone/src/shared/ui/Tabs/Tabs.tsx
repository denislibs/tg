// Tabs — переиспользуемый горизонтальный таб-ряд, порт tweb .menu-horizontal
// (_slider.scss + horizontalMenu.ts). Активный таб подсвечивается собственным
// фоном (-background); при переключении фон нового таба «переезжает» из позиции
// и ширины предыдущего за var(--tabs-transition) (приём Jolly Cobra).
//
// Compound API:
//   <Tabs value={v} onChange={setV} order={['a','b','c']}>
//     <Tabs.List framed>
//       <Tabs.Tab value="a" badge={3}>Label A</Tabs.Tab> …
//     </Tabs.List>
//   </Tabs>
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import classNames from '../../lib/classNames'
import s from './Tabs.module.scss'

export type TabValue = string | number

interface TabsCtx {
  value: TabValue
  select: (v: TabValue) => void
  items: React.MutableRefObject<Map<TabValue, HTMLDivElement>>
  bgs: React.MutableRefObject<Map<TabValue, HTMLDivElement>>
}

const Ctx = createContext<TabsCtx | null>(null)
function useTabs(): TabsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('Tabs.* must be rendered inside <Tabs>')
  return c
}

export function Tabs({
  value,
  onChange,
  children,
}: {
  value: TabValue
  onChange: (v: TabValue) => void
  /** значения табов в порядке отображения (зарезервировано для слайда контента) */
  order?: TabValue[]
  children: ReactNode
}) {
  const items = useRef(new Map<TabValue, HTMLDivElement>())
  const bgs = useRef(new Map<TabValue, HTMLDivElement>())
  const ctx = useMemo<TabsCtx>(
    () => ({ value, select: onChange, items, bgs }),
    [value, onChange],
  )
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

// Ряд табов (tweb .menu-horizontal-div). `framed` оборачивает в карточку-скролл
// (tweb .menu-horizontal-scrollable: surface-фон, скруглённый, с тенью).
function List({ children, framed }: { children: ReactNode; framed?: boolean }) {
  const { value, items, bgs } = useTabs()
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevRef = useRef<TabValue | null>(null)

  // На смену активного: «переезд» фона из предыдущего таба + центрирование в скролле.
  useLayoutEffect(() => {
    const activeItem = items.current.get(value)
    const activeBg = bgs.current.get(value)
    const prevV = prevRef.current

    // держать активный таб в зоне видимости (tweb fastSmoothScroll position:center)
    const c = scrollRef.current
    if (activeItem && c && c.scrollWidth > c.clientWidth) {
      c.scrollTo({
        left: Math.max(0, activeItem.offsetLeft - (c.clientWidth - activeItem.offsetWidth) / 2),
        behavior: prevV == null ? 'auto' : 'smooth',
      })
    }

    // приём Jolly Cobra из horizontalMenu.ts: фон нового таба стартует из геометрии
    // предыдущего и анимированно встаёт на место.
    if (prevV != null && prevV !== value && activeItem && activeBg) {
      const prevItem = items.current.get(prevV)
      const prevBg = bgs.current.get(prevV)
      if (prevItem && prevBg) {
        prevBg.classList.remove(s.animate)
        activeBg.classList.remove(s.animate)
        const shiftLeft = prevItem.offsetLeft - activeItem.offsetLeft
        const width = activeBg.clientWidth
        const scaleFactor = prevBg.clientWidth / width
        activeBg.style.transform = `translate3d(${shiftLeft}px, 0, 0)`
        activeBg.style.width = `${width * scaleFactor}px`
        requestAnimationFrame(() => {
          activeBg.classList.add(s.animate)
          activeBg.style.transform = 'none'
          activeBg.style.width = ''
        })
      }
    }
    prevRef.current = value
  }, [value, items, bgs])

  const row = (
    <div ref={scrollRef} className={s.scrollableX}>
      <div className={s.div}>{children}</div>
    </div>
  )
  if (!framed) return row
  return <div className={s.scrollable}>{row}</div>
}

function Tab({ value, children, badge }: { value: TabValue; children: ReactNode; badge?: number }) {
  const { value: active, select, items, bgs } = useTabs()
  const isActive = active === value
  return (
    <div
      ref={(el) => {
        if (el) items.current.set(value, el)
        else items.current.delete(value)
      }}
      onClick={() => select(value)}
      className={classNames(s.item, isActive ? s.active : '')}
    >
      <span className={s.span}>
        {children}
        {badge != null && badge > 0 && <span className={s.badge}>{badge > 99 ? '99+' : badge}</span>}
      </span>
      <div
        ref={(el) => {
          if (el) bgs.current.set(value, el)
          else bgs.current.delete(value)
        }}
        className={s.background}
      />
    </div>
  )
}

Tabs.List = List
Tabs.Tab = Tab
