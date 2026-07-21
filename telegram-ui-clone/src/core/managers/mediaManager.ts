import type { RestClient } from '../net/restClient'

// Either `bytes` (already in memory, legacy) or `blob` (a File/Blob, preferred for
// large files — sliced per-chunk so the whole file never sits in memory). Files
// above CHUNK_THRESHOLD with a `blob` take the chunked/resumable path.
export interface UploadArgs { bytes?: ArrayBuffer; blob?: Blob; mime: string; size: number; width?: number; height?: number; duration?: number; fileName?: string; progressId?: string }
export interface MediaMeta { id: number; mime: string; size: number; width: number; height: number; duration: number; blurPreview: string; fileName: string; hasThumb: boolean }

interface RestLike {
  post: RestClient['post']
  get: RestClient['get']
  putBytes: RestClient['putBytes']
  contentUrl: RestClient['contentUrl']
  mediaUrl: RestClient['mediaUrl']
}

// Files larger than this use the chunked/resumable upload path (fixed-size parts,
// limited concurrency, per-part retry + resume). Smaller files keep the single-PUT
// path. CHUNK_SIZE == threshold guarantees every non-final part is a full chunk,
// satisfying the storage's multipart minimum-part-size rule.
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MiB
const CHUNK_THRESHOLD = CHUNK_SIZE
const PART_CONCURRENCY = 3
const PART_ATTEMPTS = 3
const RESUME_ROUNDS = 3

export function newMediaManager({ rest, onUploadProgress }: {
  rest: RestLike
  // Прогресс отгрузки байтов (tweb ProgressivePreloader) — воркер транслирует
  // его вкладкам событием media:upload_progress.
  onUploadProgress?: (id: string, loaded: number, total: number) => void
}) {
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
  // Chunked/resumable upload: slice the Blob into fixed-size parts and upload them
  // with limited concurrency + per-part retry, reporting aggregate progress. On a
  // failure we re-query which parts landed (GET .../parts) and re-send only the
  // missing ones — so an interrupted upload resumes instead of restarting. Only one
  // chunk per worker is ever read into memory (blob.slice → arrayBuffer).
  async function uploadChunked(
    mediaId: number,
    blob: Blob,
    a: UploadArgs,
    progress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const total = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE))
    const loaded = new Array<number>(total).fill(0) // bytes acked per part (index-1)
    const partSize = (i: number) => Math.min(i * CHUNK_SIZE, blob.size) - (i - 1) * CHUNK_SIZE
    const report = () => progress?.(loaded.reduce((s, n) => s + n, 0), blob.size)

    // Upload part `index` (1-based) with retry; progress is tracked per part.
    const uploadPart = async (index: number): Promise<void> => {
      const start = (index - 1) * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, blob.size)
      const buf = await blob.slice(start, end).arrayBuffer()
      for (let attempt = 1; ; attempt++) {
        try {
          await rest.putBytes(`/media/${mediaId}/parts/${index}?total=${total}`, buf, a.mime, (l) => {
            loaded[index - 1] = l
            report()
          })
          loaded[index - 1] = end - start
          report()
          return
        } catch (e) {
          if (attempt >= PART_ATTEMPTS) throw e
        }
      }
    }

    for (let round = 0; round < RESUME_ROUNDS; round++) {
      // Which parts already landed (resume): skip them, count them as done.
      let received = new Set<number>()
      try {
        const r = await rest.get<{ received: number[]; total: number }>(`/media/${mediaId}/parts`)
        received = new Set(r.received ?? [])
      } catch { /* treat as none received */ }
      const missing: number[] = []
      for (let i = 1; i <= total; i++) {
        if (received.has(i)) loaded[i - 1] = partSize(i)
        else missing.push(i)
      }
      report()
      if (missing.length === 0) break

      const queue = missing.slice()
      const worker = async () => {
        for (let idx = queue.shift(); idx !== undefined; idx = queue.shift()) await uploadPart(idx)
      }
      try {
        await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, worker))
        break // all missing parts uploaded — done
      } catch (e) {
        if (round === RESUME_ROUNDS - 1) throw e
        // else: retry the round — re-query received and re-send what's still missing.
      }
    }

    await rest.post(`/media/${mediaId}/finalize`, {
      mime: a.mime, size: a.size, total,
      width: a.width ?? 0, height: a.height ?? 0, duration: a.duration ?? 0, file_name: a.fileName ?? '',
    })
  }

  return {
    async upload(a: UploadArgs): Promise<number> {
      const r = await rest.post<{ media_id: number }>('/media/upload', {
        mime: a.mime, size: a.size, width: a.width ?? 0, height: a.height ?? 0, duration: a.duration ?? 0,
        file_name: a.fileName ?? '',
      })
      const progress = a.progressId && onUploadProgress
        ? (loaded: number, total: number) => onUploadProgress(a.progressId!, loaded, total)
        : undefined
      // Large files with a Blob → chunked/resumable path; everything else → single PUT.
      if (a.blob && a.size > CHUNK_THRESHOLD) {
        await uploadChunked(r.media_id, a.blob, a, progress)
      } else {
        const bytes = a.bytes ?? await a.blob!.arrayBuffer()
        await rest.putBytes(`/media/${r.media_id}/content`, bytes, a.mime, progress)
      }
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
