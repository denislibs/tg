// Synchronous media-URL builder for the MAIN thread.
//
// The media manager (and its token) live in the worker, so building a media URL
// the normal way (managers.media.contentUrl) is an async RPC round-trip — doing
// that per <img> on mount is what made the feed jitter. Instead the short-lived
// media token is mirrored here and URLs are built synchronously during render.
//
// Stage 1C.2 (Task 3): владелец токена — воркер (core/managers/mediaManager.ts),
// там же ЕДИНСТВЕННОЕ расписание обновления — перезапрос за минуту до истечения
// с публикацией всем вкладкам (rt:media_token → client/realtime/storeProjection
// → applyMediaToken). Здесь только зеркало: хранит присланное, отдаёт синхронно,
// будит подписчиков (useMediaTokenVersion), чтобы медиа-баблы пересобрали URL
// со свежим токеном — иначе истёкший дал бы 401 и застрявший плейсхолдер.
// Своего таймера у зеркала нет; пин на это — core/noDuplicateMediaToken.test.ts.
import { useSyncExternalStore } from 'react'
import { startClient } from '../client/bootstrap'
import { AppConfig } from '../config/app'
import type { MediaTokenInfo } from './managers/mediaManager'

const API_BASE = '/api' // mirrors the worker's RestClient base
let token = ''
let expiresAt = 0
let version = 0
let priming: Promise<void> | null = null
const subs = new Set<() => void>()

function notify() {
  version++
  subs.forEach((f) => f())
}

// Применить снимок, посчитанный владельцем: событие rt:media_token или ответ
// tokenInfo(). На холодном старте один и тот же снимок приезжает обоими путями
// (RPC-ответом и бродкастом того же запроса) — повторное применение подписчиков
// не будит, иначе каждый медиа-бабл перерисовывался бы вхолостую.
export function applyMediaToken(t: MediaTokenInfo): void {
  if (t.token === token && t.expiresAt === expiresAt) return
  token = t.token
  expiresAt = t.expiresAt
  notify()
}

// Годен ли токен, который держит зеркало. Это НЕ второй порог свежести — запас
// (60 с) и расписание живут только в воркере; здесь проверка валидности самого
// значения. Она нужна как самолечение: если плановое обновление владельца не
// доехало (запрос упал, вкладка подписалась позже, воркер спал), зеркало
// заметит мёртвый токен, компоненты покажут подложку вместо 401-й картинки, а
// mediaContentUrl ниже запросит токен заново.
export const hasMediaToken = (): boolean => !!token && Date.now() < expiresAt

// Запросить токен у владельца: холодный старт, вторая вкладка (у живого воркера
// он уже есть — приедет ответом RPC, не следующим обновлением) и восстановление
// после 401 (`force`, из onError медиа-элемента). НЕ расписание: обновляет
// воркер сам.
export function primeMediaToken(force = false): Promise<void> {
  if (!force && hasMediaToken()) return Promise.resolve()
  if (priming) return priming
  priming = startClient().managers.media
    .tokenInfo()
    .then(applyMediaToken)
    .finally(() => { priming = null })
  return priming
}

export function mediaContentUrl(id: number): string {
  if (!hasMediaToken()) void primeMediaToken()
  return `${API_BASE}/media/${id}/content?token=${encodeURIComponent(token)}`
}

export const mediaThumbUrl = (id: number): string => mediaContentUrl(id) + '&v=thumb'

// Разрешить URL медиа для не-render одноразовых нужд (аудио, waveform): синхронно
// при свежем токене (важно, чтобы назначить src в рамках user-gesture), иначе один
// async-RPC к media-менеджеру. Инкапсулирует доступ к воркеру здесь, чтобы сторам/
// хелперам не тянуть startClient напрямую.
export function resolveMediaContentUrl(id: number): string | Promise<string> {
  return hasMediaToken() ? mediaContentUrl(id) : startClient().managers.media.contentUrl(id)
}

// Как resolveMediaContentUrl, но для стримового медиа (<video>/<audio>): при DNP-ON
// уводит на /dnp-stream/{id} (SW-206 из Noise-канала). При DNP-off — прежнее
// поведение (синхронный token-URL в рамках жеста, где можно).
export function resolveStreamUrl(id: number): string | Promise<string> {
  if (AppConfig.dnp.enabled) return startClient().managers.media.streamUrl(id)
  return resolveMediaContentUrl(id)
}

// Subscribe a component to token updates so it re-renders with a fresh URL.
// Returns a version number that changes whenever the worker publishes a new token.
export function useMediaTokenVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      if (!hasMediaToken()) void primeMediaToken()
      return () => { subs.delete(cb) }
    },
    () => version,
  )
}
