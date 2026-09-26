// src/core/realtime/syncWait.ts
//
// Ожидание догона — порт tweb 1dc32d889 (`apiUpdatesManager.ts`:
// `getSyncingStates`, `getSyncPatience`, `waitForSync`, `isInitialSync`).
//
// Зачем: сообщение, приехавшее difference'ом, нельзя уведомлять сразу —
// прочтение с другого устройства или заглушение чата, которые его отменяют,
// могут лежать на следующей странице того же difference или в difference
// канала. Уведомление ждёт, пока догон закончится (и тот, что пошёл следом:
// пока страницы идут, мы всё ещё позади), но не дольше, чем difference МОЛЧИТ —
// запрос, повисший на мёртвом соединении, не должен держать уведомления вечно.
//
// ── Отличие от оригинала по месту, а не по смыслу ──────────────────────────
// У tweb придерживает сам `appMessagesManager` в воркере. У нас уведомления
// строит ВКЛАДКА (`client/realtime/notificationSubscriber.ts`), а состояние
// догона живёт здесь, в воркере, — вкладка спрашивает его по RPC
// (`managers.realtime.waitForSync`). Признак «начальная синхронизация» вкладка
// так спросить не может: к ответу RPC первый difference уже закончится, поэтому
// воркер ставит его на кадр в момент рассылки (`EventMeta.initialSync`) — ровно
// когда tweb снимает его в `handleNewMessage`.
//
// `shouldWaitForSync` оригинала сюда не перенесён: его единственный
// вызывающий — синхронная проверка в `handleNotifications`, а вкладке
// синхронно спросить воркер нечем; `waitForSync` без ожидания отпускает сразу.

/** Состояние одного догона: общего (`syncEngine`) или канального (`channelFunnel`). */
export interface SyncState {
  /** Идущий догон; `null` — сейчас не догоняем. */
  loading: Promise<void> | null
  /** Когда догон последний раз подал признак жизни: начался или принёс страницу. */
  progressTime: number
}

/**
 * tweb `SYNC_MAX_SILENCE` — сколько difference может МОЛЧАТЬ, прежде чем
 * ждущие его перестанут ждать. Тратится тишиной, а не общим временем.
 */
export const SYNC_MAX_SILENCE = 10e3

/** Догон, который идёт прямо сейчас. */
type RunningSync = SyncState & { loading: Promise<void> }
const isRunning = (state: SyncState | undefined): state is RunningSync => !!state?.loading

export interface SyncWaitDeps {
  global: () => SyncState
  /** Догон канала; у не-канала состояния нет (`undefined`). */
  channel: (peerId: number) => SyncState | undefined
}

export function newSyncWait(deps: SyncWaitDeps) {
  let initialSync = true
  let attached = false

  /** Догоны, в которых приходят апдейты этого пира и которые могут их отменить. */
  function getSyncingStates(peerId?: number): RunningSync[] {
    const states: RunningSync[] = []
    const global = deps.global()
    if (isRunning(global)) states.push(global)

    const channel = peerId === undefined ? undefined : deps.channel(peerId)
    if (isRunning(channel)) states.push(channel)

    return states
  }

  /**
   * Сколько ещё готовы ждать, по самому тихому из догонов. 0 — ждать нечего
   * или difference молчит дольше `maxSilence`.
   */
  function getSyncPatience(states: SyncState[], maxSilence: number): number {
    if (!states.length) return 0
    const quietest = Math.min(...states.map((state) => state.progressTime || 0))
    return Math.max(0, maxSilence - (Date.now() - quietest))
  }

  return {
    /**
     * Отпускает, когда пир догнан: пережидает идущий difference И тот, что
     * пошёл следом. Замолчавший difference перестаёт держать (см. `getSyncPatience`).
     */
    async waitForSync(peerId?: number, maxSilence = SYNC_MAX_SILENCE): Promise<void> {
      for (;;) {
        const states = getSyncingStates(peerId)
        const patience = getSyncPatience(states, maxSilence)
        if (!patience) break

        const syncPromise = states.length === 1
          ? states[0].loading
          : Promise.all(states.map((state) => state.loading)).then(() => {})

        await Promise.race([
          syncPromise.catch(() => {}),
          new Promise<void>((resolve) => { setTimeout(resolve, patience) }),
        ])
      }
    },

    /** Идёт ли ещё первый difference после старта. */
    isInitialSync(): boolean {
      return initialSync
    },

    /**
     * Точка «подключились» (tweb `attach`): первый difference после старта
     * переигрывает всё, что накопилось с прошлой сессии, и уведомления
     * обращаются с ним особо. Считается только ПЕРВЫЙ вызов — реконнект
     * начальной синхронизацией не бывает.
     */
    attach(loading: Promise<unknown> | undefined): void {
      if (attached) return
      attached = true
      const onInitialSyncEnd = () => { initialSync = false }
      Promise.resolve(loading).then(onInitialSyncEnd, onInitialSyncEnd)
    },
  }
}

export type SyncWait = ReturnType<typeof newSyncWait>
