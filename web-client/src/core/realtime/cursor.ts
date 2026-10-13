// src/core/realtime/cursor.ts
//
// Пер-юзерный плотный монотонный курсор realtime-контракта (Wave 3): единая
// точка правды по «до какого pts клиент уже применил апдейты». Живёт в
// SharedWorker, персистится в IDB (ключи 'pts'/'date' — те же, что раньше писал
// syncEngine), поэтому переживает reload вкладки И рестарт воркера. Всё логируемое
// обновление (живой кадр {t,d} с d.pts) сверяется с этим
// курсором в funnel'е воркера: pts<=cursor — дубль, cursor+pts_count>=pts — применить и
// сдвинуть, иначе — дыра → getDifference. Разница курсор ставит своим state.

interface KV { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> }

// Арифметика funnel'а — чистая, чтобы её можно было отдельно протестировать
// (tweb `processUpdate`, apiUpdatesManager.ts:696-734).
// 'dup'  — pts уже применён (или out-of-order повтор) → отбросить.
// 'next' — cursor + pts_count >= pts → применить и сдвинуть курсор на pts.
// 'gap'  — cursor + pts_count < pts: пропущен хотя бы один pts → нужен catch-up
//          (для live-пути).
// У журнальных кадров pts_count === 1; больше он у местного updatePts —
// ответа на очистку истории (messages.affectedHistory), где одна операция
// пишет несколько строк журнала.
export type PtsClass = 'dup' | 'next' | 'gap'
export function classifyPts(cursor: number, pts: number, ptsCount = 1): PtsClass {
  if (pts <= cursor) return 'dup'
  if (cursor + ptsCount < pts) return 'gap'
  return 'next'
}

export interface Cursor {
  /** Резолвится после гидратации из IDB — гейт перед первым apply. */
  ready(): Promise<void>
  get(): { pts: number; date: number }
  /** Монотонный сдвиг вперёд (дубли/откаты игнорируются), персист дебаунсится. */
  advance(pts: number, date?: number): void
  /** Безусловная установка (полный ресинк / too_long), персист дебаунсится. */
  set(pts: number, date: number): void
  /**
   * Забыть состояние апдейтов — переход сессии (вход/выход). Курсор прошлой
   * сессии к новой отношения не имеет; базой заново станет updates.getState
   * (tweb `apiUpdatesManager.attach` без сохранённого state, :886-906 — у
   * оригинала state живёт в хранилище аккаунта и уходит вместе с ним).
   */
  reset(): void
}

// Дата больше 10^11 — миллисекунды (в секундах это 5138 год).
const MS_DATE_FLOOR = 100_000_000_000

export function newCursor(store: KV, persistDelay = 1000): Cursor {
  let pts = 0
  let date = 0
  const ready = Promise.all([store.get('pts'), store.get('date')])
    .then(([p, d]) => {
      // Мерж, не перезапись: разница могла обогнать async-гидратацию и уже поднять
      // курсор — не откатываем назад (иначе catch-up переотдал бы применённое).
      if (typeof p === 'number') pts = Math.max(pts, p)
      // `date` — секунды (updates.state.date схемы, A4-18). Прежде сервер
      // отдавал миллисекунды, и сохранённое тогда число переводится: иначе
      // Math.max держал бы миллисекундную дату вечно.
      if (typeof d === 'number') date = Math.max(date, d > MS_DATE_FLOOR ? Math.floor(d / 1000) : d)
    })
    .catch(() => {})

  let timer: ReturnType<typeof setTimeout> | null = null
  const persist = (): void => {
    if (timer) return
    // Отказ записи глотаем (KV = idbSet, он отклоняется на недоступном IDB): персист
    // курсора — кэш, при потере он гидрируется нулём и первый же updates.getState его восстановит.
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
    reset() {
      pts = 0; date = 0; persist()
    },
  }
}

export type NewCursor = ReturnType<typeof newCursor>
