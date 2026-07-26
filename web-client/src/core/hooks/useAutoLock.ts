// Автоблокировка по бездействию (tweb settings.passcode.autoLockTimeoutMins):
// активность пользователя (мышь/клавиатура/поинтер) перевзводит таймер; по
// истечении — lock(). Настройки читаются на каждый взвод, поэтому включение/
// выключение пасскода подхватывается без пересборки слушателей.
import { useEffect } from 'react'
import { useSettingsStore } from '../../settings'
import { useLockStore } from '../../stores/lockStore'

export function useAutoLock(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      const { passcodeEnabled, passcodeAutoLockMins } = useSettingsStore.getState()
      if (!passcodeEnabled || !passcodeAutoLockMins) return
      timer = setTimeout(() => useLockStore.getState().lock(), passcodeAutoLockMins * 60_000)
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
