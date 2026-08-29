export type Lang = 'en' | 'ru' | 'uk' | 'es' | 'de' | 'fr'

export type Dict = Record<string, string>

// English is the source language: keys ARE the English strings, so `t()` falls back
// to the key. Only the few tweb-style dotted keys whose displayed text differs from
// the key live here. Kept inline (tiny) so the default language needs no extra chunk.
export const en: Dict = {
  'Story.AddToProfile': 'Post to Profile',
  'Story.RemoveFromProfile': 'Remove from Profile',
  'Stories.StealthMode.View': 'Hide My View',
  // Row.checkboxKeys по умолчанию (tweb lang.ts:250-251) — отображаемый текст
  // короче ключа, поэтому не совпадает с ним по правилу «ключ = строка».
  'Checkbox.Enabled': 'Enabled',
  'Checkbox.Disabled': 'Disabled',
  // Славянская форма 2-4 из 'Notifications.Count' (client/appBadge): в английском
  // отдельной формы нет — страховка на случай, если чанк ru/uk не догрузился.
  '%d notifications (few)': '%d notifications',
}

// The other languages are heavy (~40 kB each) and split into per-language chunks,
// loaded on demand — only the active language's dict reaches the browser.
export const loaders: Record<Exclude<Lang, 'en'>, () => Promise<Dict>> = {
  ru: () => import('./dict.ru').then((m) => m.default),
  uk: () => import('./dict.uk').then((m) => m.default),
  es: () => import('./dict.es').then((m) => m.default),
  de: () => import('./dict.de').then((m) => m.default),
  fr: () => import('./dict.fr').then((m) => m.default),
}
