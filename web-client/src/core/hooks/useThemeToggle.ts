// Тема приложения: синхронизация data-theme на <html> через themeController
// (инжект tweb-семантических CSS-переменных + класс .night) + переключатель светлая/тёмная с
// круговым раскрытием из точки клика (`core/theme/themeTransition.ts`, порт tweb).
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from '../../theme'
import { getCurrentPreset, setTheme } from '../theme/themeController'
import { switchThemeWithTransition } from '../theme/themeTransition'
import { useSettings } from '../../settings'
type ToggleMode = (coords?: { x: number; y: number }) => void

export function useThemeToggle(): ToggleMode {
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)

  // Инжект токенов + data-theme до paint (без FOUC). В зависимостях и сам
  // выбор: за системной темой при «как в системе» следит `setThemeListener`
  // (`client/boot.ts`) мимо React, и `preset` этого рендера может быть старым —
  // смена выбора на ту же по имени тему иначе не применилась бы.
  useLayoutEffect(() => {
    setTheme(preset)
  }, [preset, themeChoice])

  const apply = (next: ThemeChoice) => update({ themeChoice: next })

  // Круговое раскрытие — общий исполнитель (порт tweb `ThemeController.setTheme`,
  // tweb 7082e1a18 → 091b476a9: круг в процентах бокса снапшота).
  return (coords) => {
    // Применённая тема, а не тема рендера: системную мог сменить слушатель.
    const isNight = PRESET_MODE[getCurrentPreset() ?? preset] === 'dark'
    const next: ThemeChoice = isNight ? 'day' : 'night'
    switchThemeWithTransition(() => flushSync(() => apply(next)), coords, isNight)
  }
}
