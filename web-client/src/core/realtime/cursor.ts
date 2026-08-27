// src/core/realtime/cursor.ts
//
// Пер-юзерный плотный монотонный курсор realtime-контракта (Wave 3): единая
// точка правды по «до какого pts клиент уже применил апдейты». Живёт в
// SharedWorker, персистится в IDB (ключи 'pts'/'date' — те же, что раньше писал
// syncEngine), поэтому переживает reload вкладки И рестарт воркера. Всё логируемое
// обновление (live-кадр {t,d} с d.pts И элемент /sync {t,pts,d}) сверяется с этим
// курсором в funnel'е воркера: pts<=cursor — дубль, pts===cursor+1 — применить и
// сдвинуть, pts>cursor+1 — дыра → catch-up.

interface KV { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> }

// Арифметика funnel'а — чистая, чтобы её можно было отдельно протестировать.
// 'dup'  — pts уже применён (или out-of-order повтор) → отбросить.
// 'next' — ровно следующий (cursor+1) → применить и сдвинуть.
// 'gap'  — пропущен хотя бы один pts → нужен catch-up (для live-пути).
export type PtsClass = 'dup' | 'next' | 'gap'
export function classifyPts(cursor: number, pts: number): PtsClass {
  if (pts <= cursor) return 'dup'
  if (pts === cursor + 1) return 'next'
  return 'gap'
}

export interface Cursor {
  /** Резолвится после гидратации из IDB — гейт перед первым apply. */
  ready(): Promise<void>
  get(): { pts: number; date: number }
  /** Монотонный сдвиг вперёд (дубли/откаты игнорируются), персист дебаунсится. */
  advance(pts: number, date?: number): void
  /** Безусловная установка (полный ресинк / too_long), персист дебаунсится. */
  set(pts: number, date: number): void
}

export function newCursor(store: KV, persistDelay = 1000): Cursor {
  let pts = 0
  let date = 0
  const ready = Promise.all([store.get('pts'), store.get('date')])
    .then(([p, d]) => {
      // Мерж, не перезапись: /sync мог обогнать async-гидратацию и уже поднять
      // курсор — не откатываем назад (иначе catch-up переотдал бы применённое).
      if (typeof p === 'number') pts = Math.max(pts, p)
      if (typeof d === 'number') date = Math.max(date, d)
    })
    .catch(() => {})

  let timer: ReturnType<typeof setTimeout> | null = null
  const persist = (): void => {
    if (timer) return
    // Отказ записи глотаем (KV = idbSet, он отклоняется на недоступном IDB): персист
    // курсора — кэш, при потере он гидрируется нулём и первый же /sync его восстановит.
    timer = setTimeout(() => {
      timer = null
      void store.set('pts', pts).catch(() => {})
      void store.set('date', date).catch(() => {})
    }, persistDelay)
  }

  return {
    ready: () => ready.then(() => {}),
    get: () => ({ pts, date }),
    advance(nextPts, nextDate) {
      let dirty = false
      if (nextPts > pts) { pts = nextPts; dirty = true }
      if (typeof nextDate === 'number' && nextDate > date) { date = nextDate; dirty = true }
      if (dirty) persist()
    },
    set(nextPts, nextDate) {
      pts = nextPts; date = nextDate; persist()
    },
  }
}

export type NewCursor = ReturnType<typeof newCursor>
