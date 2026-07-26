// Reusable bubble/content animation primitives (framer-motion), mirroring the
// opacity timings used by tweb's chat bubbles. These are standalone — not wired
// into any bubble yet; drop them in where needed.
//
//   FadeIn                 opacity 0 → 1                (.2s linear)
//   FadeOut                opacity 1 → 0                (.2s linear)
//   FadeInBackwards        opacity 1 → 0                (.2s linear)  // tweb's misnamed pair
//   FadeOutBackwards       opacity 0 → 1                (.2s linear)
//   Flash                  opacity 0 → 1(10%) → 1(50%) → 0  (transient flash/toast)
//   BubbleHighlight        accent overlay flash 0 → 1(25%) → 0  (2s, "jump-to" highlight)

import { motion, type Transition, type HTMLMotionProps } from 'framer-motion'
import { useState, type CSSProperties, type ReactNode } from 'react'
import s from './bubbleAnimations.module.scss'

const FADE_DUR = 0.2
const LINEAR = 'linear' as const
// tweb's --transition-standard-easing / -in-time.
const STD_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const APPEAR_DUR = 0.3

interface FadeProps {
  children?: ReactNode
  /** seconds (default .2) */
  duration?: number
  /** delay before starting, seconds */
  delay?: number
  style?: CSSProperties
  className?: string
  onComplete?: () => void
}

function makeFade(from: number, to: number) {
  return function Fade({ children, duration = FADE_DUR, delay = 0, style, className, onComplete }: FadeProps) {
    const transition: Transition = { duration, delay, ease: LINEAR }
    return (
      <motion.div
        initial={{ opacity: from }}
        animate={{ opacity: to }}
        transition={transition}
        onAnimationComplete={onComplete}
        style={style}
        className={className}
      >
        {children}
      </motion.div>
    )
  }
}

// fade-in-opacity
export const FadeIn = makeFade(0, 1)
// fade-out-opacity
export const FadeOut = makeFade(1, 0)
// fade-in-backwards-opacity (tweb: 1 → 0)
export const FadeInBackwards = makeFade(1, 0)
// fade-out-backwards-opacity (tweb: 0 → 1)
export const FadeOutBackwards = makeFade(0, 1)

// fade-in-opacity-fade-out-opacity — a transient flash (e.g. a toast/badge).
export function Flash({
  children,
  duration = 3,
  delay = 0,
  style,
  className,
  onComplete,
}: FadeProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration, delay, ease: LINEAR, times: [0, 0.1, 0.5, 1] }}
      onAnimationComplete={onComplete}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// BubbleAppear — tweb's "ladder" appear for a NEW message: the bubble grows
// from scale .8 + opacity 0 to scale 1 + opacity 1 over .3s (standard easing).
//
// IMPORTANT — keep this ALWAYS mounted per row and toggle `appear`, do NOT
// conditionally wrap only new rows. Two reasons learned the hard way:
//   • Mounting/unmounting the wrapper changes the element type at a stable key
//     → React remounts the bubble (churn, lost media state).
//   • `animate`/`transition` are CONSTANT; only `initial` reacts to `appear`
//     (framer reads `initial` once, at mount). So a re-render that flips
//     `appear` to false mid-flight (e.g. a read-receipt update) can't strip the
//     animate target and cancel the running appear — it just finishes.
// `appear=false` ⇒ initial=false ⇒ the row snaps straight to its resting state
// (used for live appends, which must not animate). `delay` staggers a batch into
// a ladder (tweb's animateAsLadder uses ~40ms steps).
//
// The appear is a ONE-SHOT: `appear`/`delay` are snapshotted at mount (useState
// initializer) so later re-renders (read receipts, typing, …) can't disturb the
// in-flight animation. Extra props (onContextMenu, etc.) and `style` are
// forwarded to the motion.div so the wrapper can BE the row (flex container).
export function BubbleAppear({
  children,
  appear = true,
  delay = 0,
  duration = APPEAR_DUR,
  style,
  className,
  onComplete,
  ...rest
}: {
  children?: ReactNode
  /** true ⇒ grow in on mount; false ⇒ render statically (no animation) */
  appear?: boolean
  /** stagger delay (s) for a ladder; only meaningful when appear is true */
  delay?: number
  duration?: number
  style?: CSSProperties
  className?: string
  onComplete?: () => void
} & Omit<HTMLMotionProps<'div'>, 'children' | 'style' | 'className' | 'initial' | 'animate' | 'transition'>) {
  // Freeze the mount-time appear/delay so re-renders never restart/cancel it.
  const [mount] = useState(() => ({ appear, delay }))
  return (
    <motion.div
      initial={mount.appear ? { scale: 0.8, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration, ease: STD_EASE, delay: mount.delay }}
      onAnimationComplete={onComplete}
      style={style}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

// bubbleSelected — an accent highlight that flashes over a bubble when it's
// jumped-to/focused. Render inside a `position: relative` bubble; it fills the
// parent and flashes opacity 0 → 1(25%) → 0 over 2s, then is gone.
export function BubbleHighlight({
  color = 'var(--mui-accent, rgba(136,116,225,0.35))',
  borderRadius = 15,
  duration = 2,
  onComplete,
}: {
  color?: string
  borderRadius?: number | string
  duration?: number
  onComplete?: () => void
}) {
  return (
    <motion.div
      aria-hidden
      className={s.highlight}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration, ease: LINEAR, times: [0, 0.25, 1] }}
      onAnimationComplete={onComplete}
      style={{ borderRadius, background: color }}
    />
  )
}
