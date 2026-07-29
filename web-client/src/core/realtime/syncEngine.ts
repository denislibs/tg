// src/core/realtime/syncEngine.ts
import type { RestClient } from '../net/restClient'
import type { Cursor } from './cursor'

interface SyncResp { new_messages: SyncItem[]; other_updates: SyncItem[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }
// Каждый элемент /sync — конверт {t, pts, d} (SyncUpdate бэка). new_messages и
// other_updates несут один и тот же shape, поэтому обрабатываются единым потоком.
export interface SyncItem { t: string; pts: number; d: unknown }

export interface SyncDeps {
  rest: Pick<RestClient, 'get'>
  cursor: Cursor
  /** Единый funnel применения: и live-кадр, и элемент /sync проходят через него. */
  onUpdate: (item: SyncItem) => void
  onResync: () => void
}

export function newSyncEngine({ rest, cursor, onUpdate, onResync }: SyncDeps) {
  let running: Promise<void> | null = null

  async function run(): Promise<void> {
    await cursor.ready() // гейт гидратации: не синкаем со stale-курсором (0)
    for (;;) {
      const { pts, date } = cursor.get()
      const r = await rest.get<SyncResp>('/sync', { pts, date })
      if (r.too_long) {
        // Слишком далеко позади: полный ресинк снапшотов. Курсор ставим на текущий
        // серверный pts, иначе каждый последующий live-кадр видел бы дыру → бесконечный
        // catch-up. Данные подтянет onResync (loadChats и т.п.).
        if (r.state) cursor.set(r.state.pts, r.state.date)
        onResync()
        break
      }
      // ЕДИНЫЙ поток, упорядоченный по pts: раньше messages сливались ДО others,
      // из-за чего edit/reaction обгоняли своё базовое сообщение (edit-before-base).
      // Плотный монотонный pts восстанавливает истинный порядок событий.
      const items = [...(r.new_messages ?? []), ...(r.other_updates ?? [])]
        .sort((a, b) => (a?.pts ?? 0) - (b?.pts ?? 0))
      for (const it of items) onUpdate(it)
      cursor.set(r.state?.pts ?? pts, r.state?.date ?? date)
      if (!r.slice) break
    }
  }

  return {
    // serialize concurrent calls; a reconnect mid-sync just awaits the in-flight run
    catchUp(): Promise<void> {
      if (running) return running
      running = run().finally(() => { running = null })
      return running
    },
    /** Идёт ли catch-up прямо сейчас — live-кадры с pts гейтятся, пока true. */
    isSyncing(): boolean { return running != null },
  }
}

export type SyncEngine = ReturnType<typeof newSyncEngine>
