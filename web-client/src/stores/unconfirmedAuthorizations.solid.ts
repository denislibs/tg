/**
 * Порт tweb `src/stores/unconfirmedAuthorizations.ts` (812502980, 1-30) — сигнал со списком
 * запросов «это вы?» о новом входе. Читает его плашка над полосой папок
 * (`components/sidebarLeft/newAuthorization.solid.tsx`).
 *
 * Расхождение с оригиналом одно: `rootScope.managers.appAccountManager.getUnconfirmedAuthorizations()`
 * → `managers.sessions.getUnconfirmedAuthorizations()` — владелец запросов у нас
 * `core/managers/sessionsManager.ts` в воркере, синглтона менеджеров на главном потоке нет.
 */
import { createRoot, createSignal } from 'solid-js'
import rootScope from '@lib/rootScope'
import type { Managers } from '@/client/bootstrap'
import type { UnconfirmedAuthorization } from '@core/managers/sessionsManager'

const [authorizations, setAuthorizations] = createRoot(() => {
  return createSignal<UnconfirmedAuthorization[]>([])
})

let loaded = false

export default function useUnconfirmedAuthorizations(managers: Managers) {
  if(!loaded) {
    loaded = true
    let updateVersion = 0

    rootScope.addEventListener('unconfirmed_authorizations_update', (updated) => {
      ++updateVersion
      setAuthorizations(updated)
    })

    const version = updateVersion
    managers.sessions.getUnconfirmedAuthorizations().then((current) => {
      if(version === updateVersion) {
        setAuthorizations(current)
      }
    }).catch(() => {})
  }

  return authorizations
}
