import { create } from 'zustand'

import type { LangPackString } from '@layer'

import lang, { type LangPackKey, type LangPackValue } from '../lang'
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

/** Строки одного языка: символический ключ → текст (или формы числа). */
type Strings = Partial<Record<string, LangPackValue>>

/**
 * Английский источник (`src/lang.ts`) — НИЖНИЙ СЛОЙ, всегда. Ровно то же правило
 * слияния, что у ядра (`I18n.applyServerLangPack`, порт tweb :237-244): убрать его
 * нельзя, потому что переведён у русского не весь словарь, а у остальных четырёх —
 * примерно половина, и без английского снизу непереведённый ключ приехал бы на
 * экран СИМВОЛИЧЕСКИМ ИМЕНЕМ.
 *
 * Импорт статический, а не ленивый: `t()` зовут на первом же рендере, и английский
 * текст обязан быть на месте синхронно — иначе интерфейс мигнёт именами ключей.
 */
const EN: Strings = lang

/** Конструкторы схемы (так приезжает и словарь-чанк, и пакет с сервера) — в плоские строки.
 *  `langPackStringDeleted` — снятый перевод: ключ не кладём вовсе, и под ним остаётся
 *  английский нижний слой (то же делает мост старой формы, `legacyDict.ts`). */
function toStrings(strings: LangPackString[]): Strings {
  const out: Strings = {}
  for (const string of strings) {
    if (string._ === 'langPackString') out[string.key] = string.value
    else if (string._ === 'langPackStringPluralized') {
      out[string.key] = { one_value: string.one_value, few_value: string.few_value, many_value: string.many_value, other_value: string.other_value }
    }
  }
  return out
}

/** Аргумент подстановки: числа и строки. Узлы умеет только ядро (`i18n()`), не `t()`. */
export type TArgs = (string | number)[]

/**
 * Подстановка аргументов — УРЕЗАННАЯ копия `I18n.superFormatter` (`lib/langPack.ts`,
 * порт tweb :358-458): только `%1$s`-по-номеру и `%s`/`%d`-по-порядку, без разметки
 * (`**жирный**`, ссылки, иконки) и без узлов.
 *
 * ПОЧЕМУ КОПИЯ, А НЕ ВЫЗОВ ЯДРА. Ядро отдаёт строки из `I18n.strings`, а их туда
 * сегодня никто не кладёт: применение языкового пакета на старте вкладки заводит
 * ЗАДАЧА 9 (разбор — в докблоке `lib/langPack.ts`). Позвать `I18n.format` отсюда
 * значит получить на экране символический ключ. Импортировать `lib/langPack.ts`
 * ради одного `superFormatter` тоже нельзя: он статически тянет `client/bootstrap`
 * (владелец пакета живёт в воркере), а этот модуль импортируют триста файлов
 * интерфейса — кольцо импортов на ровном месте.
 *
 * Поэтому здесь ровно то, что нужно нынешним вызывающим, и уедет это целиком
 * ЗАДАЧЕЙ 9 вместе с самим `t()`: `useT` станет обёрткой над `I18n`.
 *
 * Экспорт нужен ТЕСТУ, и вот почему: перепутанные номера аргументов на наших строках
 * не выразимы — в словаре нет ни одной строки, где `%2$s` стоит раньше `%1$s`, и
 * подстановка «по порядку» даёт на них тот же результат, что подстановка «по номеру».
 * Проверять номера, значит, надо на строке, которой у нас пока нет.
 */
export function substituteArgs(input: string, args?: TArgs): string {
  if (!args?.length) return input
  let next = 0
  return input.replace(/%(\d+)\$[sd@]|%[sd@]/g, (match, index?: string) => {
    const arg = index ? args[+index - 1] : args[next++]
    return arg === undefined ? match : String(arg)
  })
}

/**
 * Форма числа выбирается ПРАВИЛАМИ ЯЗЫКА, а не вызывающим. Ровно как в ядре
 * (`I18n.format`, tweb :460-486): `Intl.PluralRules` по первому аргументу, а если
 * такой формы у языка нет — общий `other_value`.
 */
function pick(value: LangPackValue, args: TArgs | undefined, rules: Intl.PluralRules): string {
  if (typeof value === 'string') return value
  if (!args?.length) return value.other_value ?? ''
  const count = typeof args[0] === 'number' ? args[0] : +String(args[0]).replace(/\D/g, '')
  const form = value[`${rules.select(count)}_value` as 'one_value']
  return form ?? value.other_value ?? ''
}

/**
 * `t` для ключа БЕЗ аргументов и `tArgs` — для ключа с ними.
 *
 * СТАРАЯ ФОРМА КЛЮЧА («ключ = английская строка») продолжает работать: пока кодмод
 * задачи 6 идёт по подсистемам, часть интерфейса ещё зовёт `t('Archived Chats')`, и
 * ломать её между коммитами нельзя. Символический ключ ищется первым, старая строка —
 * вторым; ни одна старая строка при этом не перекрыта чужим ключом
 * (проверено по карте: совпадающие имена дают один и тот же текст).
 */
function makeT(strings: Strings, legacy: Dict, rules: Intl.PluralRules) {
  return (key: string, args?: TArgs): string => {
    const value = strings[key]
    if (value !== undefined) return substituteArgs(pick(value, args, rules), args)
    return legacy[key] ?? key
  }
}

interface I18nState {
  lang: Lang
  /**
   * ТИП АРГУМЕНТА СУЖАЕТСЯ ДО `LangPackKey` последним коммитом задачи 6 — когда на
   * старой форме ключа не останется ни одного вызывающего. Раньше нельзя: кодмод
   * идёт по подсистемам, и до конца прогона половина интерфейса зовёт `t()` со
   * старой строкой, которая в `LangPackKey` не входит.
   */
  t: (key: string) => string
  /** Ключ с аргументами: число (форма выбирается языком) и подстановки `%s`/`%1$s`. */
  tArgs: (key: LangPackKey, args: TArgs) => string
  setLang: (l: Lang) => void
}

function makeState(lang: Lang, strings: Strings, legacy: Dict) {
  const rules = new Intl.PluralRules(lang)
  const t = makeT(strings, legacy, rules)
  return { t: t as I18nState['t'], tArgs: t as I18nState['tArgs'] }
}

// Global language lives in a store (not a React context). `t` starts on the inline
// English source; `loadLang` pulls the active language's chunk and swaps it in.
export const useI18nStore = create<I18nState>((set) => ({
  lang: getInitial(),
  ...makeState(getInitial(), EN, en),
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
  // Словарь языка приезжает конструкторами схемы; старую форму ключа переводит
  // `toLegacyDict` — тем же импортом, чтобы карта старых ключей не попадала в
  // главный чанк (английскому интерфейсу она не нужна вовсе). Мост уйдёт с
  // задачей 9 вместе с самим `t()`.
  const state = lang === 'en'
    ? makeState(lang, EN, en)
    : await Promise.all([import('./legacyDict'), loaders[lang]()])
      .then(([{ toLegacyDict }, strings]) => makeState(lang, { ...EN, ...toStrings(strings) }, { ...en, ...toLegacyDict(strings) }))
  if (useI18nStore.getState().lang === lang) {
    useI18nStore.setState(state)
  }
}

export const useI18n = () => useI18nStore()
export const useT = () => useI18nStore((s) => s.t)
export const useTArgs = () => useI18nStore((s) => s.tArgs)
export function useLang() {
  const lang = useI18nStore((s) => s.lang)
  const setLang = useI18nStore((s) => s.setLang)
  return [lang, setLang] as const
}
