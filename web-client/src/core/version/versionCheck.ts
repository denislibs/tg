// Version-gate (порт tweb sidebarLeft/index.ts ~340-357, портируемая часть):
// раз в 30 мин фетчим `version`, сравниваем с вкомпиленной в бандл строкой; при
// расхождении помечаем доступным обновление и прекращаем опрос. Кнопку «Обновить»
// (location.reload()) рисует App. Cache-bust — на хешах ассетов + app-shell-<build>.
import { useUpdateStore } from '../../stores/updateStore'

// Подставляются Vite `define` (см. vite.config.ts). typeof-guard — чтобы модуль был
// импортируем в vitest, где define не применяется (конфиг тестов отдельный).
declare const __APP_BUILD__: number
declare const __APP_VERSION_FULL__: string

export const APP_BUILD: number = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0
export const APP_VERSION_FULL: string =
  typeof __APP_VERSION_FULL__ !== 'undefined' ? __APP_VERSION_FULL__ : 'dev'

export const CHECK_UPDATE_INTERVAL = 1800e3 // 30 мин, как tweb

// Один фетч+сравнение. Возвращает true, если сборка на сервере новее (→ опрос стоп).
export async function checkVersion(): Promise<boolean> {
  try {
    const res = await fetch('version', { cache: 'no-cache' })
    if (res.status !== 200 || !res.ok) return false
    const text = (await res.text()).trim()
    if (text && text !== APP_VERSION_FULL) {
      useUpdateStore.getState().markAvailable()
      return true
    }
  } catch {
    // Оффлайн/сетевая ошибка — просто ждём следующего тика (как tweb .catch(noop)).
  }
  return false
}

let started = false

export function startVersionCheck(): void {
  if (started) return // защита от двойного монтирования (StrictMode)
  started = true
  const id = setInterval(() => {
    void checkVersion().then((updated) => {
      if (updated) clearInterval(id)
    })
  }, CHECK_UPDATE_INTERVAL)
}
