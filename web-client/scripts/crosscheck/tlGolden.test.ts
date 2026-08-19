// Контрольная проверка программы перехода на TL: байты, собранные НАШИМ кодеком
// на Go, разбирает НЕИЗМЕНЁННЫЙ десериализатор tweb.
//
// Почему именно так, а не порт `tl_utils` к нам: порт унаследовал бы нашу же
// ошибку вместе с кодом, и совпадение доказывало бы только само себя. Чужая
// реализация такой поблажки не даёт — она либо понимает наши байты, либо нет.
//
// Эталон один на обе стороны — `schema/testdata/tl-golden.json`. Ту же строку
// проверяет `backend/internal/pkg/tl/tl_test.go`, собирая её своим кодеком.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { hasTweb, TWEB_ROOT } from './twebRoot'

const here = dirname(fileURLToPath(import.meta.url))
const goldenPath = join(here, '..', '..', '..', 'schema', 'testdata', 'tl-golden.json')

interface GoldenVector { name: string; type: string; hex: string; note?: string }
const golden: GoldenVector[] = JSON.parse(readFileSync(goldenPath, 'utf8')).vectors

const toBuffer = (hex: string) => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; ++i) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

describe.skipIf(!hasTweb)('байты нашего кодека читает неизменённый десериализатор tweb', () => {
  const vectorOf = (name: string) => {
    const v = golden.find((x) => x.name === name)
    if (!v) throw new Error(`вектора ${name} нет в эталоне`)
    return v
  }

  it('photoStrippedSize разбирается в объект со своим дискриминатором', async () => {
    // Импорт внутри теста, а не на уровне модуля: без чекаута tweb файл не
    // резолвится вовсе, и describe.skipIf не успел бы сработать.
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('photoStrippedSize')
    const d = new TLDeserialization(toBuffer(vector.hex))
    const result = d.fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('photoStrippedSize')
    expect(result.type).toBe('i')
    expect(Array.from(result.bytes as Uint8Array)).toEqual([1, 2, 3])
  })
})

// Пропуск обязан быть ЗАМЕТНЫМ: молча зелёный прогон без предмета проверки —
// это ровно тот случай, когда «тесты прошли» ничего не значит.
describe.runIf(!hasTweb)('чекаут tweb недоступен', () => {
  it('проверка пропущена, и это видно', () => {
    console.warn(
      `crosscheck пропущен: не найден ${TWEB_ROOT}/src/lib/mtproto/tl_utils.ts. ` +
        'Укажи путь переменной TWEB_ROOT.',
    )
    expect(hasTweb).toBe(false)
  })
})
