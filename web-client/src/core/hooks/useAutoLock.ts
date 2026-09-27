// Автоблокировка по бездействию (tweb settings.passcode.autoLockTimeoutMins):
// активность пользователя (мышь/клавиатура/поинтер) перевзводит таймер; по
// истечении — lock(). Настройки читаются на каждый взвод, поэтому включение/
// выключение пасскода подхватывается без пересборки слушателей.
//
// Расхождение с tweb (docs/tweb/passcode-encryption.md П-3): там автоблокировка
// живёт в воркере (`mainWorker/useAutoLock.ts`) и срабатывает, когда простаивают
// ВСЕ вкладки, — перезагрузкой и `terminate`. Здесь таймер одной вкладки, поэтому
// замок только интерфейсный: перезагрузка всех вкладок по простою одной
// выбросила бы соседнюю активную. Ключ остаётся в памяти до ввода кода.
import { useEffect } from 'react'
import { useSettingsStore } from '../../settings'
import PasscodeLockScreenController from '../../components/passcodeLock/passcodeLockScreenController.solid'

export function useAutoLock(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      const { passcodeEnabled, passcodeAutoLockMins } = useSettingsStore.getState()
      if (!passcodeEnabled || !passcodeAutoLockMins) return
      timer = setTimeout(() => void PasscodeLockScreenController.lock(), passcodeAutoLockMins * 60_000)
    }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'pointerdown']
    events.forEach((e) => window.addEventListener(e, arm))
    arm()
    return () => {
      events.forEach((e) => window.removeEventListener(e, arm))
      if (timer) clearTimeout(timer)
    }
  }, [])
}
