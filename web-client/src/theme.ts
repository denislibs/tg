// Тема управляется атрибутом `data-theme` на <html> (см. core/theme/themeController.ts
// + styles/_tokens.scss); значения токенов — CSS-переменные `--tg-*`/tweb-семантика,
// JS их не хранит. Здесь остаются только типы выбора темы и утилита разрешения
// 'system' → пресет. `ThemePreset` согласован с `ThemePresetName` из
// config/themePresets.ts — это тот же union (см. реэкспорт там), один источник истины.
export type { ThemePresetName as ThemePreset } from './config/themePresets'
import type { ThemePresetName } from './config/themePresets'

export type Mode = 'light' | 'dark'

// Named colour themes shown in General Settings. 'system' follows the OS and
// resolves to 'day' (light) or 'night' (dark) at runtime.
export type ThemeChoice = ThemePresetName | 'system'

export const PRESET_MODE: Record<ThemePresetName, Mode> = {
  day: 'light',
  light: 'light',
  night: 'dark',
  tinted: 'dark',
}

// Resolve a user's theme choice ('system' → OS preference) to a concrete preset.
export function resolvePreset(choice: ThemeChoice): ThemePresetName {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day'
}
