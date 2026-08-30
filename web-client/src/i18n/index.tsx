import { create } from 'zustand'
import { en, loaders, type Dict, type Lang } from './dict'

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

function isLang(l: string): l is Lang {
  return l === 'en' || l in loaders
}

export function getInitial(): Lang {
  const saved = localStorage.getItem('tg-lang')
  if (saved && isLang(saved)) return saved
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en'
  return nav && isLang(nav) ? nav : 'en'
}

// `t` looks up the translation for the current language; English is the key itself,
// so it falls back to the original string when no entry exists. A fresh `t` is
// produced whenever the active dict changes so consumers selecting `t` re-render.
function makeT(dict: Dict): (s: string) => string {
  return (s) => dict[s] ?? s
}

interface I18nState {
  lang: Lang
  t: (s: string) => string
  setLang: (l: Lang) => void
}

// Global language lives in a store (not a React context). `t` starts on the inline
// English fallback; `loadLang` pulls the active language's chunk and swaps it in.
export const useI18nStore = create<I18nState>((set) => ({
  lang: getInitial(),
  t: makeT(en),
  setLang: (l) => {
    localStorage.setItem('tg-lang', l)
    set({ lang: l })
    void loadLang(l)
  },
}))

// Load a language's dict chunk and swap `t`. English is inline (no chunk fetched).
// Guarded against races: a slow chunk for a language the user already switched away
// from is discarded.
export async function loadLang(lang: Lang): Promise<void> {
  // Словарь языка приезжает конструкторами схемы; старому `t()` его переводит
  // `toLegacyDict` — тем же импортом, чтобы карта старых ключей не попадала в
  // главный чанк (английскому интерфейсу она не нужна вовсе). Мост уйдёт с
  // задачей 9 вместе с самим `t()`.
  const dict = lang === 'en'
    ? en
    : await Promise.all([import('./legacyDict'), loaders[lang]()])
      .then(([{ toLegacyDict }, strings]) => ({ ...en, ...toLegacyDict(strings) }))
  if (useI18nStore.getState().lang === lang) {
    useI18nStore.setState({ t: makeT(dict) })
  }
}

export const useI18n = () => useI18nStore()
export const useT = () => useI18nStore((s) => s.t)
export function useLang() {
  const lang = useI18nStore((s) => s.lang)
  const setLang = useI18nStore((s) => s.setLang)
  return [lang, setLang] as const
}
