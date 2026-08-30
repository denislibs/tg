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

describe('старой формы ключа не осталось', () => {
  it('ни один вызов не передаёт английскую строку вместо ключа', () => {
    expect(scan().offenders).toEqual([])
  })

  // Проверка полезна ровно настолько, насколько что-то читает: пустой обход дал бы
  // зелёное «нарушителей нет» на любом состоянии кода — и это ТОТ ЖЕ проход, что выше.
  it('скан вообще дошёл до вызовов', () => {
    expect(scan().calls).toBeGreaterThan(800)
  })
})
