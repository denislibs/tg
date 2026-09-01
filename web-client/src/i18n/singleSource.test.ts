// ── ПИН ГРАНИЦЫ: источник строк в проекте ОДИН ────────────────────────────────
//
// Задача 9 свела всю локализацию к `I18n.strings`: продукт не читает файлы
// словарей, а спрашивает сервер, и второй карты строк нигде нет. Держится это
// сегодня ничем, кроме отсутствия импортов, — а импорт возвращается одной
// строкой, и возвращается он МОЛЧА: приложение продолжит работать, просто у
// не-английского пользователя снова поедет лишний чанк, и два ответа на один
// ключ снова смогут разойтись (ровно то, что волна и разбирала).
//
// Проверяются ДВА утверждения, и оба на исходниках — типом их не выразить:
//  • файлы переводов (`dict.*.ts`) не импортирует НИ ОДИН продуктовый модуль;
//  • карту `I18n.strings` наполняет ровно одно место — `lib/langPack.ts`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')

/**
 * Кто ИМЕЕТ ПРАВО читать файлы переводов. Список короткий и поимённый:
 *  • сам прогон (`src/test/lang.ts` — язык в тестах приезжает из файлов, потому
 *    что сервера в прогоне нет);
 *  • тесты словарей и покрытия.
 * Продуктового модуля здесь нет ни одного, и это и есть утверждение пина.
 */
const MAY_READ_DICTS = new Set(['src/test/lang.ts'])

/** Единственный владелец карты строк. */
const STRINGS_OWNER = 'src/lib/langPack.ts'

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** `import … from './dict.ru'`, `import('@/i18n/dict.uk')` — обе формы. */
const DICT_IMPORT = /\bfrom\s+'([^']*\/)?dict\.[a-z]{2}'|\bimport\('([^']*\/)?dict\.[a-z]{2}'\)/g

/** Запись в карту строк: `strings.set(…)` / `strings.clear()` в любом виде. */
const STRINGS_WRITE = /\bstrings\.(set|clear|delete)\(/g

function scan(pattern: RegExp, skipTests: boolean) {
  const hits: string[] = []
  let files = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(process.cwd()), file)
    if (skipTests && /\.test\.tsx?$/.test(rel)) continue
    files++
    const src = readFileSync(file, 'utf8')
    for (const _ of src.matchAll(pattern)) hits.push(rel)
  }
  return { hits, files }
}

describe('источник строк в проекте один', () => {
  it('файлы переводов не импортирует ни один продуктовый модуль', () => {
    const { hits } = scan(DICT_IMPORT, true)
    expect([...new Set(hits)].filter((file) => !MAY_READ_DICTS.has(file))).toEqual([])
  })

  // Иначе «нарушителей нет» означало бы «скан не нашёл ни одного файла».
  it('скан вообще смотрел на исходники', () => {
    const { files } = scan(DICT_IMPORT, true)
    expect(files).toBeGreaterThan(400)
    // И сам разрешённый импорт находится — то есть регулярка ловит эту форму.
    const { hits } = scan(DICT_IMPORT, false)
    expect(hits).toContain('src/test/lang.ts')
  })

  it('карту `I18n.strings` наполняет ровно один модуль', () => {
    const { hits } = scan(STRINGS_WRITE, true)
    expect([...new Set(hits)]).toEqual([STRINGS_OWNER])
  })
})
