import { create } from 'zustand'

import type { LangPackString } from '@layer'

import I18n from '@lib/langPack'

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

/*
 * `isLang` («знаем ли мы такой язык») отсюда ушла вместе с угадыванием языка по
 * браузеру: список языков теперь отдаёт СЕРВЕР (`langpack.getLanguages`), а
 * наличие чанка словаря проверяется там, где чанк и грузится (`loadLang`).
 */

/**
 * Текущий язык — У ЯДРА, и здесь он только читается (задача 8).
 *
 * Раньше отсюда его и выводили: `localStorage('tg-lang')`, а не найдя — язык
 * браузера. Владелец переехал в `lib/langPack.ts` целиком (разбор — в его
 * шапке), поэтому вопрос «какой язык» задаётся ровно ему, а этот стор его
 * ЗЕРКАЛИТ. Функция осталась, потому что осталась её роль: старт приложения
 * (`client/boot.ts`) дожидается словаря выбранного языка до первого рендера.
 */
export function getInitial(): string {
  return I18n.getLastRequestedLangCode()
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
 * ПОЧЕМУ КОПИЯ, А НЕ ВЫЗОВ ЯДРА. Не из-за импорта — с задачи 7 ядро импортируется
 * прямо здесь (`applyToCore` ниже), кольца это не дало: граф `lib/langPack.ts` —
 * двенадцать модулей, и `@/i18n` в него не входит. Причина в ТИПЕ РЕЗУЛЬТАТА:
 * `I18n.format` собирает СПИСОК КУСКОВ (узлы разметки, `<b>`, `<br>`, иконки), а
 * `t()` обязан вернуть строку, потому что его результат уезжает в JSX, в
 * `placeholder` и в `textContent`. Строковый режим ядра (`format(key, true)`)
 * склеивает узлы в текст и тем теряет разметку — то есть даёт ДРУГОЕ поведение, а
 * не то же самое.
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
  /** ЗЕРКАЛО кода языка у ядра (`I18n.getLastRequestedLangCode`), не свой факт.
   *  Тип — строка, а не union наших чанков: код приезжает с сервера
   *  (`langpack.getLanguages`), и словаря у него может не быть вовсе — тогда под
   *  ним остаётся английский, ровно как у непереведённого ключа. */
  lang: string
  /**
   * ТОЛЬКО СИМВОЛИЧЕСКИЙ КЛЮЧ. Тип сужен последним коммитом задачи 6 — когда на старой
   * форме ключа («ключ = английская строка») не осталось ни одного вызывающего;
   * держит это ещё и скан исходников (`noLegacyKeys.test.ts`), потому что мимо типа
   * строку можно протащить приведением.
   *
   * РАНТАЙМ при этом принимает обе формы (см. `makeT`): старый `t()` живёт до задачи 9,
   * и словарь языка обязан переводить старую строку, пока она может встретиться.
   */
  t: (key: LangPackKey) => string
  /** Ключ с аргументами: число (форма выбирается языком) и подстановки `%s`/`%1$s`. */
  tArgs: (key: LangPackKey, args: TArgs) => string
  setLang: (l: string) => void
}

function makeState(lang: string, strings: Strings, legacy: Dict) {
  const rules = new Intl.PluralRules(lang)
  const t = makeT(strings, legacy, rules)
  return { t: t as I18nState['t'], tArgs: t as I18nState['tArgs'] }
}

/**
 * ЯДРО (`lib/langPack.ts`) БЕРЁТ СТРОКИ ОТСЮДА ЖЕ, И ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ОНО
 * ИХ БЕРЁТ.
 *
 * Задача 2 завела `I18n` целиком, но НАПОЛНЯТЬ его было некому: в продукте не было ни
 * одного вызова `applyLangPack`, поэтому `I18n.strings` пуст, а `format()` на пустой
 * карте отдаёт САМ КЛЮЧ. Пока ванильный слой звал `t()`, это никого не касалось; с
 * задачи 7 его подписи строит `i18n()` ядра — и без этой связки кнопка показала бы
 * пользователю «ChatList.Context.Mute».
 *
 * ЯЗЫК ЗДЕСЬ НЕ ОБЪЯВЛЯЕТСЯ. Пакет штампуется кодом, который назвало САМО ЯДРО
 * (`getLastRequestedLangCode`), а не тем, что думает про язык этот файл: у
 * `applyLangPack` есть сверка «пакет не про текущий язык — не применять» (порт
 * tweb :275-277), и передай сюда свой код — сверка сравнивала бы ядро с чужим
 * мнением вместо защиты от опоздавшего пакета. Кто и когда меняет сам код —
 * `loadLang` ниже, единственным вызовом `setLangCode`.
 *
 * Строки те же самые и берутся из ОДНОЙ переменной — иначе `t(key)` и `i18n(key)`
 * разошлись бы на одном экране. `formatLocalStrings` переводит плоскую карту в
 * конструкторы схемы (это же делает загрузчик для локального английского).
 */
function applyToCore(strings: Strings) {
  I18n.applyLangPack({
    _: 'langPackDifference',
    lang_code: I18n.getLastRequestedLangCode(),
    from_version: 0,
    version: 0,
    // Приведение: в `Strings` значения объявлены необязательными (тип плоского
    // словаря), но собирается карта только из ПРИСУТСТВУЮЩИХ ключей — `undefined`
    // в ней не бывает.
    strings: I18n.formatLocalStrings(strings as Record<string, LangPackValue>),
  })
}

// Global language lives in a store (not a React context). `t` starts on the inline
// English source; `loadLang` pulls the active language's chunk and swaps it in.
export const useI18nStore = create<I18nState>((set) => {
  const initial = getInitial()
  applyToCore(EN)
  return {
    lang: initial,
    ...makeState(initial, EN, en),
    // Выбор языка: код объявляется ЯДРУ (оно же его и сохранит) внутри
    // `loadLang`, здесь остаётся перерисовать интерфейс — `set` до загрузки
    // чанка, чтобы подписанные на язык компоненты не ждали сети.
    setLang: (l) => {
      set({ lang: l })
      void loadLang(l)
    },
  }
})

// Load a language's dict chunk and swap `t`. English is inline (no chunk fetched).
// Guarded against races: a slow chunk for a language the user already switched away
// from is discarded.
export async function loadLang(lang: string): Promise<void> {
  // ЯЗЫК ОБЪЯВЛЯЕТСЯ ЯДРУ ЗДЕСЬ И СРАЗУ, до всякого await: ядро — владелец кода
  // языка (`lib/langPack.ts`), и оно же сохранит выбор между запусками. Отложить
  // объявление до применения строк нельзя — узлы `.i18n`, построенные, пока
  // летит чанк, спрашивают язык у ядра.
  I18n.setLangCode(lang)
  // Словарь языка приезжает конструкторами схемы; старую форму ключа переводит
  // `toLegacyDict` — тем же импортом, чтобы карта старых ключей не попадала в
  // главный чанк (английскому интерфейсу она не нужна вовсе). Мост уйдёт с
  // задачей 9 вместе с самим `t()`.
  //
  // Языка без чанка (код с сервера, словаря которого у нас нет) это касается
  // наравне с английским: под ним остаётся английский нижний слой — то же самое,
  // что происходит с непереведённым ключом.
  const loader = loaders[lang as Exclude<Lang, 'en'>]
  const { strings, legacy } = !loader
    ? { strings: EN, legacy: en }
    : await Promise.all([import('./legacyDict'), loader()])
      .then(([{ toLegacyDict }, dict]) => ({
        strings: { ...EN, ...toStrings(dict) } as Strings,
        legacy: { ...en, ...toLegacyDict(dict) },
      }))
  // Гонка снимается ДО применения, а не после: язык, от которого пользователь уже
  // ушёл, не должен попасть ни в `t()`, ни в ядро — иначе экран собрался бы из двух
  // языков сразу. Спрашивается ВЛАДЕЛЕЦ, а не стор: стор его зеркалит.
  if (I18n.getLastRequestedLangCode() !== lang) return
  applyToCore(strings)
  useI18nStore.setState(makeState(lang, strings, legacy))
}

export const useI18n = () => useI18nStore()
export const useT = () => useI18nStore((s) => s.t)
export const useTArgs = () => useI18nStore((s) => s.tArgs)
export function useLang() {
  const lang = useI18nStore((s) => s.lang)
  const setLang = useI18nStore((s) => s.setLang)
  return [lang, setLang] as const
}
