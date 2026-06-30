import { useCallback } from 'react'
import { create } from 'zustand'
import type { ThemeChoice } from './theme'

export type TimeFormat = '12h' | '24h'

// What the chat wallpaper currently shows.
export type Wallpaper =
  | { kind: 'default' }
  | { kind: 'preset'; colors: string[] }
  | { kind: 'color'; color: string }
  | { kind: 'image'; src: string }

export interface Settings {
  themeChoice: ThemeChoice
  textSize: number // message bubble font size (px)
  timeFormat: TimeFormat
  wallpaper: Wallpaper
  wallpaperBlur: boolean
}

const DEFAULTS: Settings = {
  themeChoice: 'system',
  textSize: 16,
  timeFormat: '24h',
  wallpaper: { kind: 'default' },
  wallpaperBlur: false,
}

const KEY = 'tg-settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // migrate the legacy stand-alone theme key, if present
      const legacy = localStorage.getItem('tg-theme')
      if (legacy === 'light') return { ...DEFAULTS, themeChoice: 'classic' }
      if (legacy === 'dark') return { ...DEFAULTS, themeChoice: 'night' }
      return DEFAULTS
    }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void
}

// Global settings live in a store (not a React context) — the single source of
// truth, persisted to localStorage on every change inside the action itself.
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch)
    const s = get()
    const toSave: Settings = {
      themeChoice: s.themeChoice,
      textSize: s.textSize,
      timeFormat: s.timeFormat,
      wallpaper: s.wallpaper,
      wallpaperBlur: s.wallpaperBlur,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(toSave))
    } catch {
      /* ignore quota / private-mode errors */
    }
  },
}))

// Read the whole settings object (+ update) — same shape the old context returned.
export function useSettings(): SettingsState {
  return useSettingsStore()
}

// Convert a stored 24h "HH:MM" string to the user's preferred format.
export function formatTime(hhmm: string, fmt: TimeFormat): string {
  if (fmt === '24h') return hhmm
  const parts = hhmm.match(/^(\d{1,2}):(\d{2})/)
  if (!parts) return hhmm
  let h = parseInt(parts[1], 10)
  const min = parts[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${min} ${ampm}`
}

export function useTimeFormatter(): (hhmm: string | undefined) => string | undefined {
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  return useCallback((hhmm: string | undefined) => (hhmm == null ? hhmm : formatTime(hhmm, timeFormat)), [timeFormat])
}
