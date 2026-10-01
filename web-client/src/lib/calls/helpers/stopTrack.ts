// Порт tweb/src/lib/calls/helpers/stopTrack.ts:1-6 (812502980) — дословно:
// `stop()` не рождает `ended` у самого трека, а подписчики (превью, звонок)
// ждут именно его.
import simulateEvent from '@helpers/dom/dispatchEvent'

export default function stopTrack(track: MediaStreamTrack) {
  track.stop()
  simulateEvent(track, 'ended')
}
