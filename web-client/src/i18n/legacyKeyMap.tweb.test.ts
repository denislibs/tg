import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import lang from '../lang'

// Ключ, взятый у оригинала, обязан значить то же самое. Единственная машинная проверка этого —
// английский текст: расхождение означает, что ключ взяли по похожести имени, а не по смыслу.
// Чекаут tweb — рабочий инструмент, а не зависимость сборки, поэтому путь через `TWEB_ROOT` и
// мягкий пропуск с явным сообщением — та же договорённость, что в `scripts/crosscheck/twebRoot.ts`.
const TWEB_ROOT = process.env.TWEB_ROOT ?? '/Users/denisurevic/Documents/tweb'
const hasTweb = existsSync(`${TWEB_ROOT}/src/lang.ts`)

if (!hasTweb) {
  console.warn(`[i18n] нет чекаута tweb (${TWEB_ROOT}) — сверка ключей с оригиналом НЕ выполнялась`)
}

type LangValue = string | Record<string, string>

// `lang.ts`/`langSign.ts` оригинала — чистые объектные литералы. Читаем их текстом и вычисляем:
// импортировать чужой модуль мимо корня vite нельзя, а копировать его к себе — значит проверять
// копию вместо оригинала.
function readTwebLang(file: string): Record<string, LangValue> {
  const src = readFileSync(`${TWEB_ROOT}/src/${file}`, 'utf8')
  const start = src.indexOf('{')
  const end = src.lastIndexOf('}')
  // Чужой литерал не JSON (одинарные кавычки, неквотированные ключи), поэтому вычисляем его.
  // Вход — файл чекаута оригинала, а не данные пользователя.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return ${src.slice(start, end + 1)}`)() as Record<string, LangValue>
}

let cached: Record<string, LangValue> | undefined
const twebLang = () => (cached ??= { ...readTwebLang('lang.ts'), ...readTwebLang('langSign.ts') })

describe.skipIf(!hasTweb)('ключи, взятые у оригинала', () => {
  it('разбор оригинала вообще что-то дал', () => {
    // Без этого «расхождений нет» означало бы «сравнивать было не с чем».
    expect(Object.keys(twebLang()).length).toBeGreaterThan(4000)
  })

  it('написаны у нас ровно как у оригинала', () => {
    const tweb = twebLang()
    const diff: string[] = []
    for (const [key, value] of Object.entries(lang as Record<string, LangValue>)) {
      if (!(key in tweb)) continue
      if (JSON.stringify(value) !== JSON.stringify(tweb[key])) {
        diff.push(`${key}: наш ${JSON.stringify(value)} ≠ оригинал ${JSON.stringify(tweb[key])}`)
      }
    }
    expect(diff).toEqual([])
  })
})
