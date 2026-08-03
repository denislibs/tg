// Данные фильтров поиска в чате (tweb topbarSearch) + тип строки результата.
// Общий модуль для useChatHeaderSearch (логика) и ChatSearchCard (UI) — без цикла.
import type { IconName } from '../TgIcon'
import type { SearchMediaType } from '../../core/hooks/useChatSearch'

// Виды медиа для фильтра «Тип» (tweb inputMessagesFilter*): значение → иконка + ключ подписи.
export const MEDIA_TYPES: { value: SearchMediaType; icon: IconName; labelKey: string }[] = [
  { value: 'photo', icon: 'image', labelKey: 'Photos' },
  { value: 'video', icon: 'videocamera_filled', labelKey: 'Videos' },
  { value: 'file', icon: 'document', labelKey: 'Files' },
  { value: 'music', icon: 'music', labelKey: 'Music' },
  { value: 'voice', icon: 'microphone_filled', labelKey: 'Voice messages' },
  { value: 'roundvideo', icon: 'videocamera_filled', labelKey: 'Round videos' },
  { value: 'link', icon: 'link', labelKey: 'Links' },
]

// Быстрый набор реакций для фильтра «По реакции» (упрощение vs saved reaction tags tweb).
export const REACTION_SET = ['👍', '👎', '❤️', '🔥', '🎉', '😁', '😢', '🤔']

// Display-ready in-chat search hit (sender name + time resolved by the hook, so the
// card needs no peers/meId/lang knowledge).
export interface SearchResultRow {
  id: number
  seq: number
  sender: string
  avatar: string // gradient background for the sender's avatar
  time: string
  text: string
  mediaId?: number // for media hits: show a type icon + file name as the preview
  mediaType?: string // photo | video | audio | voice | document | roundVideo | …
}
