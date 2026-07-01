// Тема управляется атрибутом `data-theme` на <html> (см. styles/_tokens.scss +
// App.tsx); значения токенов — CSS-переменные `--tg-*`, JS их не хранит. Здесь
// остаются только типы выбора темы и утилита разрешения 'system' → пресет.

export type Mode = 'light' | 'dark'

// Named colour themes shown in General Settings. 'system' follows the OS and
// resolves to 'classic' (light) or 'night' (dark) at runtime.
export type ThemePreset = 'classic' | 'day' | 'night' | 'dark'
export type ThemeChoice = ThemePreset | 'system'

export const PRESET_MODE: Record<ThemePreset, Mode> = {
  classic: 'light',
  day: 'light',
  night: 'dark',
  dark: 'dark',
}

// Resolve a user's theme choice ('system' → OS preference) to a concrete preset.
export function resolvePreset(choice: ThemeChoice): ThemePreset {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'classic'
}
