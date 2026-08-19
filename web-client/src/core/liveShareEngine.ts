// Императивный lifecycle трансляции геопозиции (live location) со стороны отправителя:
// watchPosition → периодический updateGeoLive → авто-стоп по истечении срока. Сеть
// и таймеры/геоwatch живут здесь (как callEngine), а не в сторе. Состояние активных
// трансляций (по чату) — в liveShareStore (чистое, для кнопки «Остановить» и бабла).
import type { Managers } from '../client/bootstrap'
import { useLiveShareStore } from '../stores/liveShareStore'

const MIN_POST_INTERVAL = 15_000 // не чаще раза в 15с (как Telegram)

interface Runtime {
  watchId: number
  timer: ReturnType<typeof setTimeout>
  lastPost: number
  lastLat: number
  lastLng: number
}

const runtime = new Map<number, Runtime>() // by peerId

export function startLiveShare(managers: Managers, peerId: number, msgId: number, until: number): void {
  // снять предыдущую трансляцию в этом чате без финального stop
  const prev = runtime.get(peerId)
  if (prev) {
    navigator.geolocation?.clearWatch(prev.watchId)
    clearTimeout(prev.timer)
    runtime.delete(peerId)
  }
  if (!navigator.geolocation) return

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const rt = runtime.get(peerId)
      if (!rt) return
      rt.lastLat = pos.coords.latitude
      rt.lastLng = pos.coords.longitude
      if (Date.now() - rt.lastPost < MIN_POST_INTERVAL) return
      rt.lastPost = Date.now()
      const heading = pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? Math.round(pos.coords.heading) : undefined
      void managers.messages.updateGeoLive(peerId, msgId, pos.coords.latitude, pos.coords.longitude, { heading })
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000 },
  )
  const timer = setTimeout(() => stopLiveShare(managers, peerId), Math.max(0, until - Date.now()))
  runtime.set(peerId, { watchId, timer, lastPost: 0, lastLat: 0, lastLng: 0 })
  useLiveShareStore.getState().setActive(peerId, { msgId, until })
}

export function stopLiveShare(managers: Managers, peerId: number): void {
  const rt = runtime.get(peerId)
  const share = useLiveShareStore.getState().active[peerId]
  if (rt) {
    navigator.geolocation?.clearWatch(rt.watchId)
    clearTimeout(rt.timer)
    runtime.delete(peerId)
    // финальный кадр «трансляция остановлена» с последними координатами
    if (share && rt.lastLat !== 0) {
      void managers.messages.updateGeoLive(peerId, share.msgId, rt.lastLat, rt.lastLng, { stopped: true })
    }
  }
  useLiveShareStore.getState().clearActive(peerId)
}
