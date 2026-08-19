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

  it('messageEntityBold — простейший конструктор без необязательных полей', async () => {
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('messageEntityBold')
    const result = new TLDeserialization(toBuffer(vector.hex)).fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('messageEntityBold')
    expect(result.offset).toBe(5)
    expect(result.length).toBe(11)
  })

  it('messageEntityTextUrl — строка с префиксом длины и выравниванием', async () => {
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('messageEntityTextUrl')
    const result = new TLDeserialization(toBuffer(vector.hex)).fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('messageEntityTextUrl')
    expect(result.url).toBe('https://example.org')
  })

  // Самая ценная пара во всей проверке: она проверяет не поле, а МЕХАНИЗМ.
  //
  // `collapsed:flags.0?true` на проводе не занимает ничего — он существует
  // только как бит маски. Если бы мы писали его значением (например, `false`),
  // длина записи выросла бы и чужой разбор поехал бы на следующем поле. То
  // есть правило «выключено = отсутствие ключа» здесь не соглашение, а то, без
  // чего байты просто не читаются.
  it('messageEntityBlockquote — поднятый бит collapsed попадает в pFlags', async () => {
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('messageEntityBlockquoteCollapsed')
    const result = new TLDeserialization(toBuffer(vector.hex)).fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('messageEntityBlockquote')
    expect(result.pFlags?.collapsed).toBe(true)
    expect(result.offset).toBe(2)
    expect(result.length).toBe(30)
    // Маска в объект не попадает — она живёт только на проводе.
    expect(result.flags).toBeUndefined()
  })

  it('messageEntityBlockquote — нулевая маска: ключа collapsed нет вовсе', async () => {
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('messageEntityBlockquotePlain')
    const result = new TLDeserialization(toBuffer(vector.hex)).fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('messageEntityBlockquote')
    expect(result.pFlags?.collapsed).toBeUndefined()
    // Ключа нет, а не `false`: именно так «выключено» выглядит после разбора.
    expect('collapsed' in (result.pFlags ?? {})).toBe(false)
    expect(result.offset).toBe(2)
    expect(result.length).toBe(30)
  })

  // Вложенные векторы. Чужой разбор здесь ценен вдвойне: он не просто читает
  // поля, а рекурсивно спускается по `Vector<KeyboardButtonRow>` →
  // `Vector<KeyboardButton>` и на каждом уровне сам решает, какой конструктор
  // перед ним. Если бы мы сбились на выравнивании строки внутри кнопки,
  // поехал бы разбор СЛЕДУЮЩЕЙ кнопки, а не текущей — то есть ошибка вылезла бы
  // далеко от места, где сделана.
  it('replyInlineMarkup — ряды и кнопки восстанавливаются целиком', async () => {
    const { TLDeserialization } = await import('@lib/mtproto/tl_utils')

    const vector = vectorOf('replyInlineMarkup')
    const result = new TLDeserialization(toBuffer(vector.hex)).fetchObject(vector.type, 'crosscheck')

    expect(result._).toBe('replyInlineMarkup')
    expect(result.rows).toHaveLength(1)

    const row = result.rows[0]
    expect(row._).toBe('keyboardButtonRow')
    expect(row.buttons).toHaveLength(2)

    // Разные конструкторы в одном векторе — каждый опознан по своему id.
    expect(row.buttons[0]._).toBe('keyboardButton')
    expect(row.buttons[0].text).toBe('ok')

    expect(row.buttons[1]._).toBe('keyboardButtonUrl')
    expect(row.buttons[1].text).toBe('go')
    expect(row.buttons[1].url).toBe('https://a.io')
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
