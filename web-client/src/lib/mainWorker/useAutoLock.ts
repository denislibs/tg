// Порт tweb `src/lib/mainWorker/useAutoLock.ts` (812502980) — автоблокировка код-паролем
// в воркере: все вкладки простаивают (`setAreAllIdle`) и нет «непрерываемых» занятий
// (видео, звонок — `toggleUninteruptableActivity`) дольше `autoLockTimeoutMins` →
// `onLock` (вкладкам — перезагрузка, воркер завершается вместе с ключом). Проводка —
// `core/workerCore.ts` (tweb `index.worker.ts:335-337`, `:387-404`, `:427`).
//
// Расхождения с оригиналом:
//  1. Настройки (`settings.passcode.enabled`/`autoLockTimeoutMins`) — не
//     `commonStateStorage` (у нас настройки живут в `localStorage` вкладки,
//     `useSettingsStore`), а `getSettings`: их сообщает вкладка задачей
//     `setAutoLockSettings` канала код-пароля (`client/passcodeClient.ts`).
//  2. DEBUG-лог занятий во вкладку (`getPort().invokeVoid('log', …)`) не портирован —
//     канала `log` у нас нет.
//  3. Источник занятия — порт вкладки (`SuperMessagePort`), а не `MessageEventSource`.
// SolidJS in worker script 🤯 (комментарий оригинала)
import { createEffect, createRoot, createSignal, onCleanup } from 'solid-js'

import accumulate from '@helpers/array/accumulate'

export type AutoLockSettings = {
  enabled?: boolean,
  autoLockTimeoutMins?: number | null
}

type UseAutoLockArgs = {
  getSettings: () => Promise<AutoLockSettings | undefined>,
  getIsLocked: () => boolean,
  onLock: () => void
}

export const useAutoLock = <Source = unknown>({ getSettings, getIsLocked, onLock }: UseAutoLockArgs) => createRoot((dispose) => {
  const [areAllIdle, setAreAllIdle] = createSignal(false)
  const [uninteruptableActivities, setUninteruptableActivities] = createSignal(0)

  const uninteruptableActivitiesMap = new Map<Source, Set<string>>()

  let autoLockTimeout: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const hasActiveTabs = !areAllIdle()
    const activities = uninteruptableActivities()

    let cleaned = false
    onCleanup(() => {
      cleaned = true
      clearTimeout(autoLockTimeout)
    })

    void (async() => {
      const settings = await getSettings()
      if(cleaned) return

      const passcodeEnabled = settings?.enabled || false
      const timeoutMins = settings?.autoLockTimeoutMins || null

      if(!timeoutMins || !passcodeEnabled) return

      if(hasActiveTabs || activities > 0 || getIsLocked()) return

      autoLockTimeout = setTimeout(() => {
        if(!areAllIdle() || getIsLocked()) return

        onLock()
      }, timeoutMins * 1000 * 60)
    })()
  })

  function updateActivities() {
    const activities = accumulate(Array.from(uninteruptableActivitiesMap.values()).map((set) => set.size), 0)

    setUninteruptableActivities(activities)
  }

  return {
    dispose,
    toggleUninteruptableActivity: (source: Source, activity: string, active: boolean) => {
      if(!uninteruptableActivitiesMap.has(source)) uninteruptableActivitiesMap.set(source, new Set())

      if(active) uninteruptableActivitiesMap.get(source)!.add(activity)
      else uninteruptableActivitiesMap.get(source)!.delete(activity)

      updateActivities()
    },
    removeTab: (source: Source) => {
      if(uninteruptableActivitiesMap.delete(source)) {
        updateActivities()
      }
    },
    setAreAllIdle,
  }
})
