// A single reusable horizontal tabs component, ported 1:1 from tweb's
// `horizontalMenu` (.menu-horizontal-div + .tabs-container):
//
//   • a 48px strip of text tabs; the active one is highlighted by a rounded
//     pill (radius 20px) that SLIDES + width-morphs between tabs over
//     0.2s ease-in-out (tweb's .menu-horizontal-div-item-background animation,
//     reduced to a single measured pill — same visual result);
//   • the content panels slide translateX(±100%)→0 over 0.2s ease-in-out,
//     direction-aware (forward = new from the right, back = from the left),
//     exactly tweb's .tabs-container[data-animation="tabs"].
//
// Compound API:
//   <Tabs value={v} onChange={setV} order={['a','b','c']}>
//     <Tabs.List>
//       <Tabs.Tab value="a">Label A</Tabs.Tab> …
//     </Tabs.List>
//     <Tabs.Panels>                         {/* optional */}
//       <Tabs.Panel value="a">…</Tabs.Panel> …
//     </Tabs.Panels>
//   </Tabs>

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Box, useTheme } from '@mui/material'
import { withAlpha } from '../core/cssColor'
import { AnimatePresence, motion } from 'framer-motion'

export type TabValue = string | number

interface TabsCtx {
  value: TabValue
  dir: number // +1 forward / -1 back, for the content slide direction
  select: (v: TabValue) => void
  setItemEl: (v: TabValue, el: HTMLDivElement | null) => void
  itemsRef: React.MutableRefObject<Map<TabValue, HTMLDivElement>>
}

const Ctx = createContext<TabsCtx | null>(null)
function useTabs(): TabsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('Tabs.* must be rendered inside <Tabs>')
  return c
}

// tweb tab-transition: 0.2s ease-in-out.
const TAB_EASE: [number, number, number, number] = [0.42, 0, 0.58, 1]
const TAB_DUR = 0.2

export function Tabs({
  value,
  onChange,
  order,
  children,
}: {
  value: TabValue
  onChange: (v: TabValue) => void
  /** the tab values in display order — used for the slide direction */
  order: TabValue[]
  children: ReactNode
}) {
  const prev = useRef(value)
  const dir = order.indexOf(value) >= order.indexOf(prev.current) ? 1 : -1
  useLayoutEffect(() => {
    prev.current = value
  }, [value])

  const itemsRef = useRef(new Map<TabValue, HTMLDivElement>())
  const setItemEl = useCallback((v: TabValue, el: HTMLDivElement | null) => {
    if (el) itemsRef.current.set(v, el)
    else itemsRef.current.delete(v)
  }, [])

  const ctx = useMemo<TabsCtx>(
    () => ({ value, dir, select: onChange, setItemEl, itemsRef }),
    [value, dir, onChange, setItemEl],
  )
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

// The tab strip with the morphing pill (tweb .menu-horizontal-div).
// `framed` wraps it in a rounded elevated "card" track (tweb's folder/search
// filters look — image: «Все / друзья»).
function List({ children, framed }: { children: ReactNode; framed?: boolean }) {
  const { value, itemsRef } = useTabs()
  const theme = useTheme()
  const tg = theme.tg
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  // Measure the active tab → move/resize the pill (transition does the morph),
  // and scroll the active tab into view (tweb keeps the active tab visible). A
  // ResizeObserver re-measures when any tab's width changes (e.g. an unread
  // badge appears/disappears) so the pill always fits the active tab.
  useLayoutEffect(() => {
    const measure = () => {
      const el = itemsRef.current.get(value)
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    const el = itemsRef.current.get(value)
    const c = scrollRef.current
    if (el && c) {
      c.scrollTo({ left: Math.max(0, el.offsetLeft - (c.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' })
    }
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    itemsRef.current.forEach((tab) => ro.observe(tab))
    return () => ro.disconnect()
  }, [value, itemsRef, Children.count(children)])

  const strip = (
    <Box
      ref={scrollRef}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        height: 48,
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {pill && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: '50%',
            left: 0,
            height: 40,
            width: pill.width,
            transform: `translate(${pill.left}px, -50%)`,
            borderRadius: '24px',
            background: withAlpha(tg.accent, 0.12),
            transition: `transform ${TAB_DUR}s ease-in-out, width ${TAB_DUR}s ease-in-out`,
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      )}
      {children}
    </Box>
  )

  if (!framed) return strip
  return (
    <Box
      sx={{
        flexShrink: 0,
        mx: 1.25,
        my: 0.75,
        p: '0px',
        borderRadius: '24px',
        background: tg.sidebarBg,
        boxShadow: '0 1px 8px rgba(0,0,0,0.1)',
      }}
    >
      {strip}
    </Box>
  )
}

function Tab({ value, children, badge }: { value: TabValue; children: ReactNode; badge?: number }) {
  const { value: active, select, setItemEl } = useTabs()
  const tg = useTheme().tg
  const isActive = active === value
  return (
    <Box
      ref={(el: HTMLDivElement | null) => setItemEl(value, el)}
      onClick={() => select(value)}
      sx={{
        position: 'relative',
        zIndex: 1,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 2, // tweb 0 1rem
        mx: 0.5, // tweb 0 .25rem
        cursor: 'pointer',
        fontSize: 16,
        fontWeight: isActive ? 600 : 500,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        color: isActive ? tg.accent : tg.textSecondary,
        transition: `color ${TAB_DUR}s ease-in-out`,
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <Box
          sx={{
            minWidth: 18,
            height: 18,
            px: '5px',
            borderRadius: '9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            color: '#fff',
            background: isActive ? tg.accent : tg.textFaint,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </Box>
      )}
    </Box>
  )
}

// Sliding content area (tweb .tabs-container[data-animation="tabs"]).
function Panels({ children }: { children: ReactNode }) {
  const { value, dir } = useTabs()
  const panels = Children.toArray(children).filter(isValidElement) as ReactElement<{ value: TabValue; children: ReactNode }>[]
  const active = panels.find((p) => p.props.value === value)
  return (
    <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <AnimatePresence custom={dir} initial={false} mode="popLayout">
        <Box
          key={String(value)}
          component={motion.div}
          custom={dir}
          variants={{
            enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
            center: { x: '0%' },
            exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: TAB_DUR, ease: TAB_EASE }}
          sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          {active?.props.children}
        </Box>
      </AnimatePresence>
    </Box>
  )
}

// Data-holder; Panels reads its `value`/`children` props (never rendered directly).
function Panel(_props: { value: TabValue; children: ReactNode }) {
  return null
}

Tabs.List = List
Tabs.Tab = Tab
Tabs.Panels = Panels
Tabs.Panel = Panel
