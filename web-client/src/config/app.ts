// Свой центральный конфиг приложения. НЕ путать с config/modes.ts — тот вендоренный
// островок tlottie (@ts-nocheck), трогать нельзя. Здесь — build-time флаги проекта.
export interface DnpConfig {
  enabled: boolean
  // PINNED PUBLIC keys (массив ради бесшовной ротации). ТОЛЬКО публичные —
  // приватный статический ключ сервера живёт исключительно на бэкенде.
  serverStaticPublicKeys: string[]
}

// Чистый резолвер — тестируется без побочек загрузки модуля.
export function readDnpConfig(env: ImportMetaEnv, search: string): DnpConfig {
  return {
    enabled: env.VITE_DNP_ENABLED === '1' || search.includes('dnp=1'),
    serverStaticPublicKeys: (env.VITE_DNP_SERVER_PUBKEYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  }
}

export const AppConfig = {
  dnp: readDnpConfig(
    import.meta.env,
    typeof location !== 'undefined' ? location.search : '',
  ),
}
