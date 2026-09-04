// СКАН ГРАНИЦЫ: в вызов перевода не приезжает английская строка.
//
// Задача 6 перевела ~1100 вызовов со старой формы ключа («ключ = английская строка») на
// символическую. Тип `t()` держит это в новом коде, но ровно до первой строки, которую
// написали мимо типа: `t(x as LangPackKey)`, фикстура теста, литерал в таблице, откуда
// ключ уезжает переменной. Скан смотрит на ИСХОДНИКИ, а не на типы, и потому ловит и их.
//
// Чего он НЕ ловит и не может: правильность соответствия «ключ ↔ место». `t('Archive')`
// вместо `t('ArchivedChats')` — обе строки ключи, скан молчит. Это ловит только чтение
// диффа, и так и было сделано (см. тело коммитов задачи 6).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang from '../lang'

const SRC = resolve(process.cwd(), 'src')

/**
 * Файлы, где `t` — НЕ переводчик. `core/serviceMsg.ts` объявляет свой `t` (конструктор
 * сегмента служебной пилюли, `t('»')`), и его строки к локализации отношения не имеют:
 * это отдельный дефект с номером (задача #114), а не старая форма ключа.
 */
const OWN_T = new Set(['src/core/serviceMsg.ts'])

/**
 * Подсистема локализации сама вызывающим не является: в `src/lang.ts` английские строки —
 * ДАННЫЕ, в `src/i18n/*` — карта, словари и примеры `t('…')` в докблоках.
 */
const NOT_A_CALLER = /^src\/(lang\.ts$|i18n\/)/

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** Вызов перевода с литеральным аргументом: `t('…')`, `tArgs('…', …)`, `store.t('…')`. */
const CALL = /\bt(?:Args)?\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

const unescape = (raw: string) => raw.replace(/\\(['"\\nt])/g, (_, ch: string) => ({ n: '\n', t: '\t' } as Record<string, string>)[ch] ?? ch)

/** Один проход по исходникам: и нарушители, и число просмотренных вызовов. Считать их
 *  РАЗНЫМИ проходами нельзя — тогда «скан ничего не прочитал» краснит только счётчик, а
 *  список нарушителей остаётся пустым и зелёным по той же причине. */
function scan() {
  const offenders: string[] = []
  let calls = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(process.cwd()), file)
    if (NOT_A_CALLER.test(rel) || OWN_T.has(rel)) continue

    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(CALL)) {
      calls++
      const key = unescape(match[2])
      if (key in lang) continue
      const line = src.slice(0, match.index).split('\n').length
      offenders.push(`${rel}:${line}: ${JSON.stringify(key)}`)
    }
  }
  return { offenders, calls }
}

// ── ПИН НА ОСИРОТЕВШИЙ КЛЮЧ: «похоже на ключ, но в источнике его нет» ──────────
//
// Дыра, общая для всех трёх прежних пинов. `dictCoverage` и `domKeyLeak` берут только
// ключи, КОТОРЫЕ ЕСТЬ в `lang.ts`, — поэтому имя, переставшее быть ключом, невидимо для
// обоих: `Row` переводит подпись по умолчанию, `t()` неизвестный ключ возвращает как
// есть, и пользователь читает в списке сроков «Duration.Days1». Ровно так и было: волна
// свела `Duration.Days1`/`Weeks1` в формы числа, а две таблицы (поле типизировано
// `string`) остались со старыми именами и молчали два ревью подряд.
//
// Признак «похоже на ключ» — форма имени: сегменты через точку, каждый с заглавной и
// хотя бы одной строчной буквой (`Chat.Context.Pin`). Формат даты `DD.MM.YYYY` под неё не
// попадает по построению — строчных букв в нём нет.
const KEY_SHAPED = /^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)+$/
const hasLowercase = (s: string) => /[a-z]/.test(s)

/**
 * Комментарии — не код: в них ключи цитируются, в том числе исчезнувшие.
 *
 * Вырезанное заменяется ПРОБЕЛАМИ, а не схлопывается: и длина, и переводы строки
 * сохраняются, поэтому номер строки, посчитанный по обрезанному тексту, совпадает с
 * номером в файле. Прежняя редакция сводила блочный комментарий к ОДНОМУ пробелу — и
 * сообщение указывало на строку тем выше, чем длиннее докблок над находкой. В этом
 * репозитории докблоки на 30-80 строк — обычное дело, то есть промах был не на
 * единицу, а на десятки строк (дефект самого пина, сданный задачей 6 задаче 7).
 */
const blank = (text: string) => text.replace(/[^\n]/g, ' ')
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, before: string) => before + blank(_.slice(before.length)))

/** Находки одного файла. Вынесено, чтобы проверить САМИ НОМЕРА СТРОК (тест ниже). */
export function keyShapedLiterals(source: string, rel: string) {
  const src = stripComments(source)
  const found: { value: string; line: number; message: string }[] = []
  for (const match of src.matchAll(/(['"])([^'"\\\n]+)\1/g)) {
    const value = match[2]
    if (!KEY_SHAPED.test(value) || !hasLowercase(value)) continue
    const line = src.slice(0, match.index).split('\n').length
    found.push({ value, line, message: `${rel}:${line}: «${value}» — по форме ключ, а в lang.ts его нет` })
  }
  return found
}

describe('осиротевших ключей в исходниках нет', () => {
  it('литерал, похожий на ключ, есть в английском источнике', () => {
    const offenders: string[] = []
    let seen = 0
    for (const file of sourceFiles(SRC)) {
      const rel = relative(resolve(process.cwd()), file)
      // Тесты фиксируют и НЕСУЩЕСТВУЮЩИЕ ключи (проверка «ядро показало сам ключ»).
      if (NOT_A_CALLER.test(rel) || /\.test\.tsx?$/.test(rel)) continue
      for (const found of keyShapedLiterals(readFileSync(file, 'utf8'), rel)) {
        seen++
        if (found.value in lang) continue
        offenders.push(found.message)
      }
    }
    // Иначе «сирот нет» означало бы «скан ничего не нашёл».
    expect(seen).toBeGreaterThan(500)
    expect(offenders).toEqual([])
  })

  // Сообщение пина обязано вести к настоящей строке файла — иначе читатель правит не
  // тот код. Проверяется на синтетическом исходнике: на настоящих файлах «правильно»
  // и «схлопнуто» неотличимы, пока в них не окажется докблока перед находкой.
  it('номер строки указывает на строку ФАЙЛА, а не обрезанного текста', () => {
    const source = [
      '/**',
      ' * Докблок в пять строк; цитата `Gone.Away` внутри — не находка.',
      ' *',
      ' * Ещё строка.',
      ' */',
      '// однострочный комментарий с `Also.Gone`',
      "const a = 'Nope.NoSuchKey'",
    ].join('\n')

    expect(keyShapedLiterals(source, 'x.ts')).toEqual([
      { value: 'Nope.NoSuchKey', line: 7, message: 'x.ts:7: «Nope.NoSuchKey» — по форме ключ, а в lang.ts его нет' },
    ])
  })
})

describe('старой формы ключа не осталось', () => {
  it('ни один вызов не передаёт английскую строку вместо ключа', () => {
    expect(scan().offenders).toEqual([])
  })

  // Проверка полезна ровно настолько, насколько что-то читает: пустой обход дал бы
  // зелёное «нарушителей нет» на любом состоянии кода — и это ТОТ ЖЕ проход, что выше.
  //
  // Порог снижен с 800 до 700 (волна 3, задача 6): снос React-версии экрана входа
  // убрал ~20+ мест `t(...)`/`tArgs(...)` — Solid-карточки, которые их заменили,
  // зовут ЯДРО `i18n()` напрямую (`@lib/langPack`), как и сам tweb, а не наш React-
  // хук `useT()`. Этот скан по конструкции смотрит только на форму вызова `t(`/
  // `tArgs(` (см. `CALL` выше) — про `i18n()` он не знает и знать не обязан: его
  // предмет — старая форма ключа У ОСТАВШИХСЯ React-мест, а не общее число вызовов
  // перевода в проекте. Запас (700 при фактических ~779) — тот же приём, что у
  // `toBeGreaterThan(500)` в соседнем скане этого файла: не точная цифра, а «скан
  // реально что-то прочитал».
  it('скан вообще дошёл до вызовов', () => {
    expect(scan().calls).toBeGreaterThan(700)
  })
})
