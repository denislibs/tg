// Работа с медиакэшем (CacheStorage 'cachedFiles') из UI-потока — порт
// tweb dataAndStorage/storageQuota.tsx: подсчёт объёма с разбивкой по
// content-type, очистка, синк настроек TTL/лимита в service worker.

const CACHED_FILES = 'cachedFiles'

export interface CachedFilesSizes {
  total: number
  images: number
  videos: number
  stickers: number
  other: number
}

const ZERO: CachedFilesSizes = { total: 0, images: 0, videos: 0, stickers: 0, other: 0 }

// Категория по content-type (tweb collectCachedFilesSizes): image/* → фото,
// video/* → видео, application/json → стикеры (lottie), остальное → другое.
export async function collectCachedFilesSizes(): Promise<CachedFilesSizes> {
  if (!('caches' in window)) return { ...ZERO }
  const out = { ...ZERO }
  const cache = await caches.open(CACHED_FILES)
  const requests = await cache.keys()
  for (const req of requests) {
    const res = await cache.match(req)
    if (!res) continue
    const size = parseInt(res.headers.get('Content-Length') || '0') || 0
    if (!size) continue
    const ct = res.headers.get('content-type') || ''
    const key = ct.startsWith('image/') ? 'images'
      : ct.startsWith('video/') ? 'videos'
        : ct.startsWith('application/json') ? 'stickers' : 'other'
    out[key] += size
    out.total += size
  }
  return out
}

export async function clearCachedFiles(): Promise<void> {
  if (!('caches' in window)) return
  await caches.delete(CACHED_FILES)
}

// Отдать SW актуальные cacheTTL/cacheSize — он сразу прогоняет очистку
// (clearOldCache). Вызывается при старте приложения и при смене настроек.
export function syncCacheSettingsToSW(cacheTTL: number, cacheSize: number): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready.then((reg) => {
    reg.active?.postMessage({ type: 'cache-settings', cacheTTL, cacheSize })
  }).catch(() => {})
}

// Порт tweb helpers/formatBytes: decimals='auto' → i-1 знаков (КБ целыми,
// МБ с одним знаком, ГБ с двумя), фиксированное число знаков — как передано.
export function formatBytes(bytes: number, t: (s: string) => string, decimals: number | 'auto' = 'auto'): string {
  const units = [t('B'), t('KB'), t('MB'), t('GB')]
  if (bytes === 0) return `0 ${units[0]}`
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const dm = Math.max(0, decimals === 'auto' ? i - 1 : decimals)
  const fixed = (bytes / 1024 ** i).toFixed(dm)
  return `${decimals === 'auto' ? fixed : parseFloat(fixed)} ${units[i]}`
}
