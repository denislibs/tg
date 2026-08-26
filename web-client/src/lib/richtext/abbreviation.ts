// Инициалы для аватарки — порт tweb `lib/richTextProcessor/getAbbreviation.ts`
// и `lib/richTextProcessor/wrapAbbreviation.ts`.
//
// Правило оригинала (getAbbreviation.ts:11-34): строка режется по пробелам;
// от ПЕРВОГО слова берётся эмодзи целиком (если слово с него начинается) либо
// один первый символ, от ПОСЛЕДНЕГО — то же самое; результат склеивается.
// Одно слово (или `onlyFirst`) — только первая часть.
//
// ── Расхождение (одно) ──────────────────────────────────────────────────────
// Оригинал возвращает `{text, entities}` и отдаёт эти `entities` в
// `wrapEmojiText(text, undefined, entities)` (wrapAbbreviation.ts:5). Наш
// `wrapEmojiText` третьего аргумента не имеет — он сам находит эмодзи в
// переданной строке (`lib/richtext/wrapEmojiText.ts:20`), и вход у него ровно
// та же склеенная строка. Поэтому здесь считается только `text`: второй список
// эмодзи-сущностей был бы вычислен, доехал бы до `wrapEmojiText` и был бы там
// выброшен. Ровно тот же приём уже применён у имени пира — `getPeerTitle`
// собирает СТРОКУ, а узлы делает `wrapEmojiText` (`chat/peerTitle.ts:117`).
import emojiRegExp from './emojiRegex'
import wrapEmojiText from './wrapEmojiText'

// tweb getAbbreviation.ts:5 — якорь `^`: эмодзи считается только тем, с чего
// слово НАЧИНАЕТСЯ.
const EMOJI_REG_EXP = new RegExp(`(^${emojiRegExp})`)

/** Порт `getAbbreviation` (текстовая часть — см. расхождение в шапке). */
export function getAbbreviation(str: string, onlyFirst = false): string {
  const splitted = (str || '').trim().split(' ')
  if (!splitted[0]) return ''

  const first = splitted[0].match(EMOJI_REG_EXP)?.[0] || splitted[0][0]

  const length = splitted.length
  if (onlyFirst || length === 1) return first

  const last = splitted[length - 1].match(EMOJI_REG_EXP)?.[0] || splitted[length - 1][0]
  return first + last
}

/** Порт `wrapAbbreviation` — инициалы УЗЛАМИ (эмодзи станет `.emoji`). */
export function wrapAbbreviation(str: string, onlyFirst?: boolean): DocumentFragment {
  return wrapEmojiText(getAbbreviation(str, onlyFirst))
}
