// Порт tweb `src/tests/emojiRegExp.test.ts` (1ddddac9e).
//
// Одиночный суррогат в строке шаблона не имеет представления в UTF-8, и
// сборщик, который вклеивает эту константу в чанк, переписывает его в U+FFFD —
// после чего ни один астральный эмодзи молча не совпадает (нет
// `messageEntityEmoji` → нет big emoji). У tweb так сломался воркерный чанк
// после обновления rolldown; наш билд пока цел, пин — профилактика.
import { describe, expect, it } from 'vitest'

import emojiRegExp from './emojiRegex'
import parseEntities from './parseEntities'

describe('регэксп эмодзи', () => {
  it('чистый ASCII — сборщику нечего испортить', () => {
    // По кодовым единицам UTF-16 (`split('')`), а не по кодпоинтам, как
    // `[...str]` у tweb: одиночный суррогат и есть кодовая единица.
    const offenders = emojiRegExp.split('').filter((char) => char.charCodeAt(0) > 0x7f)

    expect(offenders).toEqual([])
  })

  it('совпадает с астральными эмодзи целиком', () => {
    const regExp = new RegExp(`^(?:${emojiRegExp})$`)

    for (const emoji of ['😳', '🔥', '👍', '👍🏽', '🇺🇸', '👨‍👩‍👦', '🫱🏻‍🫲🏿', '❤', '☝', '⌚']) {
      expect(regExp.test(emoji), emoji).toBe(true)
    }
  })

  it('даёт сущность эмодзи на всю его длину', () => {
    // Именно это делает бабл «большим эмодзи»: лента сравнивает суммарную
    // длину сущностей эмодзи с длиной текста.
    for (const emoji of ['😳', '🔥', '👍🏽', '❤']) {
      expect(parseEntities(emoji), emoji).toEqual([
        expect.objectContaining({ _: 'messageEntityEmoji', offset: 0, length: emoji.length }),
      ])
    }
  })
})
