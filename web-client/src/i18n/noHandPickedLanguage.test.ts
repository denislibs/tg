// ── ПИН: язык не выбирается сравнением кода с литералом ──────────────────────
//
// Второй способ соврать про язык — после `toLocale*` мимо ядра, который держит
// соседний пин (`noBrowserLocaleDates.test.ts`). Здесь речь про строки,
// собранные РУКАМИ по коду языка:
//
//     const ru = lang === 'ru'
//     return ru ? 'Сегодня' : 'Today'
//
// Такая ветка отвечает на вопрос «русский или нет», а языков в приложении пять,
// плюс любой, приехавший с сервера (`langpack.getLanguages`). То есть
// украинский, испанский, немецкий и французский читают английскую ветку —
// молча, без единого признака в интерфейсе. Так были устроены `friendlyTime.ts`
// (снесён) и `dayLabel.ts` (переведён на узлы ядра) — задача #123.
//
// Правильный вход один — ядро: `t(key)`/`i18n(key, args)` берут строку из
// `I18n.strings` языка ПАКЕТА, а непереведённый ключ падает на английский
// нижним слоем, а не на «не-русский».
//
// Скан, а не типы: `lang === 'ru'` — обычное сравнение строк, запретить его
// системой типов нечем, и вернуться оно может одной строкой.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА (см. разбор в соседнем пине). */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Обоснованные исключения: `путь → причина`.
 *
 * Причина обязана объяснять, почему языка приложения этому месту НЕ ХВАТАЕТ,
 * либо нести НОМЕР ЗАДАЧИ, которая расхождение снимает. «Пока не дошли руки» —
 * не причина: такая запись просто прячет отказ обратно.
 *
 * Список ПУСТ, и это утверждение, а не заготовка. Единственная запись
 * (`core/presence.ts`, подпись присутствия) снята вместе с задачей #126 — там
 * ветвление по языку заменено ключами `Online`/`Lately`/`WithinAWeek`/… Ниже
 * стоит тест, который проверяет, что записи не мертвы: он и потребовал снять
 * эту, как только она перестала соответствовать коду.
 */
const ALLOWED: Record<string, string> = {}

/** Комментарии снимаются: разбор прежних дефектов стоит у исправленных строк и
 *  цитирует их дословно. Пробелы вместо вырезанного — чтобы номер строки в
 *  сообщении совпадал с номером в файле (разбор — в соседнем пине). */
const blank = (text: string) => text.replace(/[^\n]/g, ' ')
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])\/\/[^\n]*/g, (match: string, before: string) => before + blank(match.slice(before.length)))

/**
 * Сравнение с кодом языка: `lang === 'ru'`, `code !== "en"`, `langCode === 'de'`.
 *
 * Ловится ИМЕННО имя переменной со словом `lang`/`locale`, а не любой литерал
 * из двух букв: коды языков лежат и в словарях (`DICTS`), и в тестовых
 * фикстурах, и сравнение там законно — предмет пина в том, что ПОКАЗЫВАЕМОЕ
 * выбирается ветвлением по языку.
 */
const CALL = /\b\w*(?:lang|locale)\w*\s*[!=]==\s*['"][a-z]{2}(?:-[A-Z]{2})?['"]/gi

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** Находки одного файла. Вынесено, чтобы проверить САМИ НОМЕРА СТРОК. */
export function handPickedLanguage(source: string, rel: string) {
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
    // Тесты — не интерфейс: они язык ЗАДАЮТ, и сравнивать код языка им законно.
    if (/\.test\.tsx?$/.test(rel)) continue
    if (rel in ALLOWED) continue
    files++
    hits.push(...handPickedLanguage(readFileSync(file, 'utf8'), rel))
  }
  return { hits, files }
}

describe('строки не выбираются сравнением кода языка с литералом', () => {
  it('скан вообще дошёл до исходников', () => {
    expect(scan().files).toBeGreaterThan(500)
  })

  it('ни один продуктовый модуль не ветвится по коду языка', () => {
    expect(scan().hits).toEqual([])
  })

  it('у каждого исключения есть номер задачи', () => {
    // Список исключений — не свалка: запись без номера задачи означает, что
    // расхождение зафиксировали вместо того, чтобы завести на него работу.
    for (const reason of Object.values(ALLOWED)) expect(reason).toMatch(/ЗАДАЧА #\d+/)
  })

  it('исключения не мёртвые: в каждом и правда есть такая ветка', () => {
    // Иначе список пережил бы починку и стерёг бы пустоту — именно этот тест
    // потребовал снять запись `core/presence.ts`, когда задача #126 её починила.
    for (const rel of Object.keys(ALLOWED)) {
      const hits = handPickedLanguage(readFileSync(resolve(SRC, '..', rel), 'utf8'), rel)
      expect(hits.length, rel).toBeGreaterThan(0)
    }
  })

  it('номер строки указывает на строку ФАЙЛА, а не обрезанного текста', () => {
    const source = [
      '/**',
      ' * Докблок: цитата `lang === \'ru\'` внутри — не находка.',
      ' */',
      '// и в однострочном: lang === \'en\'',
      'const ru = lang === \'ru\'',
    ].join('\n')

    expect(handPickedLanguage(source, 'x.ts')).toEqual([
      'x.ts:5: const ru = lang === \'ru\'',
    ])
  })
})
