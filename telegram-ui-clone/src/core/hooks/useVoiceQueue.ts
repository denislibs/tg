// src/core/hooks/useVoiceQueue.ts
//
// Builds the chat's voice/audio play queue for the global player (in chat order):
// playing one lets the now-playing bar step prev/next through the rest. Also
// reports the player offset the conversation uses to slide the header/feed down
// while the now-playing plate is showing.
import { useMemo } from 'react'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { markMediaPlayed } from '../mediaRead'
import { friendlyMsgTime } from '../friendlyTime'
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
  playerOffset: number
} {
  const playQueue = useAudioStore((s) => s.playQueue)
  const playExternal = useAudioStore((s) => s.playExternal)
  const voiceTracks: AudioTrack[] = useMemo(
    () =>
      (isRealChat ? win.msgs : [])
        .filter((m) => m.type === 'voice' && m.mediaId)
        .map((m) => ({
          mediaId: m.mediaId as number,
          title: m.senderId === meId ? meName || 'Вы' : peers.get(m.senderId)?.displayName || chatName,
          subtitle: friendlyMsgTime(m.createdAt, lang),
          chatId: numericChatId,
          msgId: m.id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win.msgs, isRealChat, chatName, numericChatId, meId, meName, peersKey(win.msgs.map((m) => m.senderId)), lang],
  )
  const playVoice = (mediaId: number) => {
    const idx = voiceTracks.findIndex((t) => t.mediaId === mediaId)
    if (idx < 0) return
    playQueue(voiceTracks, idx)
    // Чужое непрослушанное голосовое → снять media_unread (tweb readMessageContents).
    const msg = win.msgs.find((m) => m.type === 'voice' && m.mediaId === mediaId)
    if (msg && msg.senderId !== meId && msg.mediaUnread) markMediaPlayed(numericChatId, msg.id)
  }

  // Кружок заиграл со звуком → зарегистрировать его <video> в глобальном плеере
  // (tweb: round идёт через appMediaPlaybackController и pinned-плашку).
  const attachRound = (msgId: number, el: HTMLMediaElement) => {
    const m = win.msgs.find((x) => x.id === msgId && x.type === 'roundVideo')
    if (!m || m.mediaId == null) return
    playExternal(
      {
        mediaId: m.mediaId,
        title: m.senderId === meId ? meName || 'Вы' : peers.get(m.senderId)?.displayName || chatName,
        subtitle: friendlyMsgTime(m.createdAt, lang),
        chatId: numericChatId,
        msgId: m.id,
      },
      el,
    )
  }

  // When the global player is showing, push the floating header + feed down so it
  // slides in above the conversation instead of overlapping it.
  const nowPlayingActive = useAudioStore((s) => !!s.track)
  const playerOffset = nowPlayingActive ? 56 : 0 // plate height (48) + gap (8)

  return { playVoice, attachRound, playerOffset }
}
