// src/core/realtime/globalFunnel.ts
//
// Глобальный (пер-юзерный) pts-funnel — арифметика dup/next/gap + буфер придержанных
// кадров, вынесенная из createWorkerCore() (workerCore.ts; исторически — тело
// worker.ts) в модуль с явными зависимостями, той же формы, что и channelFunnel.ts.
// dispatch (реестр APPLY, routeNewMessage, broadcast) остаётся в workerCore.ts и
// приходит сюда зависимостью — funnel не знает про менеджеры.

import { classifyPts, type Cursor } from './cursor'
import { newPendingPts } from './pendingPts'
import type { EventMeta } from '../../rpc/superMessagePort'

export interface GlobalFunnelDeps {
  /** Отражение апдейта в SSOT воркера + broadcast в вкладки (worker.dispatch). */
  dispatch: (t: string, d: unknown, meta?: EventMeta) => void
  cursor: Cursor                       // из './cursor'
  /** Курсор гидратирован из IDB (гейт перед первым apply). */
  isCursorReady: () => boolean
  /** Идёт ли catch-up (syncEngine.isSyncing). */
  isSyncing: () => boolean
  /** Запустить catch-up (syncEngine.catchUp). */
  catchUp: () => void
  /** Задержка перед уходом в catch-up при незакрытой дыре. */
  syncDelay?: number                   // по умолчанию 250 — текущее PTS_SYNC_DELAY
}

export function newGlobalFunnel(deps: GlobalFunnelDeps): {
  applyUpdate(t: string, pts: number | undefined, d: unknown, live: boolean): void
  clear(): void
} {
  // Буфер out-of-order живых кадров (порт pendingPtsUpdates tweb). Дыру в pts не
  // гоним сразу в /sync — придерживаем кадр и ждём, пока её закроют следующие живые
  // кадры (наш источник переупорядочивания — async-decrypt секретов, см. onFrame).
  const pendingPts = newPendingPts()
  // tweb: SYNC_DELAY=6мс — там апдейты синхронны, «дырка» закрывается в том же тике.
  // У нас переупорядочивание даёт асинхронная расшифровка (WebCrypto, десятки мс),
  // поэтому ждём дольше, прежде чем уйти в catch-up. Реальную потерю кадра (publish
  // упал) буфер пересидеть не сможет — по таймауту чистимся и добираем через /sync.
  const syncDelay = deps.syncDelay ?? 250
  let ptsSyncTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePtsSync(): void {
    if (ptsSyncTimer) return
    ptsSyncTimer = setTimeout(() => {
      ptsSyncTimer = null
      if (!pendingPts.has()) return
      pendingPts.clear()      // как tweb: getDifference сбрасывает pendingPtsUpdates
      deps.catchUp()
    }, syncDelay)
  }
  function clearPtsSync(): void {
    if (ptsSyncTimer) { clearTimeout(ptsSyncTimer); ptsSyncTimer = null }
    pendingPts.clear()
  }
  // Слить подряд идущие буферные кадры после того, как живой next закрыл дыру.
  function drainPending(): void {
    if (!pendingPts.has()) return
    pendingPts.drain(() => deps.cursor.get().pts, (item) => {
      // Кадр в буфере — живой (пришёл по WS, лишь придержан переупорядочиванием),
      // поэтому catchUp:false — происхождение не меняется от факта буферизации.
      deps.dispatch(item.t, item.d, { pts: item.pts, catchUp: false })
      deps.cursor.advance(item.pts)
    })
    if (!pendingPts.has() && ptsSyncTimer) { clearTimeout(ptsSyncTimer); ptsSyncTimer = null }
  }

  // Единый funnel. live=true — WS-кадр (pts внутри payload), live=false — элемент /sync
  // (pts сверху). Арифметика курсора: dup→drop, next→apply+advance, gap(live)→буфер.
  function applyUpdate(t: string, pts: number | undefined, d: unknown, live: boolean): void {
    // Без pts — эфемерный/устаревший бэк: транслируем как есть, не гейтим.
    if (typeof pts !== 'number') { deps.dispatch(t, d); return }
    if (live) {
      // Гейт гидратации: до загрузки курсора из IDB не применяем вслепую — catch-up
      // (он ждёт cursor.ready()) добёрет по порядку.
      if (!deps.isCursorReady()) { deps.catchUp(); return }
      // Гейт syncLoading: пока идёт catch-up, живые кадры с pts отбрасываем — diff
      // переотдаст их по порядку; после catch-up pts===cursor+1 продолжит live.
      if (deps.isSyncing()) return
      const cls = classifyPts(deps.cursor.get().pts, pts)
      if (cls === 'dup') return
      if (cls === 'gap') {
        // Out-of-order живой кадр: буферизуем и ждём, что дыру закроют следующие
        // кадры (тогда drainPending применит по порядку без round-trip). Переполнение
        // буфера — дыра слишком велика, чтобы пересидеть → сразу catch-up.
        if (!pendingPts.push({ t, pts, d })) { clearPtsSync(); deps.catchUp(); return }
        schedulePtsSync()
        return
      }
      deps.dispatch(t, d, { pts, catchUp: false })
      deps.cursor.advance(pts)
      drainPending()
      return
    }
    // /sync-путь: применяем строго вперёд, дубли (уже применённые live) отсекаем.
    if (classifyPts(deps.cursor.get().pts, pts) === 'dup') return
    deps.dispatch(t, d, { pts, catchUp: true })
    deps.cursor.advance(pts)
  }

  return {
    applyUpdate,
    clear: clearPtsSync,
  }
}
export type GlobalFunnel = ReturnType<typeof newGlobalFunnel>
