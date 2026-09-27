// Эмодзи в начале/конце названия → иконка папки в вертикальном сайдбаре
// (tweb extractEmojiFromFilterTitle). Возвращает [emoji | null, название без него].
const EMOJI_EDGE = /^(\p{Extended_Pictographic}(?:️)?)|(\p{Extended_Pictographic}(?:️)?)$/u

export function extractFolderEmoji(title: string): [string | null, string] {
  const m = title.trim().match(EMOJI_EDGE)
  if (!m) return [null, title.trim()]
  const emoji = m[1] ?? m[2]
  const rest = title.trim().replace(emoji, '').trim()
  return rest ? [emoji, rest] : [null, title.trim()]
}
