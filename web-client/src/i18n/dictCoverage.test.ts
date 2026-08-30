// ПИН ПОКРЫТИЯ: ключ, который зовёт код, обязан иметь запись в русском словаре.
//
// Дыра, ради которой пин заведён: до задачи 6 ключом была сама английская строка, и
// перевод лежал под ней; после перевода на символические ключи запись под НОВЫМ именем
// может отсутствовать — и тогда `t()` молча отдаёт английский текст (`makeT` падает на
// нижний слой `src/lang.ts`). Ни тайпчек, ни скан старых ключей этого не видят: ключ
// настоящий, вызов правильный, текст английский.
//
// Русский взят потому, что он единственный переведён целиком; остальные четыре словаря
// покрыты примерно наполовину by design (задача 3), и требовать от них полноты нечем.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang from '../lang'
import ru from './dict.ru'

const SRC = resolve(process.cwd(), 'src')

/**
 * Ключи, которым перевод НЕ НУЖЕН, — каждый с причиной. Список короткий намеренно:
 * это исключения, а не свалка для непереведённого.
 */
const NO_TRANSLATION: Record<string, string> = {
  'AutoDownloadSettings.Delimeter': 'запятая с пробелом — пунктуация перечисления, а не текст',
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** Любой литерал-ключ в исходниках: и `t('X')`, и таблица, и проп, и сравнение. */
const LITERAL = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g

function usedKeys() {
  const used = new Map<string, string>()
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(process.cwd()), file)
    // Сама подсистема локализации вызывающим не является, тесты — тоже не интерфейс.
    if (/^src\/(lang\.ts|i18n\/)/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(LITERAL)) {
      const key = match[2]
      if (key in lang && !used.has(key)) used.set(key, rel)
    }
  }
  return used
}

describe('покрытие словаря', () => {
  it('каждый ключ, который зовёт код, переведён на русский', () => {
    const translated = new Set(ru.map((string) => string.key))
    const missing = [...usedKeys()]
      .filter(([key]) => !translated.has(key) && !(key in NO_TRANSLATION))
      .map(([key, file]) => `${key} (${file})`)
    expect(missing.sort()).toEqual([])
  })

  // Иначе «непереведённых нет» означало бы «ключей не нашлось».
  it('ключи в коде вообще нашлись', () => {
    expect(usedKeys().size).toBeGreaterThan(900)
  })

  // Список исключений живёт своей жизнью, если его не сверять с реальностью.
  it('исключения не протухли: ключ существует и перевода у него правда нет', () => {
    const translated = new Set(ru.map((string) => string.key))
    const stale = Object.keys(NO_TRANSLATION).filter((key) => !(key in lang) || translated.has(key))
    expect(stale).toEqual([])
  })
})
