// src/core/realtime/channelFunnel.ts
//
// Состояния каналов — канальная половина tweb `apiUpdatesManager`
// (`channelStates`, `addChannelState`/`getChannelState` :544-563,
// `processUpdate` для канала :632-760, `getChannelDifference` :418-488,
// `subscribeToChannelUpdates`/`unsubscribeFromChannelUpdates` :850-875).
//
// У каждого канала свой плотный pts — журнал канала, общий для всех его
// читателей. Состояние заводится ТОЛЬКО из известного pts: строки диалога
// (`dialog.pts`, dialogs.ts:1756) или истории канала
// (`messages.channelMessages.pts`, appMessagesManager.ts:13503-13505). Живой
// кадр канала без состояния заводит его своим pts и сам отбрасывается как
// уже учтённый (tweb `getChannelState(channelId, pts)` → «duplicate update»).
// В хранилище состояния каналов не пишутся: у оригинала их тоже нет — после
// перезапуска их снова дают диалоги.
//
// Пропущенное добирается `updates.getChannelDifference`:
//   • по дыре в pts живого кадра — после SYNC_DELAY, если её не закрыли;
//   • по `updateChannelTooLong` из `updates.getDifference` — канал сдвинулся,
//     пока сокета не было;
//   • опросом открытой ленты канала, где пользователь не участник: живых кадров
//     ему сервер не шлёт (tweb `subscribeToChannelUpdates`).

import { classifyPts } from './cursor'
import { frameKey, updateDate } from './updateCatalog'
import { newPendingPts, type PendingPts } from './pendingPts'
import type { EventMeta } from '../../rpc/superMessagePort'
import type { SyncState } from './syncWait'
import type { Update } from './events'

type Peers = { users?: unknown[]; chats?: unknown[] }

/** `updates.ChannelDifference` — ответ `updates.getChannelDifference`. */
export type ChannelDifference =
  | { _: 'updates.channelDifferenceEmpty'; pFlags?: { final?: true }; pts: number }
  | ({ _: 'updates.channelDifferenceTooLong'; pFlags?: { final?: true }; dialog: unknown; messages: unknown[] } & Peers)
  | ({
    _: 'updates.channelDifference'; pFlags?: { final?: true }; pts: number
    new_messages: unknown[]; other_updates: Update[]
  } & Peers)

interface ChannelState {
  pts: number
  pending: PendingPts                      // tweb pendingPtsUpdates
  syncPending: ReturnType<typeof setTimeout> | null
  loading: Promise<void> | null            // tweb syncLoading
  progressTime: number                     // tweb syncProgressTime
  lastPtsUpdateTime: number                // tweb lastPtsUpdateTime
  lastDifferenceTime: number               // tweb lastDifferenceTime
}

export interface ChannelFunnelDeps {
  /** Отражение апдейта в SSOT + рассылка (tweb `saveUpdate`). */
  dispatch: (key: string, d: unknown, meta?: EventMeta) => void
  /** `updates.getChannelDifference{channel, pts, limit: 1000}`. */
  getChannelDifference: (peerId: number, pts: number) => Promise<ChannelDifference>
  /** Карточки разницы — ДО её апдейтов (tweb saveApiUsers/saveApiChats). */
  savePeers: (peers: Peers) => void
  /** `updateChannelReload` (tweb onUpdateChannelReload): канал перечитывается целиком. */
  onChannelReload: (peerId: number) => void
  /** Дата применённого живого кадра канала — в `updatesState.date`
   *  (tweb :736-738): от неё сервер отдаёт маркеры updateChannelTooLong. */
  advanceDate?: (date: number) => void
  /** Сколько разниц каналов идёт одновременно (остальные ждут очереди). */
  maxConcurrent?: number
  /** Окно ожидания, что дыру закроют следующие живые кадры (глобальный PTS_SYNC_DELAY). */
  syncDelay?: number
  /** Период опроса открытой ленты не участника и минимальный зазор между разницами. */
  pollInterval?: number
  pollGap?: number
}

/** tweb SYNC_DELAY — у нас то же окно, что у глобальной воронки (globalFunnel.ts). */
const SYNC_DELAY = 250

export function newChannelFunnel(deps: ChannelFunnelDeps) {
  const syncDelay = deps.syncDelay ?? SYNC_DELAY
  const pollInterval = deps.pollInterval ?? 3000
  const pollGap = deps.pollGap ?? 2500
  // Разницы каналов — не больше maxConcurrent одновременно: реконнект после
  // долгого сна приносит маркер по каждому сдвинувшемуся каналу, и запросы на
  // все сразу ушли бы залпом. У оригинала их сериализует очередь сети
  // MTProto (и FLOOD_WAIT сервера); у нас — эта очередь.
  const maxConcurrent = deps.maxConcurrent ?? 4
  let inFlight = 0
  const queue: Array<() => void> = []
  function limited<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        ++inFlight
        run().then(resolve, reject).finally(() => {
          --inFlight
          queue.shift()?.()
        })
      }
      if (inFlight < maxConcurrent) start()
      else queue.push(start)
    })
  }
  const states = new Map<number, ChannelState>()
  const subscriptions = new Map<number, { count: number; interval?: ReturnType<typeof setInterval> }>()

  /** tweb `addChannelState` (:544-556): без pts состояния не бывает. */
  function addChannelState(peerId: number, pts: number): ChannelState {
    if (!pts) throw new Error('Add channel state without pts ' + peerId)
    let st = states.get(peerId)
    if (!st) {
      st = {
        pts, pending: newPendingPts(), syncPending: null, loading: null,
        progressTime: 0, lastPtsUpdateTime: 0, lastDifferenceTime: 0,
      }
      states.set(peerId, st)
    }
    return st
  }

  function clearStatePendingSync(st: ChannelState): void {
    if (st.syncPending) { clearTimeout(st.syncPending); st.syncPending = null }
  }

  /** tweb `popPendingPtsUpdate` — слить придержанные кадры, ставшие подряд. */
  function popPending(st: ChannelState): void {
    if (!st.pending.has()) return
    st.pending.drain(() => st.pts, (item) => {
      st.pts = item.pts
      deps.dispatch(item.key, item.d, { pts: item.pts, catchUp: false })
      const date = updateDate(item.d)
      if (date) deps.advanceDate?.(date)
    })
    if (!st.pending.has()) clearStatePendingSync(st)
  }

  /** tweb `getChannelDifference` (:418-488). */
  function getChannelDifference(peerId: number): Promise<void> {
    const st = states.get(peerId)
    if (!st) return Promise.resolve()
    const wasSyncing = st.loading
    if (!wasSyncing) st.pending.clear()
    clearStatePendingSync(st)

    const promise = limited(() => deps.getChannelDifference(peerId, st.pts)).then((diff): Promise<void> | void => {
      if ('pts' in diff) st.pts = diff.pts
      st.lastDifferenceTime = st.progressTime = Date.now()

      if (diff._ === 'updates.channelDifferenceEmpty') return

      if (diff._ === 'updates.channelDifferenceTooLong') {
        states.delete(peerId)
        deps.onChannelReload(peerId)
        return
      }

      deps.savePeers({ users: diff.users, chats: diff.chats })
      // Should be first because of updateMessageID (tweb :467)
      for (const u of diff.other_updates) {
        deps.dispatch(frameKey(u._, u), u, { pts: (u as { pts?: number }).pts, catchUp: true })
      }
      for (const message of diff.new_messages) {
        deps.dispatch('updateNewChannelMessage', {
          _: 'updateNewChannelMessage', message, pts: st.pts, pts_count: 0,
        }, { pts: st.pts, catchUp: true })
      }

      if (diff._ === 'updates.channelDifference' && !diff.pFlags?.final) {
        return getChannelDifference(peerId)
      }
    })

    if (!wasSyncing) {
      st.loading = promise
      st.progressTime = Date.now()
      promise.then(() => { st.loading = null }, () => { st.loading = null })
    }
    return promise
  }

  return {
    addChannelState,

    /** Есть ли у канала состояние. */
    has(peerId: number): boolean { return states.has(peerId) },

    /**
     * Живой кадр канала с pts — tweb `processUpdate` для канала: идёт догон —
     * кадр отбрасывается (разница переотдаст его по порядку); дубль —
     * отбрасывается; дыра — придерживается, и если её не закроют за
     * SYNC_DELAY, состояние догоняется разницей.
     */
    processUpdate(peerId: number, key: string, pts: number, d: unknown): void {
      const st = states.get(peerId) ?? addChannelState(peerId, pts)
      if (st.loading) return
      const cls = classifyPts(st.pts, pts)
      if (cls === 'dup') return
      if (cls === 'gap') {
        if (!st.pending.push({ key, pts, d })) {
          st.pending.clear()
          void getChannelDifference(peerId).catch(() => {})
          return
        }
        if (!st.syncPending && !st.loading) {
          st.syncPending = setTimeout(() => {
            st.syncPending = null
            if (st.loading) return
            void getChannelDifference(peerId).catch(() => {})
          }, syncDelay)
        }
        return
      }
      st.pts = pts
      st.lastPtsUpdateTime = Date.now()
      deps.dispatch(key, d, { pts, catchUp: false })
      // tweb :736-738 — канальный апдейт двигает дату общего состояния.
      const date = updateDate(d)
      if (date) deps.advanceDate?.(date)
      popPending(st)
    },

    /**
     * `updateChannelTooLong` (tweb :658-662): у канала без состояния — ничего
     * (его нет в памяти, догонять не от чего); иначе разница, если живой кадр
     * не двигал состояние только что.
     */
    onTooLong(peerId: number): void {
      const st = states.get(peerId)
      if (!st || st.loading) return
      if (!st.lastPtsUpdateTime || st.lastPtsUpdateTime < Date.now() - syncDelay) {
        void getChannelDifference(peerId).catch(() => {})
      }
    },

    getChannelDifference,

    /**
     * tweb `subscribeToChannelUpdates` (:850-863) — опрос открытой ленты
     * канала, в котором пользователь не участник: раз в pollInterval, если
     * разницы не было дольше pollGap.
     */
    subscribe(peerId: number): void {
      let sub = subscriptions.get(peerId)
      if (!sub) { sub = { count: 0 }; subscriptions.set(peerId, sub) }
      ++sub.count
      const cb = () => {
        const st = states.get(peerId)
        if (st && !st.loading && (!st.lastDifferenceTime || Date.now() - st.lastDifferenceTime > pollGap)) {
          void getChannelDifference(peerId).catch(() => {})
        }
      }
      sub.interval ??= setInterval(cb, pollInterval)
      cb()
    },

    /** tweb `unsubscribeFromChannelUpdates` (:865-875). */
    unsubscribe(peerId: number, force?: boolean): void {
      const sub = subscriptions.get(peerId)
      if (!sub?.interval || (--sub.count && !force)) return
      clearInterval(sub.interval)
      sub.interval = undefined
      subscriptions.delete(peerId)
    },

    /** Состояние догона канала для `syncWait`; у пира без состояния — `undefined`. */
    syncState(peerId: number): SyncState | undefined {
      const st = states.get(peerId)
      return st && { loading: st.loading, progressTime: st.progressTime }
    },

    /** Забыть состояния (tweb `channelStates = {}` на differenceTooLong). */
    reset(): void {
      for (const st of states.values()) clearStatePendingSync(st)
      states.clear()
    },

    /** Смена сессии: состояния и опросы прошлого аккаунта — прочь. */
    resetForLogout(): void {
      for (const sub of subscriptions.values()) if (sub.interval) clearInterval(sub.interval)
      subscriptions.clear()
      for (const st of states.values()) clearStatePendingSync(st)
      states.clear()
    },
  }
}
export type ChannelFunnel = ReturnType<typeof newChannelFunnel>
