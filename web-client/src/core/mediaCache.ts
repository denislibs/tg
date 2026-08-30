// Работа с медиакэшем (CacheStorage 'cachedFiles') из UI-потока — порт
// tweb dataAndStorage/storageQuota.tsx: подсчёт объёма с разбивкой по
// content-type, очистка, синк настроек TTL/лимита в service worker.
// Ниже — второй жилец модуля (Task 6): зеркало objectURL'ов той же корзины.
import type { LangPackKey } from '@/lang'
import type { MediaUrlEvt } from './managers/mediaManager'
import { isLottieMime } from './stickers/tgs'

const CACHED_FILES = 'cachedFiles'

// ── Зеркало факта «URL медиа» (Task 6/7, стадия C медиа-суперпорта) ──────────
// Владелец — воркер (core/managers/mediaManager.ts::downloadMediaURL): он качает
// байты, кладёт их в корзину cachedFiles и минтит blob:-URL прямо в воркере —
// blob-стор общий на origin, вкладка рисует такой URL в <img> как свой (модель
// tweb: apiFileManager.ts:1039 + зеркалирование storages/thumbs.ts). Здесь —
// применение объявленного (rt:media_url → storeProjection; ответ RPC на
// объявленный пробел — core/hooks/useMediaUrl), синхронное чтение на рендере и
// подписка-«версия» для useSyncExternalStore (Task 7, по образцу
// useMediaTokenVersion в core/mediaUrl.ts). Поздняя вкладка пробел объявляет
// сама: RPC downloadMediaURL и есть канал доставки её снимка (стартовый
// бродкаст она пропустила — SuperMessagePort не буферизует).

// size из MediaUrlEvt зеркало сознательно не хранит: единственный витринный
// потребитель факта — URL для <img>/фона (useMediaUrl); прогресс-байты живут
// своим каналом (media:upload_progress / прелоадер, стадия B).
const mediaUrlMirror = new Map<string, string>()
const mirrorKey = (id: number, thumb: boolean) => `${id}${thumb ? '_thumb' : ''}`

// Версии-счётчика у зеркала нет намеренно: снимок per-ключ (cachedMediaUrl)
// сравнивается самим useSyncExternalStore, notify лишь просит пересчитать.
const mirrorSubs = new Set<() => void>()
function notifyMirror() {
  mirrorSubs.forEach((f) => f())
}

// Подписка компонента на движение зеркала (useSyncExternalStore в useMediaUrl).
// Снимок per-ключ берёт сам подписчик (cachedMediaUrl) — глобальный notify не
// перерисовывает компоненты, чей URL не менялся (Object.is-сравнение снимков).
export function subscribeMediaUrlMirror(cb: () => void): () => void {
  mirrorSubs.add(cb)
  return () => { mirrorSubs.delete(cb) }
}

// Применить снимок, посчитанный владельцем. Вызывающие — проектор (кадр
// rt:media_url) и useMediaUrl (ответ RPC на объявленный этим же хуком пробел);
// пин — core/noDuplicateMediaUrl.test.ts. На холодном старте один URL приезжает
// обоими путями — повторное применение подписчиков не будит (как applyMediaToken).
export function applyMediaUrl(e: Pick<MediaUrlEvt, 'id' | 'thumb' | 'url'>): void {
  const key = mirrorKey(e.id, e.thumb)
  if (mediaUrlMirror.get(key) === e.url) return
  mediaUrlMirror.set(key, e.url)
  notifyMirror()
}

// Синхронное чтение на рендере: undefined — факт ещё не объявлен (спроси
// владельца RPC downloadMediaURL).
export function cachedMediaUrl(id: number, thumb = false): string | undefined {
  return mediaUrlMirror.get(mirrorKey(id, thumb))
}

// Кадр rt:logging_out (storeProjection): blob:-URL прошлой сессии владелец уже
// отозвал (resetDownloads) — зеркало обязано перестать их отдавать, иначе <img>
// держит мёртвый URL (а до отзыва — медиа прошлого аккаунта). Пробуждение
// подписчиков обязательно: <img> пересобирается на подложку, а его хук сам
// объявит пробел владельцу текущей сессии.
export function resetMediaUrlMirror(): void {
  mediaUrlMirror.clear()
  notifyMirror()
}

export interface CachedFilesSizes {
  total: number
  images: number
  videos: number
  stickers: number
  other: number
}

const ZERO: CachedFilesSizes = { total: 0, images: 0, videos: 0, stickers: 0, other: 0 }

// Категория по content-type (tweb collectCachedFilesSizes): image/* → фото,
// video/* → видео, application/json/x-tgsticker → стикеры (lottie), остальное → другое.
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
        : isLottieMime(ct) ? 'stickers' : 'other'
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
export function formatBytes(bytes: number, t: (key: LangPackKey) => string, decimals: number | 'auto' = 'auto'): string {
  const units = [t('Unit.Bytes'), t('Unit.Kilobytes'), t('Unit.Megabytes'), t('Unit.Gigabytes')]
  if (bytes === 0) return `0 ${units[0]}`
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const dm = Math.max(0, decimals === 'auto' ? i - 1 : decimals)
  const fixed = (bytes / 1024 ** i).toFixed(dm)
  return `${decimals === 'auto' ? fixed : parseFloat(fixed)} ${units[i]}`
}
