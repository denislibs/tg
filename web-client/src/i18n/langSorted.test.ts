// Английский источник (`src/lang.ts`) отсортирован по ключу — и это ПРОВЕРЯЕТСЯ, а не
// подразумевается. Волна дважды вставила новые ключи мимо алфавита (`MediaEditor.Mute`,
// `Statistics.Posts`, блок `PreviewSender.*`), и оба раза это ловило только ревью
// глазами: ни сборка, ни тайпчек порядок записей в объекте не смотрят, а файл на
// полторы тысячи строк без порядка перестаёт быть просматриваемым — дубли и «а есть ли
// уже такой ключ?» становятся неразрешимыми на глаз.
//
// Порядок — обычное сравнение строк ключа (ASCII, заглавные раньше строчных), ровно то,
// что даёт `sort-keys` и любой автосортировщик. Проверяется ИСХОДНИК, а не
// `Object.keys(lang)`: порядок полей объекта в рантайме тот же, но сообщение об ошибке
// должно называть строку файла, которую правит человек.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang from '../lang'

const SOURCE = resolve(process.cwd(), 'src/lang.ts')
/** Запись верхнего уровня объекта: `Key: …` или `'Some.Key': …` с отступом в два пробела. */
const ENTRY = /^ {2}(?:'([^']+)'|([A-Za-z0-9_]+)):/

function keysInOrder(): { key: string; line: number }[] {
  const lines = readFileSync(SOURCE, 'utf8').split('\n')
  const out: { key: string; line: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = ENTRY.exec(lines[i])
    if (match) out.push({ key: match[1] ?? match[2], line: i + 1 })
  }
  return out
}

describe('английский источник отсортирован по ключу', () => {
  it('каждый ключ идёт после предыдущего', () => {
    const keys = keysInOrder()
    const outOfOrder: string[] = []
    for (let i = 1; i < keys.length; i++) {
      if (keys[i].key < keys[i - 1].key) {
        outOfOrder.push(`lang.ts:${keys[i].line}: «${keys[i].key}» стоит после «${keys[i - 1].key}»`)
      }
    }
    expect(outOfOrder).toEqual([])
  })

  // Разбор исходника обязан находить ВСЕ ключи: неудачная регулярка дала бы пустой
  // список и зелёное «всё отсортировано» на любом файле.
  it('разбор исходника нашёл все ключи объекта', () => {
    expect(keysInOrder().map((k) => k.key)).toEqual(Object.keys(lang))
  })
})
