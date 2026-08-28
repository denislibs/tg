// Порт 1:1 из tweb `src/helpers/themeController.ts` (appColorMap, ~строки 40-120)
// и `colorMap` (константа этого же файла, ~строки 108-190) — базовые hex-значения
// токенов для 4 встроенных тем (day/night/light/tinted). `presetToColorMap`
// добавляет 'message-out-background-color' — единственный ключ AppColorName,
// у которого в tweb НЕТ статического литерала в `colorMap`: там он всегда
// вычисляется динамически в `applyTheme` (themeController.ts ~740-885) через
// mixColors(messageOutPrimary, surface, alpha) + saturation-boost для non-night.
// Источник истины: /Users/denisurevic/Documents/tweb/src/helpers/themeController.ts.

import { hexToRgb, mixColors, rgbaToHexa, rgbaToHsla, hslaToRgba } from '../shared/lib/color'

export type AppColorName =
  | 'primary-color'
  | 'message-out-primary-color'
  | 'surface-color'
  | 'danger-color'
  | 'primary-text-color'
  | 'secondary-text-color'
  | 'message-out-background-color'
  | 'saved-color'
  | 'message-background-color'
  | 'green-color'
  | 'background-color'
  | 'body-background-color'
  | 'border-color'
  | 'secondary-color'
  | 'link-color'
  | 'input-search-background-color'

export type AppColor = {
  rgb?: boolean
  light?: boolean
  lightFilled?: boolean
  dark?: boolean
  darkRgb?: boolean
  darkFilled?: boolean
}

// 1:1 из tweb themeController.ts `appColorMap` — какие производные CSS-переменные
// (--name-rgb / --light-name / --light-filled-name / --dark-name) генерируются
// для каждого токена. Не выдумывать, не досочинять.
export const appColorMap: Record<AppColorName, AppColor> = {
  'primary-color': {
    rgb: true,
    light: true,
    lightFilled: true,
    dark: true,
    darkRgb: true,
  },
  'message-out-primary-color': {
    lightFilled: true,
    rgb: true,
  },
  'surface-color': {
    rgb: true,
  },
  'danger-color': {
    rgb: true,
    light: true,
    dark: true,
  },
  'primary-text-color': {
    rgb: true,
  },
  'secondary-text-color': {
    light: true,
    lightFilled: true,
    rgb: true,
  },
  'message-background-color': {
    light: true,
    lightFilled: true,
    dark: true,
    darkFilled: true,
  },
  'message-out-background-color': {
    light: true,
    lightFilled: true,
    dark: true,
    darkFilled: true,
    rgb: true,
  },
  'saved-color': {
    lightFilled: true,
  },
  'green-color': {
    rgb: true,
  },
  'background-color': {
    rgb: true,
  },
  'body-background-color': {
    rgb: true,
  },
  'border-color': {},
  'secondary-color': {},
  'link-color': {},
  'input-search-background-color': {},
}

export type ThemePresetName = 'day' | 'night' | 'light' | 'tinted'

// Ключи AppColorName без 'message-out-background-color' — тот единственный
// вычисляется отдельно (см. messageOutBackgroundColor ниже), у него нет
// статического литерала в tweb.
type BaseColorMap = Record<Exclude<AppColorName, 'message-out-background-color'>, string>

// 1:1 из tweb themeController.ts `colorMap` — литеральные hex-значения per-theme.
// tinted — статичный фолбэк-набор (без обоев/производного iOS-surface; см. бриф
// Task 2 и themeController.ts applyTheme: для tinted surface/background/border/etc.
// в реальном приложении темы деривируются из акцента через iOS withMultiplied —
// здесь берём статичные базовые значения самой colorMap, как и просит бриф).
const presetColorMap: Record<ThemePresetName, BaseColorMap> = {
  day: {
    'primary-color': '#3390ec',
    'message-out-primary-color': '#5CA853',
    'message-background-color': '#ffffff',
    'surface-color': '#ffffff',
    'danger-color': '#df3f40',
    'primary-text-color': '#000000',
    'secondary-text-color': '#707579',
    'saved-color': '#359AD4',
    'green-color': '#70b768',
    'background-color': '#f4f4f5',
    'body-background-color': '#ffffff',
    'border-color': '#dfe1e5',
    'secondary-color': '#c4c9cc',
    'link-color': '#00488f',
    'input-search-background-color': '#ffffff',
  },
  night: {
    'primary-color': '#8774E1',
    'message-out-primary-color': '#8774E1',
    'message-background-color': '#212121',
    'surface-color': '#212121',
    'danger-color': '#ff595a',
    'primary-text-color': '#ffffff',
    'secondary-text-color': '#aaaaaa',
    'saved-color': '#8774E1',
    'green-color': '#5CC85E',
    'background-color': '#181818',
    'body-background-color': '#181818',
    'border-color': '#0f0f0f',
    'secondary-color': '#707579',
    'link-color': '#8774E1',
    'input-search-background-color': '#181818',
  },
  tinted: {
    'primary-color': '#3685FA',
    'message-out-primary-color': '#3685FA',
    'message-background-color': '#232E3B',
    'surface-color': '#1D2733',
    'danger-color': '#FF595A',
    'primary-text-color': '#FFFFFF',
    'secondary-text-color': '#7D8B99',
    'saved-color': '#3685FA',
    'green-color': '#61D36B',
    'background-color': '#151E27',
    'body-background-color': '#151E27',
    'border-color': '#0F151B',
    'secondary-color': '#7D8B99',
    'link-color': '#5EABE1',
    'input-search-background-color': '#212D3B',
  },
  light: {
    'primary-color': '#2D7ED5',
    'message-out-primary-color': '#2D7ED5',
    'message-background-color': '#F0F0F0',
    'surface-color': '#FFFFFF',
    'danger-color': '#DF3F40',
    'primary-text-color': '#333333',
    'secondary-text-color': '#8C8E91',
    'saved-color': '#2D7ED5',
    'green-color': '#04AC35',
    'background-color': '#F4F4F5',
    'body-background-color': '#FFFFFF',
    'border-color': '#DFE1E5',
    'secondary-color': '#C4C9CC',
    'link-color': '#238AE3',
    'input-search-background-color': '#FFFFFF',
  },
}

// tweb: NIGHT_THEME_NAMES = new Set(['night', 'tinted']) (themeController.ts).
const NIGHT_PRESET_NAMES = new Set<ThemePresetName>(['night', 'tinted'])

// Порт формулы из tweb themeController.ts `applyTheme` (default look — единственный
// message_colors === [message-out-primary-color], поэтому firstColor === baseMessageColor
// и getAccentColor/changeColorAccent не задействуются):
//   messageLightenAlpha = isNight ? 1 : 0.12
//   base = mixColors(hexToRgb(messageOutPrimary), hexToRgb(surface), messageLightenAlpha)
//   if (!isNight) base.s += 63 (saturation boost, clamp 100) — см. themeController.ts ~876-879
function messageOutBackgroundColor(messageOutPrimaryHex: string, surfaceHex: string, isNight: boolean): string {
  const messageLightenAlpha = isNight ? 1 : 0.12
  const base = mixColors(hexToRgb(messageOutPrimaryHex), hexToRgb(surfaceHex), messageLightenAlpha)

  if (isNight) {
    return rgbaToHexa(base)
  }

  const hsla = rgbaToHsla(...base)
  const boostedS = Math.min(hsla.s + 63, 100)
  const boosted = hslaToRgba(hsla.h, boostedS, hsla.l, hsla.a).slice(0, 3)
  return rgbaToHexa(boosted)
}

// Значения 1:1 из tweb `src/config/state.ts:391-395`.
//
// Соответствие имён — tweb `helpers/themeController.ts:191-196`
// (`themeNameToBaseTheme`): day → baseThemeClassic, light → baseThemeDay,
// night → baseThemeNight, tinted → baseThemeTinted. То есть `day` — это
// КЛАССИЧЕСКАЯ (зелёная) тема с оливковой подсветкой, а синее значение
// принадлежит `light`; путать их нельзя.
export const DEFAULT_HIGHLIGHTING_COLORS: Record<ThemePresetName, string> = {
  day: 'hsla(86.4, 43.846153%, 45.117647%, .4)',
  light: 'hsla(210, 67.741935%, 50.588235%, .4)',
  night: 'hsla(299.142857, 44.166666%, 37.470588%, .4)',
  tinted: 'hsla(258.461538, 50%, 65.490196%, .4)',
}

// Базовые hex-значения токенов для встроенной темы (без пользовательского акцента).
export function presetToColorMap(preset: ThemePresetName): Record<AppColorName, string> {
  const base = presetColorMap[preset]
  const isNight = NIGHT_PRESET_NAMES.has(preset)

  return {
    ...base,
    'message-out-background-color': messageOutBackgroundColor(
      base['message-out-primary-color'],
      base['surface-color'],
      isNight,
    ),
  }
}
