// Вкладочная половина канала код-пароля — порт обработчиков tweb
// `apiManagerProxy.ts:517-536` (`saveEncryptionKey`, `toggleLock`,
// `toggleUsingPasscode`) и `apiManagerProxy.lock()` (`:1466-1470`).
// Воркерная половина — `core/passcode/passcodeWorker.ts`.
import type { SuperMessagePort } from '../rpc/superMessagePort'
import { startClient } from './bootstrap'
import { PASSCODE_CHANNEL, RELOAD_CHANNEL, type PasscodeEvent, type PasscodeTask } from '../core/passcode/protocol'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import { sendPasscodeStateToServiceWorker } from './passcodeServiceWorker'
import { useSettingsStore } from '../settings'

export function invokePasscode<R = void>(task: PasscodeTask): Promise<R> {
  return startClient().smp.invoke<R>(PASSCODE_CHANNEL, task)
}

export interface PasscodeListenerDeps {
  lock: () => void
  unlock: () => void
}

/** Подписка вкладки на события воркера и на перезагрузку от соседей. Ставится
 *  на старте ДО решения о замке (`client/boot.ts`): под замком насос
 *  `startRealtime()` ещё не поднят, а разблокировка из соседней вкладки должна
 *  дойти. */
export function installPasscodeListener(smp: SuperMessagePort, deps: PasscodeListenerDeps): void {
  smp.on<PasscodeEvent>(PASSCODE_CHANNEL, (event) => {
    switch(event.method) {
      case 'saveEncryptionKey':
        EncryptionKeyStore.save(event.payload)
        void sendPasscodeStateToServiceWorker()
        break
      case 'toggleLock':
        if(event.payload) deps.lock()
        else deps.unlock()
        break
      case 'toggleUsingPasscode':
        DeferredIsUsingPasscode.resolveDeferred(event.payload.isUsingPasscode)
        EncryptionKeyStore.save(event.payload.encryptionKey)
        break
      case 'reload':
        // «забыли код»: хранилища стёрты воркером, кода больше нет
        useSettingsStore.getState().update({ passcodeEnabled: false, passcodeAutoLockMins: 0 })
        location.reload()
        break
    }
  })

  if(typeof BroadcastChannel !== 'undefined') {
    new BroadcastChannel(RELOAD_CHANNEL).onmessage = () => { location.reload() }
  }

  // Настройки автоблокировки — воркеру (расхождение 1 `lib/mainWorker/useAutoLock.ts`:
  // у tweb он читает `settings.passcode` из общего хранилища сам).
  const sendAutoLockSettings = () => {
    const { passcodeEnabled, passcodeAutoLockMins } = useSettingsStore.getState()
    smp.invoke(PASSCODE_CHANNEL, {
      method: 'setAutoLockSettings',
      payload: { enabled: passcodeEnabled, autoLockTimeoutMins: passcodeAutoLockMins || null },
    } satisfies PasscodeTask).catch(() => {})
  }
  useSettingsStore.subscribe((state, prev) => {
    if(state.passcodeEnabled !== prev.passcodeEnabled || state.passcodeAutoLockMins !== prev.passcodeAutoLockMins) {
      sendAutoLockSettings()
    }
  })
  sendAutoLockSettings()
}

/** tweb `apiManagerProxy.lock()`: воркер завершается вместе с ключом, все
 *  вкладки перезагружаются и поднимаются на экране блокировки. */
export function lockAndReload(): void {
  // ответа не будет — воркер закроется, не дожидаемся
  invokePasscode({ method: 'terminate' }).catch(() => {})
  if(typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(RELOAD_CHANNEL)
    channel.postMessage('reload')
    channel.close()
  }
  location.reload()
}
