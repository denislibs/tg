// src/core/realtime/pendingPts.ts
//
// Ограниченный буфер out-of-order живых кадров realtime-контракта — порт
// `pendingPtsUpdates` из tweb (`apiUpdatesManager.ts`). Когда живой кадр приходит
// с дырой (pts > cursor+1), вместо немедленного getDifference мы придерживаем его здесь и
// ждём, пока дыру закроют следующие живые кадры (тогда дренажим по порядку без
// round-trip). Если дыра не закрылась за отведённое время — funnel уходит в
// точечный catch-up (`getDifference` в терминах tweb), а буфер сбрасывается.
//
// «Contiguous» из tweb (`curPts + pts_count >= pts`) считается по `ptsCount`
// элемента: у живого журнального кадра он 1, у местного `updatePts` (ответ на
// очистку истории) — число строк журнала, которые операция записала.
//
// Источник переупорядочивания у нас — асинхронная расшифровка секретных сообщений
// в воркере (`workerCore.ts`: два concurrent decrypt резолвятся не в порядке pts).
// Модуль чистый (без таймеров) — таймаут/фолбэк на catch-up держит вызывающий.

export interface PendingItem {
  key: string
  pts: number
  /** Сколько pts занимает элемент (по умолчанию 1; tweb `pts_count`). */
  ptsCount?: number
  d: unknown
}

/** Ключ местного updatePts: двигает курсор и ничего не диспатчит. */
export const LOCAL_PTS_KEY = 'updatePts'

export interface PendingPts {
  /**
   * Придержать out-of-order кадр (дыра). Дедуп по pts (тот же кадр мог прийти
   * повторно); местный updatePts заменяет лежащий с тем же pts: живой кадр при
   * сливе всё равно выбрасывается, а updatePts несёт нужный ptsCount.
   * Возвращает false, если буфер переполнен, — вызывающему это
   * сигнал уйти в catch-up (дыра слишком большая, чтобы её пересидеть).
   */
  push(item: PendingItem): boolean
  /**
   * Слить подряд идущие кадры: `cursor + ptsCount >= pts`. `getCursor` читается
   * заново перед каждым шагом (apply двигает курсор на pts), `apply` применяет кадр. Кадры с
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
      const same = buf.findIndex((x) => x.pts === item.pts)
      if (same >= 0) { // дубль out-of-order
        if (item.key === LOCAL_PTS_KEY) buf[same] = item
        return true
      }
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
        if (cur + (buf[i].ptsCount ?? 1) < buf[i].pts) break // дыра ещё есть → оставить остаток в буфере
        apply(buf[i])                        // apply двигает курсор на pts
      }
      buf = buf.slice(i)
    },
    clear() { buf = [] },
    size() { return buf.length },
    has() { return buf.length > 0 },
  }
}

export type NewPendingPts = ReturnType<typeof newPendingPts>
