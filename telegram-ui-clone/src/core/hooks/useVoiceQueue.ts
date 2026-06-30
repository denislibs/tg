// src/core/hooks/useVoiceQueue.ts
//
// Builds the chat's voice/audio play queue for the global player (in chat order):
// playing one lets the now-playing bar step prev/next through the rest. Also
// reports the player offset the conversation uses to slide the header/feed down
// while the now-playing plate is showing.
import { useMemo } from 'react'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
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
  playerOffset: number
} {
  const playQueue = useAudioStore((s) => s.playQueue)
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
    if (idx >= 0) playQueue(voiceTracks, idx)
  }

  // When the global player is showing, push the floating header + feed down so it
  // slides in above the conversation instead of overlapping it.
  const nowPlayingActive = useAudioStore((s) => !!s.track)
  const playerOffset = nowPlayingActive ? 56 : 0 // plate height (48) + gap (8)

  return { playVoice, playerOffset }
}
