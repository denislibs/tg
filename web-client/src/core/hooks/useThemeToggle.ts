// Тема приложения: синхронизация data-theme на <html> через themeController
// (инжект tweb-семантических CSS-переменных + класс .night) + переключатель светлая/тёмная с
// круговым раскрытием из точки клика (View Transitions API, как tweb). Фолбэк —
// мгновенная смена при отсутствии API / reduced-motion / без координат.
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from '../../theme'
import { setTheme } from '../theme/themeController'
import { dispatchHeavyAnimationEvent } from '../dom/heavyAnimation'
import { useSettings } from '../../settings'
import type { ToggleMode } from '../../App'

export function useThemeToggle(): ToggleMode {
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)

  // Инжект токенов + data-theme до paint (без FOUC).
  useLayoutEffect(() => {
    setTheme(preset)
  }, [preset])

  const apply = (next: ThemeChoice) => update({ themeChoice: next })

  return (coords) => {
    const next: ThemeChoice = PRESET_MODE[preset] === 'dark' ? 'day' : 'night'
    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> }
    }).startViewTransition
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!start || !coords || reduce) {
      apply(next)
      return
    }
    const { x, y } = coords
    const transition = start.call(document, () => flushSync(() => apply(next)))
    // tweb themeController.ts:396 (THEME_TRANSITION_TIMEOUT = 2000): пока играет
    // круговое раскрытие, тяжёлый рендер (стикеры/видео/lottie) стоит на паузе.
    // `.catch` — чтобы реджект `finished` не заклинил паузу до истечения таймаута.
    void dispatchHeavyAnimationEvent(transition.finished.catch(() => {}), 2000)
    transition.ready.then(() => {
      const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }
}
