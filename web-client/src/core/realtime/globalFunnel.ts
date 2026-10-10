// src/core/realtime/globalFunnel.ts
//
// Глобальный (пер-юзерный) pts-funnel — арифметика dup/next/gap + буфер придержанных
// кадров, вынесенная из createWorkerCore() (workerCore.ts; исторически — тело
// worker.ts) в модуль с явными зависимостями, той же формы, что и channelFunnel.ts.
// dispatch (реестр APPLY, routeNewMessage, broadcast) остаётся в workerCore.ts и
// приходит сюда зависимостью — funnel не знает про менеджеры.

import { classifyPts, type Cursor } from './cursor'
import { newPendingPts } from './pendingPts'
import { updateDate } from './updateCatalog'
import type { EventMeta } from '../../rpc/superMessagePort'

export interface GlobalFunnelDeps {
  /** Отражение апдейта в SSOT воркера + broadcast в вкладки (worker.dispatch).
   *  `key` — КОНСТРУКТОР кадра (см. updateCatalog.frameKey); воронка его не
   *  интерпретирует, а лишь передаёт дальше — её дело арифметика курсора. */
  dispatch: (key: string, d: unknown, meta?: EventMeta) => void
  cursor: Cursor                       // из './cursor'
  /** Курсор гидратирован из IDB (гейт перед первым apply). */
  isCursorReady: () => boolean
  /** Идёт ли catch-up (syncEngine.isSyncing). */
  isSyncing: () => boolean
  /** Запустить догон (syncEngine.getDifference). */
  catchUp: () => void
  /** Задержка перед уходом в catch-up при незакрытой дыре. */
  syncDelay?: number                   // по умолчанию 250 — текущее PTS_SYNC_DELAY
}

export function newGlobalFunnel(deps: GlobalFunnelDeps): {
  applyUpdate(key: string, pts: number | undefined, d: unknown): void
  clear(): void
} {
  // Буфер out-of-order живых кадров (порт pendingPtsUpdates tweb). Дыру в pts не
  // гоним сразу в getDifference — придерживаем кадр и ждём, пока её закроют следующие живые
  // кадры (наш источник переупорядочивания — async-decrypt секретов, см. onFrame).
  const pendingPts = newPendingPts()
  // tweb: SYNC_DELAY=6мс — там апдейты синхронны, «дырка» закрывается в том же тике.
  // У нас переупорядочивание даёт асинхронная расшифровка (WebCrypto, десятки мс),
  // поэтому ждём дольше, прежде чем уйти в catch-up. Реальную потерю кадра (publish
  // упал) буфер пересидеть не сможет — по таймауту чистимся и добираем getDifference.
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
      deps.dispatch(item.key, item.d, { pts: item.pts, catchUp: false })
      deps.cursor.advance(item.pts, updateDate(item.d))
    })
    if (!pendingPts.has() && ptsSyncTimer) { clearTimeout(ptsSyncTimer); ptsSyncTimer = null }
  }

  // Живой кадр (WS) — tweb `processUpdate` для пер-юзерного состояния.
  // Арифметика курсора: dup→drop, next→apply+advance, gap→буфер. Разница
  // (`updates.getDifference`) сюда не заходит: её апдейты применяются как есть
  // (tweb `saveUpdate`), а курсор ставит её state (syncEngine).
  //
  // Без pts кадр не гейтится вовсе — и это не «устаревший бэк», а СТРУКТУРА:
  // у части конструкторов (updateUserTyping, updateUserStatus) параметра pts
  // нет, потому что курсор им не нужен.
  function applyUpdate(key: string, pts: number | undefined, d: unknown): void {
    // Курсора нет — гейтить нечем и незачем: транслируем как есть.
    if (typeof pts !== 'number') { deps.dispatch(key, d); return }
    // Гейт гидратации: до загрузки курсора из IDB не применяем вслепую — догон
    // (он ждёт cursor.ready()) добёрет по порядку.
    if (!deps.isCursorReady()) { deps.catchUp(); return }
    // Гейт syncLoading: пока идёт догон, живые кадры с pts отбрасываем — разница
    // переотдаст их по порядку; после неё pts===cursor+1 продолжит live.
    if (deps.isSyncing()) return
    const cls = classifyPts(deps.cursor.get().pts, pts)
    if (cls === 'dup') return
    if (cls === 'gap') {
      // Out-of-order живой кадр: буферизуем и ждём, что дыру закроют следующие
      // кадры (тогда drainPending применит по порядку без round-trip). Переполнение
      // буфера — дыра слишком велика, чтобы пересидеть → сразу догон.
      if (!pendingPts.push({ key, pts, d })) { clearPtsSync(); deps.catchUp(); return }
      schedulePtsSync()
      return
    }
    deps.dispatch(key, d, { pts, catchUp: false })
    // Дата состояния двигается применённым кадром (tweb :736-738, :774-776):
    // от неё сервер решает, какие каналы клиент пропустил
    // (updateChannelTooLong), и без неё каждый реконнект отдавал маркеры по
    // всем каналам, получившим посты живьём.
    deps.cursor.advance(pts, updateDate(d))
    drainPending()
  }

  return {
    applyUpdate,
    clear: clearPtsSync,
  }
}
export type GlobalFunnel = ReturnType<typeof newGlobalFunnel>
