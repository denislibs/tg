// Synchronous media-URL builder for the MAIN thread.
//
// The media manager (and its token) live in the worker, so building a media URL
// the normal way (managers.media.contentUrl) is an async RPC round-trip — doing
// that per <img> on mount is what made the feed jitter. Instead we fetch the
// short-lived media token ONCE (managers.media.tokenInfo), cache it here, and
// build URLs synchronously during render.
//
// The token is short-lived (~15 min), so it's refreshed proactively before expiry
// and subscribers (media bubbles, via useMediaTokenVersion) re-render to rebuild
// their URLs with the fresh token — otherwise an expired token would 401 and the
// image would get stuck on its placeholder.
import { useSyncExternalStore } from 'react'
import { startClient } from '../client/bootstrap'

const API_BASE = '/api' // mirrors the worker's RestClient base
let token = ''
let expiresAt = 0
let version = 0
let priming: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const subs = new Set<() => void>()

const fresh = () => !!token && Date.now() < expiresAt - 60_000

function notify() {
  version++
  subs.forEach((f) => f())
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  const ms = Math.max(5_000, expiresAt - Date.now() - 90_000) // ~90s before expiry
  refreshTimer = setTimeout(() => void primeMediaToken(true), ms)
}

// Fetch + cache the media token; refreshes proactively. `force` bypasses the
// freshness check (used by the scheduled pre-expiry refresh).
export function primeMediaToken(force = false): Promise<void> {
  if (!force && fresh()) return Promise.resolve()
  if (priming) return priming
  priming = startClient().managers.media
    .tokenInfo()
    .then((t) => { token = t.token; expiresAt = t.expiresAt; scheduleRefresh(); notify() })
    .finally(() => { priming = null })
  return priming
}

export const hasMediaToken = (): boolean => fresh()

export function mediaContentUrl(id: number): string {
  if (!fresh()) void primeMediaToken()
  return `${API_BASE}/media/${id}/content?token=${encodeURIComponent(token)}`
}

export const mediaThumbUrl = (id: number): string => mediaContentUrl(id) + '&v=thumb'

// Subscribe a component to token (re)primes so it re-renders with a fresh URL.
// Returns a version number that changes whenever the token is refreshed.
export function useMediaTokenVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      if (!fresh()) void primeMediaToken()
      return () => { subs.delete(cb) }
    },
    () => version,
  )
}
