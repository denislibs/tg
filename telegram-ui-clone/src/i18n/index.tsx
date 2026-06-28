import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
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

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (s: string) => string
}

const I18nContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (s) => s })

function getInitial(): Lang {
  const saved = localStorage.getItem('tg-lang')
  if (saved && saved in dicts) return saved as Lang
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en'
  return (nav && nav in dicts ? nav : 'en') as Lang
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitial)
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('tg-lang', l)
    setLangState(l)
  }, [])
  // `t` looks up the translation for the current language; English is the key
  // itself, so it falls back to the original string when no entry exists.
  const t = useCallback((s: string) => dicts[lang]?.[s] ?? s, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
export const useT = () => useContext(I18nContext).t
export function useLang() {
  const { lang, setLang } = useContext(I18nContext)
  return [lang, setLang] as const
}
