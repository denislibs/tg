// src/core/realtime/pendingPts.ts
//
// Ограниченный буфер out-of-order живых кадров realtime-контракта — порт
// `pendingPtsUpdates` из tweb (`apiUpdatesManager.ts`). Когда живой кадр приходит
// с дырой (pts > cursor+1), вместо немедленного /sync мы придерживаем его здесь и
// ждём, пока дыру закроют следующие живые кадры (тогда дренажим по порядку без
// round-trip). Если дыра не закрылась за отведённое время — funnel уходит в
// точечный catch-up (`getDifference` в терминах tweb), а буфер сбрасывается.
//
// Контракт одиночного писателя даёт `pts_count === 1`, поэтому «contiguous» из
// tweb (`curPts += pts_count`) вырождается в «pts === cursor+1»: дренаж применяет
// подряд идущие pts, пока в буфере есть ровно следующий.
//
// Источник переупорядочивания у нас — асинхронная расшифровка секретных сообщений
// в воркере (`worker.ts`: два concurrent decrypt резолвятся не в порядке pts).
// Модуль чистый (без таймеров) — таймаут/фолбэк на catch-up держит вызывающий.

export interface PendingItem { t: string; pts: number; d: unknown }

export interface PendingPts {
  /**
   * Придержать out-of-order кадр (pts > cursor+1). Дедуп по pts (тот же кадр мог
   * прийти повторно). Возвращает false, если буфер переполнен, — вызывающему это
   * сигнал уйти в catch-up (дыра слишком большая, чтобы её пересидеть).
   */
  push(item: PendingItem): boolean
  /**
   * Слить подряд идущие кадры начиная с cursor+1. `getCursor` читается заново перед
   * каждым шагом (apply двигает курсор на +1), `apply` применяет кадр. Кадры с
   * pts <= cursor отбрасываются как дубли (курсор их уже прошёл через catch-up),
   * на первой же дыре дренаж останавливается — остаток ждёт в буфере.
   */
  drain(getCursor: () => number, apply: (item: PendingItem) => void): void
  /** Сброс буфера (catch-up / полный resync — как tweb чистит pendingPtsUpdates в getDifference). */
  clear(): void
  size(): number
  has(): boolean
}

export function newPendingPts(max = 512): PendingPts {
  let buf: PendingItem[] = []
  return {
    push(item) {
      if (buf.length >= max) return false
      if (buf.some((x) => x.pts === item.pts)) return true // дубль out-of-order
      buf.push(item)
      return true
    },
    drain(getCursor, apply) {
      if (!buf.length) return
      buf.sort((a, b) => a.pts - b.pts)
      let i = 0
      for (; i < buf.length; i++) {
        const cur = getCursor()
        if (buf[i].pts <= cur) continue      // дубль: курсор уже прошёл этот pts → выбросить
        if (buf[i].pts !== cur + 1) break    // дыра ещё есть → оставить остаток в буфере
        apply(buf[i])                        // apply двигает курсор на +1
      }
      buf = buf.slice(i)
    },
    clear() { buf = [] },
    size() { return buf.length },
    has() { return buf.length > 0 },
  }
}

export type NewPendingPts = ReturnType<typeof newPendingPts>
