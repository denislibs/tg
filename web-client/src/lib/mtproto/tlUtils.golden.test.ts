// Круг «байты → объект → байты» на ЭТАЛОНЕ, собранном кодеком на Go.
//
// Проверка держит ровно то, ради чего порт делался: две реализации одного
// кодека по одной схеме обязаны понимать друг друга. Эталон
// (`schema/testdata/tl-golden.json`) — тот же файл, что читает
// `backend/internal/pkg/tl/tl_test.go`, собирая эти же байты своим кодеком, и
// тот же, что скармливается НЕИЗМЕНЁННОМУ десериализатору tweb
// (`scripts/crosscheck/tlGolden.test.ts`).
//
// Три звена и их роли:
//   Go собрал → tweb разобрал  — чужая реализация подтверждает наши байты;
//   Go собрал → мы разобрали   — этот файл: порт понимает то же самое;
//   мы разобрали → мы собрали  — порт симметричен, а не «читает как-нибудь».
//
// Именно поэтому проверка чужим десериализатором остаётся на месте: порт мог
// бы унаследовать нашу же ошибку вместе с кодом, и круг сошёлся бы сам с собой.
import { describe, expect, it } from 'vitest'

import golden from '../../../../schema/testdata/tl-golden.json'
import { TLDeserialization, TLSerialization } from './tl_utils'

interface GoldenVector { name: string; type: string; hex: string; note?: string }
const vectors = golden.vectors as GoldenVector[]

const toBytes = (hex: string) => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; ++i) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const fetch_ = (v: GoldenVector) => new TLDeserialization(toBytes(v.hex)).fetchObject(v.type, 'golden')

const store = (obj: unknown, type: string) => {
  const s = new TLSerialization({ startMaxLength: 8192 })
  s.storeObject(obj, type, 'golden')
  return toHex(s.getBytes(true))
}

describe('tl_utils: эталон кодека на Go', () => {
  // Список НЕ хардкодится: круг обязан сходиться на каждом векторе эталона,
  // включая те, что появятся позже. Пустой эталон тест бы «прошёл» — на это
  // стоит отдельная проверка ниже.
  it.each(vectors.map((v) => [v.name, v] as const))('круг сходится: %s', (_name, v) => {
    expect(store(fetch_(v), v.type)).toBe(v.hex)
  })

  it('эталон непустой', () => {
    expect(vectors.length).toBeGreaterThan(5)
  })

  // Отдельно — то, ЧТО именно разобралось: круг сошёлся бы и на симметрично
  // неверном разборе (прочитали не тот параметр, записали его же обратно).
  it('дискриминатор восстановлен из числового id, а не прочитан полем', () => {
    const v = vectors.find((x) => x.name === 'photoStrippedSize')!
    const obj = fetch_(v)
    expect(obj._).toBe('photoStrippedSize')
    expect(obj.type).toBe('i')
    expect(Array.from(obj.bytes as Uint8Array)).toEqual([1, 2, 3])
  })

  // Бит маски не занимает на проводе ничего: «выключено» — это ОТСУТСТВИЕ
  // ключа, а не значение. Пара векторов ловит обе стороны правила.
  it('булев флаг живёт в pFlags, а выключенный не существует вовсе', () => {
    const collapsed = fetch_(vectors.find((x) => x.name === 'messageEntityBlockquoteCollapsed')!)
    expect(collapsed.pFlags?.collapsed).toBe(true)

    const plain = fetch_(vectors.find((x) => x.name === 'messageEntityBlockquotePlain')!)
    expect(plain.pFlags?.collapsed).toBeUndefined()
    expect(plain.collapsed).toBeUndefined()
  })

  // Кадр целиком: конструктор апдейта с вложенным сообщением. Это и есть то,
  // что поедет по проводу на шаге D3.
  it('кадр updateNewMessage разбирается вместе с вложенным сообщением', () => {
    const obj = fetch_(vectors.find((x) => x.name === 'updateNewMessage')!)
    expect(obj._).toBe('updateNewMessage')
    expect(obj.message._).toBe('message')
    expect(typeof obj.pts).toBe('number')
  })
})
