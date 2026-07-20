// Трансляция геопозиции (live location) со стороны отправителя: watchPosition →
// периодический POST /geo_live, авто-стоп по истечении срока. Состояние активных
// трансляций (по чату) — для кнопки «Остановить» и отметки в бабле. Геоwatch-ер
// и таймеры живут в модульных ref'ах (не в состоянии стора).
import { create } from 'zustand'
import type { Managers } from '../client/bootstrap'

const MIN_POST_INTERVAL = 15_000 // не чаще раза в 15с (как Telegram)

interface ActiveShare {
  msgId: number
  until: number // unix ms — когда трансляция закончится
}

interface Runtime {
  watchId: number
  timer: ReturnType<typeof setTimeout>
  lastPost: number
  lastLat: number
  lastLng: number
}

const runtime = new Map<number, Runtime>() // by chatId

interface LiveShareState {
  active: Record<number, ActiveShare>
  start: (managers: Managers, chatId: number, msgId: number, until: number) => void
  stop: (managers: Managers, chatId: number) => void
}

export const useLiveShareStore = create<LiveShareState>((set, get) => ({
  active: {},

  start: (managers, chatId, msgId, until) => {
    // снять предыдущую трансляцию в этом чате без финального stop
    const prev = runtime.get(chatId)
    if (prev) {
      navigator.geolocation?.clearWatch(prev.watchId)
      clearTimeout(prev.timer)
      runtime.delete(chatId)
    }
    if (!navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rt = runtime.get(chatId)
        if (!rt) return
        rt.lastLat = pos.coords.latitude
        rt.lastLng = pos.coords.longitude
        if (Date.now() - rt.lastPost < MIN_POST_INTERVAL) return
        rt.lastPost = Date.now()
        const heading = pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? Math.round(pos.coords.heading) : undefined
        void managers.messages.updateGeoLive(chatId, msgId, pos.coords.latitude, pos.coords.longitude, { heading })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 },
    )
    const timer = setTimeout(() => get().stop(managers, chatId), Math.max(0, until - Date.now()))
    runtime.set(chatId, { watchId, timer, lastPost: 0, lastLat: 0, lastLng: 0 })
    set((s) => ({ active: { ...s.active, [chatId]: { msgId, until } } }))
  },

  stop: (managers, chatId) => {
    const rt = runtime.get(chatId)
    const share = get().active[chatId]
    if (rt) {
      navigator.geolocation?.clearWatch(rt.watchId)
      clearTimeout(rt.timer)
      runtime.delete(chatId)
      // финальный кадр «трансляция остановлена» с последними координатами
      if (share && rt.lastLat !== 0) {
        void managers.messages.updateGeoLive(chatId, share.msgId, rt.lastLat, rt.lastLng, { stopped: true })
      }
    }
    set((s) => {
      const next = { ...s.active }
      delete next[chatId]
      return { active: next }
    })
  },
}))
