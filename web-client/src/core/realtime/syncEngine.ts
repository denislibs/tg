// src/core/realtime/syncEngine.ts
import type { RestClient } from '../net/restClient'

interface KV { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> }
interface SyncResp { new_messages: unknown[]; other_updates: unknown[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }

export interface SyncDeps {
  rest: Pick<RestClient, 'get'>
  store: KV
  onNewMessage: (m: unknown) => void
  onOtherUpdate: (u: unknown) => void
  onResync: () => void
}

export function newSyncEngine({ rest, store, onNewMessage, onOtherUpdate, onResync }: SyncDeps) {
  let running: Promise<void> | null = null

  async function loadState(): Promise<{ pts: number; date: number }> {
    return { pts: ((await store.get('pts')) as number | undefined) ?? 0, date: ((await store.get('date')) as number | undefined) ?? 0 }
  }

  async function run(): Promise<void> {
    let { pts, date } = await loadState()
    for (;;) {
      const r = await rest.get<SyncResp>('/sync', { pts, date })
      if (r.too_long) { onResync(); break }
      for (const m of r.new_messages ?? []) onNewMessage(m)
      for (const u of r.other_updates ?? []) onOtherUpdate(u)
      pts = r.state?.pts ?? pts
      date = r.state?.date ?? date
      await store.set('pts', pts)
      await store.set('date', date)
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
    async setState(pts: number, date: number): Promise<void> {
      await store.set('pts', pts); await store.set('date', date)
    },
  }
}

export type SyncEngine = ReturnType<typeof newSyncEngine>
