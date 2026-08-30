import type { LangPackString } from '@layer'
import type { LangPackKey, LangPackValue } from '../lang'

export type Lang = 'en' | 'ru' | 'uk' | 'es' | 'de' | 'fr'

/**
 * Плоский словарь перевода — та же форма, что у английского источника (`src/lang.ts`):
 * СИМВОЛИЧЕСКИЙ ключ → текст. Ключ, которого нет в источнике, не соберётся, а форма
 * значения обязана совпасть с источником: где у английского формы числа, там объект
 * с формами и у перевода (`{one_value, few_value, many_value, other_value}`).
 *
 * `typeof import(...)` — тип-импорт, он стирается: значение `lang` в бандл отсюда не
 * едет, поэтому английский источник не попадает в главный чанк вместе с этим файлом.
 */
type LangSource = typeof import('../lang')['default']
export type LangPackDict = {
  [K in LangPackKey]?: LangSource[K] extends string ? string : Exclude<LangPackValue, string>
}

/**
 * СТАРАЯ форма словаря: ключ = английская строка. Живёт до задачи 9, пока интерфейс
 * зовёт `t('English string')`. Данные под неё больше нигде не хранятся — она целиком
 * ПРОИЗВОДНАЯ от нового словаря, см. `./legacyDict.ts`.
 */
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
  // SettingSection: ключи взяты из tweb lang.ts:1445/1835 (совпадают с
  // оригиналом дословно), отображаемый текст с ключом не совпадает.
  CurrentSession: 'This device',
  ClearOtherSessionsHelp: 'Logs out all devices except for this one.',
  // Вкладка «Устройства» (`sidebarLeft/tabs/activeSessions.solid.tsx`): ключи и
  // тексты взяты из tweb lang.ts:1444-1465, :1836, :3892 дословно. Ключа
  // 'Terminate' здесь нет намеренно — его текст совпадает с ключом, и правило
  // «ключ = английская строка» отдаёт его без записи.
  SessionsTitle: 'Active Sessions',
  TerminateAllSessions: 'Terminate All Other Sessions',
  TerminateSessionText: 'Are you sure you want to terminate this session?',
  OtherSessions: 'Active sessions',
  AreYouSureSessionTitle: 'Terminate session',
  AreYouSureSessionsTitle: 'Terminate sessions',
  AreYouSureSessions: 'Are you sure you want to terminate all other sessions?',
  SessionsListInfo: 'The official Telegram app is available for Android, iPhone, iPad, Windows, macOS and Linux.',
  'RecentSessions.Error.FreshReset': 'For security reasons, you can\'t terminate older sessions from a device that you\'ve just connected. Please use an earlier connection or wait for a few hours.',
  // Отказ на пути «открыть вкладку»: список сессий не приехал (tweb lang.ts:3694,
  // всплывашка `newAuthorization.tsx:126`).
  'Error.AnError': 'An error occurred. Please try again later.',
}

// The other languages are heavy (~40 kB each) and split into per-language chunks,
// loaded on demand — only the active language's dict reaches the browser.
// Чанк отдаёт готовые конструкторы схемы (`langPackString`/`langPackStringPluralized`) —
// ровно то, что принимает `I18n.applyLangPack`, и ровно то, что приедет с сервера
// (`langpack.getDifference`, задача 5).
export const loaders: Record<Exclude<Lang, 'en'>, () => Promise<LangPackString[]>> = {
  ru: () => import('./dict.ru').then((m) => m.default),
  uk: () => import('./dict.uk').then((m) => m.default),
  es: () => import('./dict.es').then((m) => m.default),
  de: () => import('./dict.de').then((m) => m.default),
  fr: () => import('./dict.fr').then((m) => m.default),
}
