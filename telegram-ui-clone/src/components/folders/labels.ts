// Подзаголовок строки папки: «1 канал и 1 группа», «3 чата» — порт tweb
// chatFolders.tsx (i18n('Chats',[n]) + join) со склонениями по языкам.
type Kind = 'chat' | 'group' | 'channel'

// [one, few, many] для славянских; [one, other] для остальных
const FORMS: Record<string, Record<Kind, string[]>> = {
  ru: { chat: ['чат', 'чата', 'чатов'], group: ['группа', 'группы', 'групп'], channel: ['канал', 'канала', 'каналов'] },
  uk: { chat: ['чат', 'чати', 'чатів'], group: ['група', 'групи', 'груп'], channel: ['канал', 'канали', 'каналів'] },
  en: { chat: ['chat', 'chats'], group: ['group', 'groups'], channel: ['channel', 'channels'] },
  es: { chat: ['chat', 'chats'], group: ['grupo', 'grupos'], channel: ['canal', 'canales'] },
  de: { chat: ['Chat', 'Chats'], group: ['Gruppe', 'Gruppen'], channel: ['Kanal', 'Kanäle'] },
  fr: { chat: ['chat', 'chats'], group: ['groupe', 'groupes'], channel: ['canal', 'canaux'] },
}
const AND: Record<string, string> = { ru: ' и ', uk: ' і ', en: ' and ', es: ' y ', de: ' und ', fr: ' et ' }

function slavicIndex(n: number): number {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 0
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1
  return 2
}

export function countLabel(kind: Kind, n: number, lang: string): string {
  const forms = (FORMS[lang] ?? FORMS.en)[kind]
  const word = forms.length === 3 ? forms[slavicIndex(n)] : forms[n === 1 ? 0 : 1]
  return `${n} ${word}`
}

export function folderSubtitle(c: { chats: number; channels: number; groups: number }, lang: string): string {
  const parts: string[] = []
  if (c.chats) parts.push(countLabel('chat', c.chats, lang))
  if (c.channels) parts.push(countLabel('channel', c.channels, lang))
  if (c.groups) parts.push(countLabel('group', c.groups, lang))
  if (!parts.length) return countLabel('chat', 0, lang)
  if (parts.length === 1) return parts[0]
  const and = AND[lang] ?? AND.en
  return parts.slice(0, -1).join(', ') + and + parts[parts.length - 1]
}

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
