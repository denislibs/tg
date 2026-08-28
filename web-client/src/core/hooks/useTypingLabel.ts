import { useChatsStore } from '../../stores/chatsStore'
import { usePeers } from './usePeers'
import { useLang } from '../../i18n'
import type { SendMessageAction } from '../realtime/events'
import { getPeerTitle } from '../peers/getPeerTitle'

const TTL = 6000

// Per-language verb phrases + connectors. Kept local (like BirthdayModal) because
// grammatical singular/plural forms don't fit the flat key→string dictionary.
// Ключи — ДИСКРИМИНАТОРЫ конструкторов `SendMessageAction`: вид действия
// приезжает конструктором, и таблица фраз ключуется им же, без промежуточного
// словаря наших кодов.
type Phrases = Record<SendMessageAction['_'], [string, string]> & {
  and: string
  more: string // "<name> <more> <n> <verb-plural>"
}
const L: Record<string, Phrases> = {
  ru: { sendMessageTypingAction: ['печатает', 'печатают'], sendMessageRecordAudioAction: ['записывает голосовое', 'записывают голосовое'], sendMessageRecordVideoAction: ['записывает видео', 'записывают видео'], sendMessageUploadDocumentAction: ['отправляет файл', 'отправляют файл'], sendMessageUploadPhotoAction: ['отправляет фото', 'отправляют фото'], sendMessageUploadVideoAction: ['отправляет видео', 'отправляют видео'], sendMessageUploadAudioAction: ['отправляет аудио', 'отправляют аудио'], and: 'и', more: 'и ещё' },
  uk: { sendMessageTypingAction: ['друкує', 'друкують'], sendMessageRecordAudioAction: ['записує голосове', 'записують голосове'], sendMessageRecordVideoAction: ['записує відео', 'записують відео'], sendMessageUploadDocumentAction: ['надсилає файл', 'надсилають файл'], sendMessageUploadPhotoAction: ['надсилає фото', 'надсилають фото'], sendMessageUploadVideoAction: ['надсилає відео', 'надсилають відео'], sendMessageUploadAudioAction: ['надсилає аудіо', 'надсилають аудіо'], and: 'і', more: 'і ще' },
  en: { sendMessageTypingAction: ['is typing', 'are typing'], sendMessageRecordAudioAction: ['is recording voice', 'are recording voice'], sendMessageRecordVideoAction: ['is recording video', 'are recording video'], sendMessageUploadDocumentAction: ['is sending a file', 'are sending a file'], sendMessageUploadPhotoAction: ['is sending a photo', 'are sending a photo'], sendMessageUploadVideoAction: ['is sending a video', 'are sending a video'], sendMessageUploadAudioAction: ['is sending an audio', 'are sending an audio'], and: 'and', more: 'and' },
  es: { sendMessageTypingAction: ['está escribiendo', 'están escribiendo'], sendMessageRecordAudioAction: ['está grabando audio', 'están grabando audio'], sendMessageRecordVideoAction: ['está grabando vídeo', 'están grabando vídeo'], sendMessageUploadDocumentAction: ['está enviando un archivo', 'están enviando un archivo'], sendMessageUploadPhotoAction: ['está enviando una foto', 'están enviando una foto'], sendMessageUploadVideoAction: ['está enviando un vídeo', 'están enviando un vídeo'], sendMessageUploadAudioAction: ['está enviando un audio', 'están enviando un audio'], and: 'y', more: 'y' },
  de: { sendMessageTypingAction: ['tippt', 'tippen'], sendMessageRecordAudioAction: ['nimmt Sprachnachricht auf', 'nehmen Sprachnachricht auf'], sendMessageRecordVideoAction: ['nimmt Video auf', 'nehmen Video auf'], sendMessageUploadDocumentAction: ['sendet eine Datei', 'senden eine Datei'], sendMessageUploadPhotoAction: ['sendet ein Foto', 'senden ein Foto'], sendMessageUploadVideoAction: ['sendet ein Video', 'senden ein Video'], sendMessageUploadAudioAction: ['sendet eine Audiodatei', 'senden eine Audiodatei'], and: 'und', more: 'und' },
  fr: { sendMessageTypingAction: ['écrit', 'écrivent'], sendMessageRecordAudioAction: ['enregistre un audio', 'enregistrent un audio'], sendMessageRecordVideoAction: ['enregistre une vidéo', 'enregistrent une vidéo'], sendMessageUploadDocumentAction: ['envoie un fichier', 'envoient un fichier'], sendMessageUploadPhotoAction: ['envoie une photo', 'envoient une photo'], sendMessageUploadVideoAction: ['envoie une vidéo', 'envoient une vidéo'], sendMessageUploadAudioAction: ['envoie un audio', 'envoient un audio'], and: 'et', more: 'et' },
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
  const allSame = entries.every((e) => e.action._ === entries[0].action._)
  const action: SendMessageAction['_'] = allSame ? entries[0].action._ : 'sendMessageTypingAction'
  const verb = phrases[action]
  // Запись голосового/видео — мигающая точка; печать и аплоад — три точки.
  const kind: TypingKind = action === 'sendMessageRecordAudioAction' || action === 'sendMessageRecordVideoAction'
    ? 'record'
    : 'text'

  if (!isGroup) {
    return { active: true, label: verb[0], kind }
  }

  // Имя собирает клиент; карточки ещё нет — фолбэк оригинала внутри
  // `getPeerTitle` («Удалённый аккаунт»), а не пустая строка молча.
  const names = entries.map((e) => getPeerTitle({ peerId: e.userId, peer: peers.get(e.userId), onlyFirstName: true }))
  if (names.length === 1) return { active: true, label: `${names[0]} ${verb[0]}`, kind }
  if (names.length === 2) return { active: true, label: `${names[0]} ${phrases.and} ${names[1]} ${verb[1]}`, kind }
  return { active: true, label: `${names[0]} ${phrases.more} ${names.length - 1} ${verb[1]}`, kind }
}
