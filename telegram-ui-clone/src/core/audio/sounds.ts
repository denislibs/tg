// Central UI sound registry. Asset names + files mirror tweb's set 1:1 (copied
// into public/assets/audio). Lazily constructs a single AudioAssetPlayer.

import AudioAssetPlayer from './audioAssetPlayer'

// name → file in public/assets/audio (tweb's full set).
export const SOUND_ASSETS = {
  message_sent: 'message_sent.mp3',
  notification: 'notification.mp3',
  call_incoming: 'call_incoming.mp3',
  call_outgoing: 'call_outgoing.mp3',
  call_connect: 'call_connect.mp3',
  call_end: 'call_end.mp3',
  call_busy: 'call_busy.mp3',
  voip_connecting: 'voip_connecting.mp3',
  voip_recordstart: 'voip_recordstart.mp3',
  voip_failed: 'voip_failed.mp3',
  voip_onallowtalk: 'voip_onallowtalk.mp3',
  group_call_start: 'group_call_start.mp3',
  group_call_connect: 'group_call_connect.mp3',
  group_call_end: 'group_call_end.mp3',
} as const

export type SoundName = keyof typeof SOUND_ASSETS

let player: AudioAssetPlayer<typeof SOUND_ASSETS> | undefined
function get() {
  if (!player) player = new AudioAssetPlayer(SOUND_ASSETS)
  return player
}

// "pak" on a message we sent — quiet + throttled, exactly like tweb
// (volume 0.2, 300ms throttle so a burst collapses to one).
export function playMessageSent(): void {
  get().playWithThrottle({ name: 'message_sent', volume: 0.2 }, 300)
}

// Incoming message that warrants a notification (caller decides the gating:
// not our own message, not the focused chat, not muted).
export function playIncoming(): void {
  get().playWithThrottle({ name: 'notification', volume: 0.5 }, 300)
}

// Generic escape hatch for call/voip tones.
export function playSound(name: SoundName, opts?: { loop?: boolean; volume?: number }): void {
  get().play({ name, ...opts })
}

export function stopSound(): void {
  get().stop()
}
