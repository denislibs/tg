// Тема приложения: синхронизация data-theme на <html> (токены CSS-vars из
// styles/_tokens.scss резолвятся от него) + переключатель светлая/тёмная с
// круговым раскрытием из точки клика (View Transitions API, как tweb). Фолбэк —
// мгновенная смена при отсутствии API / reduced-motion / без координат.
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from '../../theme'
import { useSettings } from '../../settings'
import type { ToggleMode } from '../../App'

export function useThemeToggle(): ToggleMode {
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)

  // data-theme до paint (без FOUC).
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preset
  }, [preset])

  const apply = (next: ThemeChoice) => update({ themeChoice: next })

  return (coords) => {
    const next: ThemeChoice = PRESET_MODE[preset] === 'dark' ? 'classic' : 'night'
    const start = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } })
      .startViewTransition
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!start || !coords || reduce) {
      apply(next)
      return
    }
    const { x, y } = coords
    const transition = start.call(document, () => flushSync(() => apply(next)))
    transition.ready.then(() => {
      const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }
}
