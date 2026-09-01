// ── ПИН: даты не берут язык у БРАУЗЕРА ───────────────────────────────────────
//
// `Intl` знает ровно одну вещь — ЛОКАЛЬ, и берёт её либо из аргумента, либо из
// браузера. Языка ПРИЛОЖЕНИЯ у него нет, и настройки «12/24 часа» тоже нет: цикл
// он выбирает по локали. Поэтому любой `toLocale*String` мимо ядра локализации
// врёт как минимум одним из двух способов, и оба видел пользователь:
//
//  • `d.toLocaleDateString([], …)` / `toLocaleDateString(undefined, …)` — пустой
//    список локалей это локаль БРАУЗЕРА. При английском интерфейсе дата в списке
//    чатов оставалась «30 авг.» (задача #121);
//  • `toLocaleDateString(lang === 'ru' ? 'ru-RU' : undefined, …)` — угадывание:
//    четыре остальных языка приложения не учитывались вовсе.
//
// Правильный вход один — ядро: `I18n.getDateTimeFormat(options)` (кэш форматтеров
// по языку ПАКЕТА) и `I18n.IntlDateElement` (он же, но узлом — узел переписывает
// себя сам на смену языка и на смену настройки 12/24 часа). Готовые подписи —
// `@helpers/date` (порт tweb `src/helpers/date.ts`), обёртки для React —
// `shared/ui/dateNodes`.
//
// Скан, а не типы: `toLocale*String` — метод самого `Date`, запретить его
// системой типов нечем, а вернуться он может одной строкой и совершенно молча —
// именно так тринадцать таких мест и накопились.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА: `process.cwd()` зависит от того,
 *  откуда запустили прогон, и молча уводит скан в пустоту. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Обоснованные исключения: `путь → причина`. Список ПУСТОЙ, и это утверждение, а
 * не заготовка — сегодня в продукте нет ни одного места, которому нужна локаль
 * браузера. Новая запись здесь обязана нести причину, по которой языка
 * приложения этому месту НЕ ХВАТАЕТ.
 */
const ALLOWED: Record<string, string> = {}

/** Комментарии снимаются: в докблоках этих файлов прежние вызовы НАЗВАНЫ —
 *  разбор дефекта стоит прямо у исправленной строки, и скан не должен видеть
 *  в нём нарушение. URL (`https://`) при этом не режется. */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

/** Вызов метода даты: `.toLocaleString(`, `.toLocaleDateString(`, `.toLocaleTimeString(`. */
const CALL = /\.toLocale(?:Date|Time)?String\s*\(/g

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

function scan() {
  const hits: string[] = []
  let files = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(SRC, '..'), file)
    // Тесты — не интерфейс: им локаль браузера безразлична, они её фиксируют.
    if (/\.test\.tsx?$/.test(rel)) continue
    if (rel in ALLOWED) continue
    files++
    const src = stripComments(readFileSync(file, 'utf8'))
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      CALL.lastIndex = 0
      if (CALL.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`)
    }
  }
  return { hits, files }
}

describe('даты берут язык у ядра, а не у браузера', () => {
  it('скан вообще дошёл до исходников', () => {
    // Без этого «нарушений нет» означало бы «смотреть было не на что».
    expect(scan().files).toBeGreaterThan(500)
  })

  it('ни один продуктовый модуль не зовёт toLocale*String', () => {
    expect(scan().hits).toEqual([])
  })
})
