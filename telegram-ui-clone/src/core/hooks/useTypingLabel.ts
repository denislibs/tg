import { useChatsStore } from '../../stores/chatsStore'
import { usePeers } from './usePeers'
import { useLang } from '../../i18n'
import type { TypingAction } from '../realtime/events'

const TTL = 6000

// Per-language verb phrases + connectors. Kept local (like BirthdayModal) because
// grammatical singular/plural forms don't fit the flat key→string dictionary.
type Phrases = {
  typing: [string, string]
  voice: [string, string]
  video: [string, string]
  // На время аплоада медиа (tweb sendMessageUpload*Action)
  upload_file: [string, string]
  upload_photo: [string, string]
  upload_video: [string, string]
  upload_audio: [string, string]
  and: string
  more: string // "<name> <more> <n> <verb-plural>"
}
const L: Record<string, Phrases> = {
  ru: { typing: ['печатает', 'печатают'], voice: ['записывает голосовое', 'записывают голосовое'], video: ['записывает видео', 'записывают видео'], upload_file: ['отправляет файл', 'отправляют файл'], upload_photo: ['отправляет фото', 'отправляют фото'], upload_video: ['отправляет видео', 'отправляют видео'], upload_audio: ['отправляет аудио', 'отправляют аудио'], and: 'и', more: 'и ещё' },
  uk: { typing: ['друкує', 'друкують'], voice: ['записує голосове', 'записують голосове'], video: ['записує відео', 'записують відео'], upload_file: ['надсилає файл', 'надсилають файл'], upload_photo: ['надсилає фото', 'надсилають фото'], upload_video: ['надсилає відео', 'надсилають відео'], upload_audio: ['надсилає аудіо', 'надсилають аудіо'], and: 'і', more: 'і ще' },
  en: { typing: ['is typing', 'are typing'], voice: ['is recording voice', 'are recording voice'], video: ['is recording video', 'are recording video'], upload_file: ['is sending a file', 'are sending a file'], upload_photo: ['is sending a photo', 'are sending a photo'], upload_video: ['is sending a video', 'are sending a video'], upload_audio: ['is sending an audio', 'are sending an audio'], and: 'and', more: 'and' },
  es: { typing: ['está escribiendo', 'están escribiendo'], voice: ['está grabando audio', 'están grabando audio'], video: ['está grabando vídeo', 'están grabando vídeo'], upload_file: ['está enviando un archivo', 'están enviando un archivo'], upload_photo: ['está enviando una foto', 'están enviando una foto'], upload_video: ['está enviando un vídeo', 'están enviando un vídeo'], upload_audio: ['está enviando un audio', 'están enviando un audio'], and: 'y', more: 'y' },
  de: { typing: ['tippt', 'tippen'], voice: ['nimmt Sprachnachricht auf', 'nehmen Sprachnachricht auf'], video: ['nimmt Video auf', 'nehmen Video auf'], upload_file: ['sendet eine Datei', 'senden eine Datei'], upload_photo: ['sendet ein Foto', 'senden ein Foto'], upload_video: ['sendet ein Video', 'senden ein Video'], upload_audio: ['sendet eine Audiodatei', 'senden eine Audiodatei'], and: 'und', more: 'und' },
  fr: { typing: ['écrit', 'écrivent'], voice: ['enregistre un audio', 'enregistrent un audio'], video: ['enregistre une vidéo', 'enregistrent une vidéo'], upload_file: ['envoie un fichier', 'envoient un fichier'], upload_photo: ['envoie une photo', 'envoient une photo'], upload_video: ['envoie une vidéo', 'envoient une vidéo'], upload_audio: ['envoie un audio', 'envoient un audio'], and: 'et', more: 'et' },
}

// 'text' → three bouncing dots (typing); 'record' → one blinking dot (recording
// voice or round video). Maps to tweb's .peer-typing-text / .peer-typing-record.
export type TypingKind = 'text' | 'record'

export interface TypingLabel {
  active: boolean
  label: string
  kind: TypingKind
}

// Resolves the live "is typing / recording…" label for a chat, with group
// batching ("Игорь и ещё 2 печатают") and action variants (text/voice/video).
// For private chats it's just the verb (the name is already the chat title).
export function useTypingLabel(chatId: number, isGroup: boolean): TypingLabel {
  const [lang] = useLang()
  const phrases = L[lang] ?? L.en
  const chatTyping = useChatsStore((s) => s.typing[chatId])

  const now = Date.now()
  const entries = chatTyping
    ? Object.entries(chatTyping)
        .filter(([, e]) => now - e.at < TTL)
        .map(([uid, e]) => ({ userId: Number(uid), action: e.action }))
    : []

  // Resolve names only for groups (private uses the verb alone). usePeers([]) no-ops.
  const peers = usePeers(isGroup ? entries.map((e) => e.userId) : [])

  if (!entries.length) return { active: false, label: '', kind: 'text' }

  // Pick a verb: the shared action when everyone does the same, else plain typing.
  const allSame = entries.every((e) => e.action === entries[0].action)
  const action: TypingAction = allSame ? entries[0].action : 'typing'
  const verb = phrases[action]
  // voice/video share the blinking-dot indicator; typing/upload get the three dots.
  const kind: TypingKind = action === 'voice' || action === 'video' ? 'record' : 'text'

  if (!isGroup) {
    return { active: true, label: verb[0], kind }
  }

  const names = entries.map((e) => peers.get(e.userId)?.displayName || '…')
  if (names.length === 1) return { active: true, label: `${names[0]} ${verb[0]}`, kind }
  if (names.length === 2) return { active: true, label: `${names[0]} ${phrases.and} ${names[1]} ${verb[1]}`, kind }
  return { active: true, label: `${names[0]} ${phrases.more} ${names.length - 1} ${verb[1]}`, kind }
}
