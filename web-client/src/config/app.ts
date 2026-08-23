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

// Императивная лента (порт tweb `chat/bubbles.ts`) вместо React-ленты
// (`components/messages/ChatFeed`). Build-time флаг VITE_VANILLA_FEED=1.
// ПО УМОЛЧАНИЮ ВЫКЛЮЧЕН: перенос идёт этапами, и до последнего из них живой
// лентой остаётся React-версия.
export function readVanillaFeed(env: ImportMetaEnv): boolean {
  return env.VITE_VANILLA_FEED === '1'
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
  vanillaFeed: readVanillaFeed(import.meta.env),
  tlWire: readTLWire(import.meta.env),
}
