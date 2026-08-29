// Свой центральный конфиг приложения. НЕ путать с config/modes.ts — тот вендоренный
// островок tlottie (@ts-nocheck), трогать нельзя. Здесь — build-time флаги проекта.
export interface DnpConfig {
  enabled: boolean
  // PINNED PUBLIC keys (массив ради бесшовной ротации). ТОЛЬКО публичные —
  // приватный статический ключ сервера живёт исключительно на бэкенде.
  serverStaticPublicKeys: string[]
}

// Чистый резолвер — тестируется без побочек загрузки модуля.
// Build-time флаг (VITE_DNP_ENABLED=1 при сборке для продакшена с DNP).
export function readDnpConfig(env: ImportMetaEnv): DnpConfig {
  return {
    enabled: env.VITE_DNP_ENABLED === '1',
    serverStaticPublicKeys: (env.VITE_DNP_SERVER_PUBKEYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  }
}

// Провод WS на TL вместо JSON. Build-time флаг VITE_TL_WIRE=1.
// ПО УМОЛЧАНИЮ ВЫКЛЮЧЕН: формат просит КЛИЕНТ подпротоколом `tl.1`, сервер
// умеет обе формы и собирает их из одной модели, поэтому переключение
// обратимо и посоединенчески — соседняя вкладка остаётся на JSON.
export function readTLWire(env: ImportMetaEnv): boolean {
  return env.VITE_TL_WIRE === '1'
}

export const AppConfig = {
  dnp: readDnpConfig(import.meta.env),
  tlWire: readTLWire(import.meta.env),
}

// ── Как клиент называет себя ───────────────────────────────────────────────
// Порт tweb `src/config/app.ts` (портируемая часть): у оригинала это тот же
// единственный источник, из которого клиент подписывает подвал меню
// (`App.title` + `App.versionFull`) и называет себя сети в преамбуле
// `initConnection` (`networkerFactory.ts:44-47`, параметр `app_version`).
// Реквизиты MTProto (api_id/hash, домены, номер DC) не портируются: их предмет
// — транспорт, которого у нас нет.
//
// Версию сборки читает и сеть (`net/restClient.ts`, заголовок X-App-Version),
// поэтому живёт она здесь, а не в `core/version/versionCheck.ts`: тянуть в
// воркер модуль со стором обновлений незачем.

// Подставляется Vite `define` (см. vite.config.ts). typeof-guard — чтобы модуль
// был импортируем в vitest, где define не применяется (конфиг тестов отдельный).
declare const __APP_VERSION_FULL__: string

/** Имя клиента: им же подписан подвал главного меню. */
export const APP_TITLE = 'Telegram Web'

/** `${version} (${build})` — ровно tweb `App.versionFull`. */
export const APP_VERSION_FULL: string =
  typeof __APP_VERSION_FULL__ !== 'undefined' ? __APP_VERSION_FULL__ : 'dev'
