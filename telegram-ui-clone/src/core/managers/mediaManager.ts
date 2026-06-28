import type { RestClient } from '../net/restClient'

export interface UploadArgs { bytes: ArrayBuffer; mime: string; size: number; width?: number; height?: number; duration?: number; fileName?: string }
export interface MediaMeta { id: number; mime: string; size: number; width: number; height: number; duration: number; blurPreview: string; fileName: string; hasThumb: boolean }

interface RestLike {
  post: RestClient['post']
  get: RestClient['get']
  putBytes: RestClient['putBytes']
  contentUrl: RestClient['contentUrl']
  mediaUrl: RestClient['mediaUrl']
}

export function newMediaManager({ rest }: { rest: RestLike }) {
  const metaCache = new Map<number, MediaMeta>()
  // Cached short-lived media token (refreshed ~1 min before expiry). It only
  // authorizes media reads, so it's safe to put in URLs (unlike the session token).
  let mediaToken = ''
  let mediaTokenExp = 0
  async function ensureToken(): Promise<string> {
    if (mediaToken && Date.now() < mediaTokenExp - 60_000) return mediaToken
    const r = await rest.get<{ token: string; expires_at: string }>('/media/token')
    mediaToken = r.token
    mediaTokenExp = new Date(r.expires_at).getTime()
    return mediaToken
  }
  return {
    async upload(a: UploadArgs): Promise<number> {
      const r = await rest.post<{ media_id: number }>('/media/upload', {
        mime: a.mime, size: a.size, width: a.width ?? 0, height: a.height ?? 0, duration: a.duration ?? 0,
        file_name: a.fileName ?? '',
      })
      await rest.putBytes(`/media/${r.media_id}/content`, a.bytes, a.mime)
      return r.media_id
    },
    async meta(id: number): Promise<MediaMeta> {
      const hit = metaCache.get(id)
      // Don't cache until the server has finished processing (a thumb may appear
      // a moment after upload); re-fetch while hasThumb is still false.
      if (hit && hit.hasThumb) return hit
      const r = await rest.get<{ id: number; mime: string; size: number; width: number; height: number; duration: number; blur_preview: string; file_name?: string; has_thumb?: boolean }>(`/media/${id}`)
      const m: MediaMeta = { id: r.id, mime: r.mime, size: r.size, width: r.width, height: r.height, duration: r.duration, blurPreview: r.blur_preview ?? '', fileName: r.file_name ?? '', hasThumb: !!r.has_thumb }
      metaCache.set(id, m)
      return m
    },
    async contentUrl(id: number): Promise<string> {
      const tok = await ensureToken()
      return rest.mediaUrl(`/media/${id}/content`, tok)
    },
    // The cached media token + its expiry, so the MAIN thread can build media URLs
    // synchronously (no per-image RPC round-trip → no scroll jitter). Primed once.
    async tokenInfo(): Promise<{ token: string; expiresAt: number }> {
      const token = await ensureToken()
      return { token, expiresAt: mediaTokenExp }
    },
    // URL of the server-generated thumbnail/poster (jpeg). Same content endpoint
    // with ?v=thumb. Caller should only use it when meta.hasThumb is true.
    async thumbUrl(id: number): Promise<string> {
      const tok = await ensureToken()
      return rest.mediaUrl(`/media/${id}/content`, tok) + '&v=thumb'
    },
  }
}

export type MediaManager = ReturnType<typeof newMediaManager>
