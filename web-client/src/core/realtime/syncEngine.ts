// src/core/realtime/syncEngine.ts
//
// Догонка пер-юзерного ящика — общая половина tweb `apiUpdatesManager`:
// `attach` (:886-935: без сохранённого состояния — `updates.getState`, иначе
// `getDifference(true)`), `forceGetDifference` (:185-189, на новой сессии —
// у нас на каждом (пере)подключении сокета) и сам `getDifference` (:316-392).
import type { RestClient } from '../net/restClient'
import type { Cursor } from './cursor'
import type { SyncState } from './syncWait'
import type { Update } from './events'

type Peers = { users?: unknown[]; chats?: unknown[] }

/** `updates.state`. */
export interface UpdatesState { _: 'updates.state'; pts: number; qts: number; date: number; seq: number; unread_count: number }

/** `updates.Difference` — ответ `updates.getDifference`. */
export type UpdatesDifference =
  | { _: 'updates.differenceEmpty'; date: number; seq: number }
  | ({
    _: 'updates.difference' | 'updates.differenceSlice'
    new_messages: unknown[]; new_encrypted_messages?: unknown[]; other_updates: Update[]
    state?: UpdatesState; intermediate_state?: UpdatesState
  } & Peers)
  | { _: 'updates.differenceTooLong'; pts: number }

/** Апдейты разницы, которые идут через состояние канала (tweb :352-357). */
const CHANNEL_DIFFERENCE_UPDATES: ReadonlySet<string> = new Set([
  'updateChannelTooLong', 'updateNewChannelMessage', 'updateEditChannelMessage',
])

export interface SyncDeps {
  rest: Pick<RestClient, 'get'>
  cursor: Cursor
  /** tweb `saveUpdate` — отражение апдейта в SSOT + рассылка, без арифметики pts. */
  saveUpdate: (key: string, d: unknown, meta: { pts?: number; catchUp: true }) => void
  /** tweb `processUpdate` для апдейтов канала из разницы (updateChannelTooLong и
   *  посты канала) — их применяет состояние канала. */
  processChannelUpdate: (u: Update) => void
  /** Векторы страницы разницы — ДО её апдейтов (tweb :341-342). */
  onPeers?: (peers: Peers) => void
  /** `updates.differenceTooLong` — tweb `onDifferenceTooLong`: менеджеры
   *  сбрасываются, состояния каналов забываются. */
  onDifferenceTooLong: () => void
  /** tweb state_synchronizing/state_synchronized (:460-469) — индикатор
   *  «Обновление…». Парность держит `.finally` на догоне: на упавшем запросе
   *  оригинал state_synchronized не шлёт, и автомат статуса залипал бы в
   *  «синхронизирую» (сознательное улучшение, см. connectionStatus). */
  onSyncStart?: () => void
  onSyncEnd?: () => void
}

export function newSyncEngine({ rest, cursor, saveUpdate, processChannelUpdate, onPeers, onDifferenceTooLong, onSyncStart, onSyncEnd }: SyncDeps) {
  // tweb `updatesState.syncLoading` и `syncProgressTime` (1dc32d889).
  let loading: Promise<void> | null = null
  let progressTime = 0

  async function runDifference(): Promise<void> {
    // Гейт гидратации: со stale-курсором (0) разница переиграла бы весь журнал.
    await cursor.ready()
    // Состояния нет вовсе (дата — после смены сессии) — разницу просить не от
    // чего, базой становится состояние сервера. Только по дате: pts у нас
    // бывает 0 и у живого состояния (пустой журнал нового пользователя), и
    // getState на реконнекте потерял бы его первое событие.
    if (!cursor.get().date) { await fetchState(); return }
    for (;;) {
      const { pts, date } = cursor.get()
      const diff = await rest.get<UpdatesDifference>('/updates/difference', { pts, date, qts: -1 })
      progressTime = Date.now()

      if (diff._ === 'updates.differenceEmpty') {
        cursor.set(pts, diff.date)
        return
      }

      if (diff._ === 'updates.differenceTooLong') {
        cursor.set(diff.pts, Math.floor(Date.now() / 1000))
        onDifferenceTooLong()
        return
      }

      if (diff.users?.length || diff.chats?.length) onPeers?.({ users: diff.users, chats: diff.chats })
      // Should be first because of updateMessageID (tweb :344)
      for (const u of diff.other_updates) {
        if (CHANNEL_DIFFERENCE_UPDATES.has(u._)) { processChannelUpdate(u); continue }
        saveUpdate(u._, u, { pts: (u as { pts?: number }).pts, catchUp: true })
      }
      for (const message of diff.new_messages) {
        saveUpdate('updateNewMessage', { _: 'updateNewMessage', message, pts, pts_count: 0 }, { pts, catchUp: true })
      }
      const next = diff._ === 'updates.difference' ? diff.state : diff.intermediate_state
      if (next) cursor.set(next.pts, next.date)

      if (diff._ !== 'updates.differenceSlice') return
    }
  }

  async function fetchState(): Promise<void> {
    const st = await rest.get<UpdatesState>('/updates/state')
    cursor.set(st.pts, st.date)
  }

  function track(run: Promise<void>): Promise<void> {
    progressTime = Date.now()
    onSyncStart?.()
    loading = run.finally(() => { loading = null; onSyncEnd?.() })
    return loading
  }

  return {
    /** `updates.getState` — первый вход без сохранённого состояния (tweb attach :893-905). */
    // Пара synchronizing/synchronized — и здесь: автомат статуса снимает
    // «Обновление…» только событием, а стартовый pull (`realtime.getStatus`)
    // видит идущее получение состояния как догон (`isSyncing`).
    getState(): Promise<void> {
      if (loading) return loading
      return track(fetchState())
    },
    /** `updates.getDifference` от сохранённого состояния; идущий догон не дублируется. */
    getDifference(): Promise<void> {
      if (loading) return loading
      return track(runDifference())
    },
    /** Идёт ли догон — живые кадры с pts гейтятся, пока true. */
    isSyncing(): boolean { return loading != null },
    /** Состояние догона для `syncWait` (tweb `updatesState.syncLoading`/`syncProgressTime`). */
    syncState(): SyncState { return { loading, progressTime } },
  }
}

export type SyncEngine = ReturnType<typeof newSyncEngine>
