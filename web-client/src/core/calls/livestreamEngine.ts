// Движок RTMP-трансляций (Telegram livestream). В отличие от группового звонка
// (mesh WebRTC), трансляция — односторонний поток: один вещатель (через OBS →
// RTMP-сервер), много зрителей. Реального медиа-ingest в проекте нет, поэтому
// движок не поднимает WebRTC/getUserMedia: зритель лишь регистрируется как
// участник группового звонка (кадр group_call_join → бэк считает его зрителем и
// фанит счётчик), а сам просмотр — плейсхолдер с LIVE-бейджем.
//
// Старт/стоп трансляции идут REST'ом через managers.livestream (админ);
// старт/стоп прилетают всем членам чата кадром livestream_update.
import { useLivestreamStore } from '../../stores/livestreamStore'
import { startClient } from '../../client/bootstrap'

const store = () => useLivestreamStore.getState()
const managers = () => startClient().managers

export interface LivestreamFrame {
  t: string
  d: {
    peer_id: number
    action?: 'started' | 'stopped'
    active?: boolean
    viewers?: number
  }
}

/** Начать смотреть трансляцию: регистрируемся зрителем (без медиа). */
export function watchLivestream(peerId: number) {
  if (store().watchingPeerId != null) return
  store().setWatching(peerId)
  void managers().realtime.sendCallFrame({ type: 'group_call_join', data: { peer_id: peerId } })
}

/** Выйти из просмотра трансляции. */
export function leaveLivestream() {
  const peerId = store().watchingPeerId
  if (peerId == null) return
  void managers().realtime.sendCallFrame({ type: 'group_call_leave', data: { peer_id: peerId } })
  store().setWatching(null)
}

/** Входящие livestream_update кадры (из realtimeBridge). */
export function handleLivestreamFrame(evt: LivestreamFrame) {
  if (evt.t !== 'livestream_update') return
  const { peer_id, action } = evt.d
  const active = action === 'started'
  store().setActive(peer_id, active)
  // трансляция закончилась, а мы её смотрели — закрываем экран
  if (!active && store().watchingPeerId === peer_id) {
    store().setWatching(null)
  }
}
