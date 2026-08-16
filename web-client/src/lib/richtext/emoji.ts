// Кодпоинты эмодзи и детект «сообщение из одних эмодзи».
//
// `encodeEmoji`/`toCodePoints` — дословный порт tweb `src/vendor/emoji/index.ts`.
// Важно, что это ЧИСЛЕННОЕ преобразование: на выходе только hex-цифры и дефисы,
// что бы ни было во входной строке. Именно поэтому результат безопасно
// подставлять в имя файла картинки эмодзи (в tweb `wrapRichText.ts:485`
// `img.src = 'assets/img/emoji/' + entity.unicode + '.png'` защищён лишь тем,
// что unicode валидирован таблицей `@config/emoji`, которой у нас нет).
// Тот же приём — в `components/emoji/Emoji.tsx:18-26`.

const vs16RegExp = /️/g
// avoid using a string literal like '‍' here because minifiers expand it inline
const zeroWidthJoiner = String.fromCharCode(0x200d)

const removeVS16s = (rawEmoji: string) => (rawEmoji.indexOf(zeroWidthJoiner) < 0 ? rawEmoji.replace(vs16RegExp, '') : rawEmoji)

export function toCodePoints(unicodeSurrogates: string): string[] {
  const points: string[] = []
  let char = 0
  let previous = 0
  let i = 0
  while (i < unicodeSurrogates.length) {
    char = unicodeSurrogates.charCodeAt(i++)
    if (previous) {
      points.push((0x10000 + ((previous - 0xd800) << 10) + (char - 0xdc00)).toString(16))
      previous = 0
    } else if (char > 0xd800 && char <= 0xdbff) {
      previous = char
    } else {
      points.push(char.toString(16))
    }
  }

  if (points.length && points[0].length === 2) {
    points[0] = '00' + points[0]
  }

  return points
}

export function encodeEmoji(emojiText: string) {
  return toCodePoints(removeVS16s(emojiText)).join('-')
}

/**
 * Страховка на случай, если `unicode` пришёл не из `encodeEmoji` (например,
 * сущность приехала снаружи): в имя файла попадают ТОЛЬКО hex и дефисы.
 * Отдельная функция, чтобы это проверялось тестом безопасности.
 */
export function isSafeEmojiUnicode(unicode: string): boolean {
  return /^[0-9a-f]{2,6}(-[0-9a-f]{1,6})*$/.test(unicode)
}

// Набор Apple, как в `components/emoji/Emoji.tsx`: PNG'шек эмодзи в репозитории
// нет (в tweb это `assets/img/emoji/<unicode>.png`), поэтому тянем ту же
// картинку с CDN emoji-datasource-apple.
export const EMOJI_CDN_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/'

/**
 * Если `text` состоит только из эмодзи (с ZWJ-склейками и тонами кожи) — их
 * количество, любое, ≥1; иначе 0. Перенесено из `components/RichText.tsx`
 * (там же — обоснование по tweb `bubbles.ts:7373`: верхнего порога у детекта
 * big-emoji нет, `Math.min(7, count)` в `bubbles.ts:319` — кламп РАЗМЕРА глифа).
 *
 * Живёт здесь, потому что ванильная лента берёт rich-text из этого модуля, а не
 * из React-компонента; React-версия ещё жива и остаётся нетронутой до её сноса.
 */
export function emojiOnlyCount(text: string): number {
  const t = text.replace(/[\s️]/g, '')
  if (!t) return 0
  const re = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}]?/gu
  const matches = t.match(re)
  if (!matches) return 0
  if (t.replace(re, '').length > 0) return 0 // non-emoji characters present
  return matches.length
}
