import { create } from 'zustand'
import { dicts, type Lang } from './dict'

export type { Lang }

// Language picker list (code + native name)
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
]

function getInitial(): Lang {
  const saved = localStorage.getItem('tg-lang')
  if (saved && saved in dicts) return saved as Lang
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en'
  return (nav && nav in dicts ? nav : 'en') as Lang
}

// `t` looks up the translation for the current language; English is the key
// itself, so it falls back to the original string when no entry exists. A fresh
// `t` is produced on every language change so consumers selecting `t` re-render.
function makeT(lang: Lang): (s: string) => string {
  return (s) => dicts[lang]?.[s] ?? s
}

interface I18nState {
  lang: Lang
  t: (s: string) => string
  setLang: (l: Lang) => void
}

// Global language lives in a store (not a React context).
export const useI18nStore = create<I18nState>((set) => {
  const lang = getInitial()
  return {
    lang,
    t: makeT(lang),
    setLang: (l) => {
      localStorage.setItem('tg-lang', l)
      set({ lang: l, t: makeT(l) })
    },
  }
})

export const useI18n = () => useI18nStore()
export const useT = () => useI18nStore((s) => s.t)
export function useLang() {
  const lang = useI18nStore((s) => s.lang)
  const setLang = useI18nStore((s) => s.setLang)
  return [lang, setLang] as const
}
