// Вкладочная половина реестра вкладок воркера — порт tweb `apiManagerProxy`:
// `updateTabState`/`updateTabStateIdle` (`lib/apiManagerProxy.ts:1400-1407`), подписка на
// `idleController` (`:645-648`) и `invokeVoid('toggleUninteruptableActivity', …)`
// (зовут видеоплеер, аудиоплеер, звонок). Воркерная половина —
// `lib/appManagers/appTabsManager.ts` и автоблокировка `lib/mainWorker/useAutoLock.ts`.
//
// Расхождение: `apiManagerProxy` у нас нет — порт канала ставит `client/boot.ts`
// (`installTabState`), до этого вызовы молча ничего не шлют.
import type { SuperMessagePort } from '../rpc/superMessagePort'
import idleController from '@helpers/idleController'
import {
  TAB_STATE_CHANNEL,
  TOGGLE_UNINTERUPTABLE_ACTIVITY_CHANNEL,
  type TabState,
  type ToggleUninteruptableActivityPayload,
} from '@lib/appManagers/appTabsManager'

let port: SuperMessagePort | undefined

/** tweb `apiManagerProxy.ts:405-410` — `TabState` в нашем объёме (Б-17). */
const tabState: TabState = {
  idleStartTime: 0,
}

const noop = () => {}

/** tweb `:1400-1403` */
export function updateTabState<T extends keyof TabState>(key: T, value: TabState[T]) {
  tabState[key] = value
  port?.invoke(TAB_STATE_CHANNEL, { ...tabState }).catch(noop)
}

/** tweb `:1405-1407` */
export function updateTabStateIdle(idle: boolean) {
  updateTabState('idleStartTime', idle ? Date.now() : 0)
}

/** tweb `apiManagerProxy.invokeVoid('toggleUninteruptableActivity', {activity, active})` */
export function toggleUninteruptableActivity(activity: string, active: boolean) {
  const payload: ToggleUninteruptableActivityPayload = { activity, active }
  port?.invoke(TOGGLE_UNINTERUPTABLE_ACTIVITY_CHANNEL, payload).catch(noop)
}

/** tweb `:645-648`: простой вкладки — в воркер, сейчас и на каждой смене. */
export function installTabState(smp: SuperMessagePort) {
  port = smp
  idleController.addEventListener('change', (idle) => {
    updateTabStateIdle(idle)
  })
  updateTabStateIdle(idleController.isIdle)
}
