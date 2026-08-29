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
// У tweb это тот же файл (`src/config/app.ts`): `version`, `build`,
// `versionFull`, `suffix`. Реквизиты MTProto оттуда (api_id/hash, домены, номер
// DC) не портируются — их предмет транспорт, которого у нас нет.
//
// ИМЕНИ приложения у tweb в `App` НЕТ: подвал меню он собирает литералом
// `Telegram Web${App.suffix} ${App.version} (${App.build})`
// (`sidebarLeft/index.ts:1671`), а в сеть имя не шлёт вовсе — на экране
// активных сеансов `app_name` приходит ОТ СЕРВЕРА, из реестра api_id
// (`initConnection` несёт только api_id, device_model, system_version,
// app_version — `networkerFactory.ts:44-47`). У нас реестра нет и клиент один,
// поэтому имя даёт бэкенд константой `domain.AppName`, а `APP_TITLE` здесь —
// та же строка для подвала меню, вынесенная из литерала: две копии одного
// имени в двух местах разъезжаются молча.
//
// Версию сборки читает и сеть (`net/restClient.ts`, заголовок X-App-Version),
// поэтому живёт она здесь, а не в `core/version/versionCheck.ts`: тянуть в
// воркер модуль со стором обновлений незачем.

// Подставляется Vite `define` (см. vite.config.ts). typeof-guard — чтобы модуль
// был импортируем в vitest, где define не применяется (конфиг тестов отдельный).
declare const __APP_VERSION_FULL__: string

/** Имя клиента: им же подписан подвал главного меню. Совпадает с `domain.AppName`. */
export const APP_TITLE = 'Telegram Web'

/** `${version} (${build})` — то же, что tweb собирает из `App.version`/`App.build`. */
export const APP_VERSION_FULL: string =
  typeof __APP_VERSION_FULL__ !== 'undefined' ? __APP_VERSION_FULL__ : 'dev'
