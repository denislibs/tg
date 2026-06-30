import { createTheme, type Theme } from '@mui/material/styles'
import patternUrl from './assets/pattern.svg'

export type Mode = 'light' | 'dark'

// Named colour themes shown in General Settings. 'system' follows the OS and
// resolves to 'classic' (light) or 'night' (dark) at runtime.
export type ThemePreset = 'classic' | 'day' | 'night' | 'dark'
export type ThemeChoice = ThemePreset | 'system'

// Custom design tokens layered on top of the MUI theme.
export interface TgTokens {
  accent: string
  accentGradient: string
  appBg: string
  sidebarBg: string
  bubble: string
  bubbleOut: string // outgoing-bubble background (tweb: a light accent tint)
  bubbleOutText: string // outgoing-bubble body text (dark on light, light on dark)
  bubbleOutAccent: string // outgoing accent (ticks, links, voice play/waveform)
  bubbleBorder: string
  hover: string
  selectedText: string
  divider: string
  textPrimary: string
  textSecondary: string
  textFaint: string
  link: string
  searchBg: string
  bannerBg: string
  badge: string
  pattern: string
  patternMask: string // solid-stroke doodle used as a CSS mask (gradient shows through)
  composeShadow: string
  menuBg: string
  menuShadow: string
  bgGradient: string[] // 4-point animated wallpaper gradient (tweb default)
}

declare module '@mui/material/styles' {
  interface Theme {
    tg: TgTokens
  }
  interface ThemeOptions {
    tg?: TgTokens
  }
}

// The real Telegram doodle pattern (bundled SVG); used both as the light overlay
// and as the dark-theme mask so the gradient shows through the doodle shapes.
const pattern = `url("${patternUrl}")`

// Values sampled from Telegram Web-K "Night" theme (.night palette)
const nightTokens: TgTokens = {
  accent: '#8774e1',
  accentGradient: 'linear-gradient(135deg, #8774e1 0%, #9a86ec 100%)',
  appBg: '#181818',
  sidebarBg: '#212121',
  bubble: '#212121',
  bubbleOut: '#353246',
  bubbleOutText: '#ffffff',
  bubbleOutAccent: '#c3b9f0',
  bubbleBorder: 'rgba(255,255,255,0.04)',
  hover: 'rgba(255,255,255,0.08)',
  selectedText: '#ffffff',
  divider: 'rgba(255,255,255,0.08)',
  textPrimary: '#ffffff',
  textSecondary: '#aaaaaa',
  textFaint: '#707579',
  link: '#8774e1',
  searchBg: '#2b2b2b',
  bannerBg: 'rgba(255,255,255,0.04)',
  badge: '#8774e1',
  pattern,
  patternMask: pattern,
  composeShadow: '0 6px 22px rgba(135,116,225,0.5)',
  menuBg: 'rgba(30,30,30,0.8)',
  menuShadow: '0 12px 44px rgba(0,0,0,0.55)',
  bgGradient: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'], // tweb night wallpaper
}

const classicTokens: TgTokens = {
  accent: '#7d63e8',
  accentGradient: 'linear-gradient(135deg, #8a6cf0 0%, #a079f6 100%)',
  appBg: '#e7ddf5',
  sidebarBg: '#ffffff',
  bubble: '#ffffff',
  bubbleOut: '#ede9fc',
  bubbleOutText: '#1c1c1e',
  bubbleOutAccent: '#7d63e8',
  bubbleBorder: 'rgba(0,0,0,0.04)',
  hover: 'rgba(0,0,0,0.035)',
  selectedText: '#ffffff',
  divider: 'rgba(0,0,0,0.07)',
  textPrimary: '#1c1c1e',
  textSecondary: '#82868d',
  textFaint: '#a0a2a8',
  link: '#5b51d8',
  searchBg: 'rgba(0,0,0,0.045)',
  bannerBg: 'rgba(125,99,232,0.06)',
  badge: '#7d63e8',
  pattern,
  patternMask: pattern,
  composeShadow: '0 6px 22px rgba(120,90,240,0.4)',
  menuBg: 'rgba(255,255,255,0.82)',
  menuShadow: '0 12px 44px rgba(80,60,160,0.20)',
  bgGradient: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'], // tweb day wallpaper
}

// "Day" — a brighter light theme with a teal accent and Telegram's classic
// blue-tinted chat list (the green doodle wallpaper).
const dayTokens: TgTokens = {
  ...classicTokens,
  accent: '#3390ec',
  accentGradient: 'linear-gradient(135deg, #3390ec 0%, #58a6f5 100%)',
  bubbleOut: '#e2f0fc',
  bubbleOutText: '#1c1c1e',
  bubbleOutAccent: '#3390ec',
  appBg: '#dfe6ec',
  link: '#3390ec',
  bannerBg: 'rgba(51,144,236,0.07)',
  badge: '#3390ec',
  composeShadow: '0 6px 22px rgba(51,144,236,0.4)',
  bgGradient: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'],
}

// "Dark" — a neutral near-black theme (vs Night's purple), blue accent.
const darkTokens: TgTokens = {
  ...nightTokens,
  accent: '#5ea7e8',
  accentGradient: 'linear-gradient(135deg, #5ea7e8 0%, #7bb8ee 100%)',
  appBg: '#0e0e0e',
  sidebarBg: '#181818',
  bubble: '#181818',
  bubbleOut: '#263542',
  bubbleOutText: '#ffffff',
  bubbleOutAccent: '#aed3f3',
  searchBg: '#222',
  link: '#5ea7e8',
  badge: '#5ea7e8',
  composeShadow: '0 6px 22px rgba(94,167,232,0.45)',
  bgGradient: ['#4a5a6a', '#2e3a48', '#3a4654', '#28323e'],
}

const PRESETS: Record<ThemePreset, { mode: Mode; tg: TgTokens }> = {
  classic: { mode: 'light', tg: classicTokens },
  day: { mode: 'light', tg: dayTokens },
  night: { mode: 'dark', tg: nightTokens },
  dark: { mode: 'dark', tg: darkTokens },
}

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

export function buildTheme(preset: ThemePreset): Theme {
  const { mode, tg } = PRESETS[preset]
  return createTheme({
    tg,
    palette: {
      mode,
      primary: { main: tg.accent },
      background: {
        default: tg.appBg,
        paper: tg.sidebarBg,
      },
      text: {
        primary: tg.textPrimary,
        secondary: tg.textSecondary,
      },
      divider: tg.divider,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: 14,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*::-webkit-scrollbar': { width: 6, height: 6 },
          '*::-webkit-scrollbar-thumb': {
            background: mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
            borderRadius: 16,
          },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
        },
      },
    },
  })
}
