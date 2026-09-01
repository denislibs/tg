// ── ПИН: в поле «ключ» не кладут уже переведённую строку ─────────────────────
//
// Часть компонентов принимает СИМВОЛИЧЕСКИЙ КЛЮЧ и переводит его внутри
// (`confirmationPopup.titleLangKey`, `PopupPeer.descriptionLangKey`,
// `Row.subtitleLangKey`, `InputSearch.placeholder`). Передать туда `t(k)` —
// значит получить `t(t(k))`.
//
// Сегодня это ЧАЩЕ ВСЕГО безвредно: `format` не нашёл ключа «Удалить» и вернул
// саму строку. Но не всегда: в `dict.de.ts` и `dict.fr.ts` есть ключи, чей
// ПЕРЕВОД сам является ключом (`de`: `Private chats` → `Private Chats`,
// `User Info` → `Info`, `video` → `Video`; `fr`: `Images` → `Photos`,
// `Chat` → `Discussion`) — на них двойной прогон меняет текст, и меняет молча.
// Тот же раскол контракта («часть ждёт ключ, часть — строку, а по сигнатуре
// `string` они неразличимы») уже давал видимый дефект: непереведённый пункт
// меню «Terminate».
//
// Девять таких мест сняла задача #109 (коммит `43e727da`), последнее —
// `InputSearch.placeholder` — задача #118. Пин держит, чтобы они не вернулись:
// вернуться такое место может одной строкой, а типы его не ловят, пока проп
// объявлен как `LangPackKey` (тогда `t(k)` не пройдёт тайпчек) — но ровно этого
// у половины пропов и не было, они объявлялись `string`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА (разбор — в соседних пинах). */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Обоснованные исключения: `путь → причина`. Список ПУСТОЙ — утверждение, а не
 *  заготовка: сегодня ни одному месту не нужно класть строку в поле ключа. */
const ALLOWED: Record<string, string> = {}

/** Пробелы вместо вырезанного — чтобы номер строки совпадал с номером в файле. */
const blank = (text: string) => text.replace(/[^\n]/g, ' ')
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])\/\/[^\n]*/g, (match: string, before: string) => before + blank(match.slice(before.length)))

/**
 * Поле-ключ, которому дают перевод: `titleLangKey: t('X')`,
 * `descriptionLangKey={tArgs('X', [n])}`, `langPackKey: t(k)`.
 *
 * Ловится имя, оканчивающееся на `LangKey`/`langPackKey`/`LangPackKey`, — это и
 * есть договор «сюда едет ключ». Проп `placeholder` сюда не попадает по имени, и
 * это осознанно: `placeholder` бывает и обычной строкой (`<input>`), а поле-ключ
 * у него держит уже система типов (`InputSearch.placeholder: LangPackKey`).
 */
const CALL = /\w*(?:LangKey|[Ll]angPackKey)\s*(?::|=\{)\s*t(?:Args)?\(/g

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** Находки одного файла. Вынесено, чтобы проверить САМИ НОМЕРА СТРОК. */
export function doubleTranslations(source: string, rel: string) {
  const lines = stripComments(source).split('\n')
  const hits: string[] = []
  for (let i = 0; i < lines.length; i++) {
    CALL.lastIndex = 0
    if (CALL.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`)
  }
  return hits
}

function scan() {
  const hits: string[] = []
  let files = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(SRC, '..'), file)
    if (/\.test\.tsx?$/.test(rel)) continue
    if (rel in ALLOWED) continue
    files++
    hits.push(...doubleTranslations(readFileSync(file, 'utf8'), rel))
  }
  return { hits, files }
}

describe('поле-ключ получает ключ, а не перевод', () => {
  it('скан вообще дошёл до исходников', () => {
    expect(scan().files).toBeGreaterThan(500)
  })

  it('ни один продуктовый модуль не кладёт t(...) в поле-ключ', () => {
    expect(scan().hits).toEqual([])
  })

  it('номер строки указывает на строку ФАЙЛА, а не обрезанного текста', () => {
    const source = [
      '/**',
      ' * Докблок: цитата `titleLangKey: t(\'X\')` внутри — не находка.',
      ' */',
      'popup({ titleLangKey: t(\'Login.ResetAccount.Title\') })',
    ].join('\n')

    expect(doubleTranslations(source, 'x.ts')).toEqual([
      'x.ts:4: popup({ titleLangKey: t(\'Login.ResetAccount.Title\') })',
    ])
  })
})
