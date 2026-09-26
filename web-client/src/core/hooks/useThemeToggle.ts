// Тема приложения: синхронизация data-theme на <html> через themeController
// (инжект tweb-семантических CSS-переменных + класс .night) + переключатель светлая/тёмная с
// круговым раскрытием из точки клика (`core/theme/themeTransition.ts`, порт tweb).
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from '../../theme'
import { setTheme } from '../theme/themeController'
import { switchThemeWithTransition } from '../theme/themeTransition'
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

  // Круговое раскрытие — общий исполнитель (порт tweb `ThemeController.setTheme`,
  // tweb 7082e1a18 → 091b476a9: круг в процентах бокса снапшота).
  return (coords) => {
    const isNight = PRESET_MODE[preset] === 'dark'
    const next: ThemeChoice = isNight ? 'day' : 'night'
    switchThemeWithTransition(() => flushSync(() => apply(next)), coords, isNight)
  }
}
