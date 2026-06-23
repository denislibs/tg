import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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

interface Ctx extends Settings {
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const value = useMemo<Ctx>(() => ({ ...settings, update }), [settings, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

// Convert a stored 24h "HH:MM" string to the user's preferred format.
export function formatTime(hhmm: string, fmt: TimeFormat): string {
  if (fmt === '24h') return hhmm
  const parts = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!parts) return hhmm
  let h = parseInt(parts[1], 10)
  const min = parts[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${min} ${ampm}`
}

export function useTimeFormatter(): (hhmm: string | undefined) => string | undefined {
  const { timeFormat } = useSettings()
  return useCallback((hhmm: string | undefined) => (hhmm == null ? hhmm : formatTime(hhmm, timeFormat)), [timeFormat])
}
