// src/core/hooks/useVoiceQueue.ts
//
// Builds the chat's voice/audio play queue for the global player (in chat order):
// playing one lets the now-playing bar step prev/next through the rest. Also
// reports the player offset the conversation uses to slide the header/feed down
// while the now-playing plate is showing.
import { useMemo } from 'react'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { markMediaPlayed } from '../mediaRead'
import { friendlyMsgTime } from '../format/friendlyTime'
import { peersKey } from './usePeers'
import type { Peer } from '../managers/peersManager'
import type { MessageWindow } from './useMessageWindow'

interface UseVoiceQueueArgs {
  win: MessageWindow
  isRealChat: boolean
  meId: number | null
  meName?: string
  peers: Map<number, Peer>
  chatName: string
  numericChatId: number
  lang: string
}

export function useVoiceQueue({ win, isRealChat, meId, meName, peers, chatName, numericChatId, lang }: UseVoiceQueueArgs): {
  playVoice: (mediaId: number) => void
  attachRound: (msgId: number, el: HTMLMediaElement) => void
} {
  const playQueue = useAudioStore((s) => s.playQueue)
  const playExternal = useAudioStore((s) => s.playExternal)
  // Секретный голос: сырой store-type остаётся 'encrypted' (воркер меняет только
  // secret_media, не type), вид лежит в secretMedia.mediaType. Учитываем оба.
  const isVoiceMsg = (m: MessageWindow['msgs'][number]) =>
    !!m.mediaId && (m.type === 'voice' || m.secretMedia?.mediaType === 'voice')
  const isRoundMsg = (m: MessageWindow['msgs'][number]) => !!m.mediaId && m.type === 'roundVideo'
  // Голосовые и кружки — ОДНА очередь (tweb: и те и другие ищутся фильтром
  // inputMessagesFilterRoundVoice, chat/bubbles.ts:8564,8601), поэтому доиграв
  // голосовое, плеер едет на следующий кружок и наоборот. Музыка — своя очередь
  // (inputMessagesFilterMusic), её собирают SearchView/SharedMedia.
  const voiceTracks: AudioTrack[] = useMemo(
    () =>
      (isRealChat ? win.msgs : [])
        .filter((m) => isVoiceMsg(m) || isRoundMsg(m))
        .map((m) => ({
          mediaId: m.mediaId as number,
          title: m.senderId === meId ? meName || 'Вы' : peers.get(m.senderId)?.displayName || chatName,
          subtitle: friendlyMsgTime(m.createdAt, lang),
          chatId: numericChatId,
          msgId: m.id,
          type: (m.type === 'roundVideo' ? 'round' : 'voice') as 'round' | 'voice',
          // Секретный голос: ключ/iv/mime для расшифровки ciphertext'а в плеере.
          secret: m.secretMedia
            ? { keyB64: m.secretMedia.keyB64, ivB64: m.secretMedia.ivB64, mime: m.secretMedia.mime }
            : undefined,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win.msgs, isRealChat, chatName, numericChatId, meId, meName, peersKey(win.msgs.map((m) => m.senderId)), lang],
  )
  const playVoice = (mediaId: number) => {
    const idx = voiceTracks.findIndex((t) => t.mediaId === mediaId)
    if (idx < 0) return
    playQueue(voiceTracks, idx)
    // Чужое непрослушанное голосовое → снять media_unread (tweb readMessageContents).
    const msg = win.msgs.find((m) => isVoiceMsg(m) && m.mediaId === mediaId)
    if (msg && msg.senderId !== meId && msg.mediaUnread) markMediaPlayed(numericChatId, msg.id)
  }

  // Кружок заиграл со звуком → зарегистрировать его <video> в глобальном плеере
  // (tweb: round идёт через appMediaPlaybackController и pinned-плашку). Отдаём ту
  // же очередь voice+round, что и у голосовых, — с позицией этого кружка.
  const attachRound = (msgId: number, el: HTMLMediaElement) => {
    const m = win.msgs.find((x) => x.id === msgId && x.type === 'roundVideo')
    if (!m || m.mediaId == null) return
    const idx = voiceTracks.findIndex((t) => t.mediaId === m.mediaId)
    if (idx < 0) return
    playExternal(voiceTracks, idx, el)
  }

  // Сдвиг топбара/ленты под плашку плеера — на CSS: NowPlayingBar ставит
  // body.is-pinned-audio-shown, а --topbar-floating-audio-height двигает топбар
  // (styles/tweb/_chatTopbar.scss) и растит --chat-padding-top.
  return { playVoice, attachRound }
}
