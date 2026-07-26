import type { Transition, Variants } from 'framer-motion'

/**
 * Central motion config — single source of truth for every transition in the app.
 * Values mirror Telegram Web K (tweb): the Material standard easing
 * `cubic-bezier(.4, 0, .2, 1)` with 300ms "in" / 250ms "out", so screen slides,
 * menus and fades all feel uniform. Tweak here to change motion everywhere.
 */

// Easings
export const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1] // tweb --transition-standard-easing
export const EASE_OVERSHOOT: [number, number, number, number] = [0.34, 1.56, 0.64, 1] // tweb --btn-corner-transition

// Durations (seconds)
export const DUR = { in: 0.3, out: 0.25, fast: 0.2 } as const

// Ready-made transition objects
export const tIn: Transition = { duration: DUR.in, ease: EASE }
export const tOut: Transition = { duration: DUR.out, ease: EASE }
export const tFast: Transition = { duration: DUR.fast, ease: EASE }
export const tOvershoot: Transition = { duration: DUR.fast, ease: EASE_OVERSHOOT }

/**
 * Full-height screen sliding in from the right
 * (Settings, New Group/Channel, New Private Chat, Edit, …).
 * Usage: <motion.div variants={slideInRight} initial="initial" animate="animate" exit="exit" />
 */
export const slideInRight: Variants = {
  initial: { x: '100%' },
  animate: { x: '0%', transition: tIn },
  exit: { x: '100%', transition: tOut },
}

/** Generic crossfade. */
export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: tIn },
  exit: { opacity: 0, transition: tOut },
}

/** Menu / popover pop (scale + opacity); set transform-origin via style/sx. */
export const menuPop: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1, transition: tFast },
  exit: { opacity: 0, scale: 0.92, transition: { duration: 0.15, ease: EASE } },
}
