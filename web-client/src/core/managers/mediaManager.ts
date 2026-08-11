import { b64FromBytes } from '../secret/crypto'
import type { RestClient } from '../net/restClient'
import type { FileDownload } from '../net/dnp/fileDownload'
import type { FileUpload } from '../net/dnp/fileUpload'

// Either `bytes` (already in memory, legacy) or `blob` (a File/Blob, preferred for
// large files — sliced per-chunk so the whole file never sits in memory). Files
// above CHUNK_THRESHOLD with a `blob` take the chunked/resumable path.
export interface UploadArgs { bytes?: ArrayBuffer; blob?: Blob; mime: string; size: number; width?: number; height?: number; duration?: number; fileName?: string; progressId?: string; waveform?: Uint8Array }
export interface MediaMeta { id: number; mime: string; size: number; width: number; height: number; duration: number; blurPreview: string; fileName: string; hasThumb: boolean; waveform: string }
/** Снимок короткоживущего медиа-токена: значение + момент истечения (ms epoch).
 * Владелец — воркер; вкладки получают этот же объект и ответом tokenInfo(), и
 * событием rt:media_token (Stage 1C.2, Task 3). */
export interface MediaTokenInfo { token: string; expiresAt: number }

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

// Единственный запас свежести медиа-токена (TTL на бэке — 15 мин): и гейт
// ensureToken, и момент планового обновления. Stage 1C.2 (Task 3): раньше рядом
// жил второй, витринный — core/mediaUrl.ts крутил свой таймер за ~90 с до
// истечения; две копии одного расписания разъезжались по построению.
const TOKEN_MARGIN = 60_000

export function newMediaManager({ rest, onUploadProgress, onToken, fileDownload, fileUpload }: {
  rest: RestLike
  // Прогресс отгрузки байтов (tweb ProgressivePreloader) — воркер транслирует
  // его вкладкам событием media:upload_progress.
  onUploadProgress?: (id: string, loaded: number, total: number) => void
  // Свежий медиа-токен — воркер публикует его всем вкладкам (rt:media_token),
  // витрина (core/mediaUrl.ts) только зеркалит. Опционально: юнит-тесты
  // менеджера конструируют его без воркера.
  onToken?: (t: MediaTokenInfo) => void
  fileDownload?: FileDownload // задан только при DNP-ON: скачивание медиа через канал
  fileUpload?: FileUpload // задан только при DNP-ON: загрузка медиа стримом чанков через канал
}) {
  const metaCache = new Map<number, MediaMeta>()
  // Активные аплоады по progressId (=clientMsgId) — для отмены с бабла (tweb
  // ProgressivePreloader cancel): abort рвёт PUT, upload() кидает 'aborted'.
  const uploadAborts = new Map<string, AbortController>()
  // Cached short-lived media token (refreshed ~1 min before expiry). It only
  // authorizes media reads, so it's safe to put in URLs (unlike the session token).
  let mediaToken = ''
  let mediaTokenExp = 0
  let tokenTimer: ReturnType<typeof setTimeout> | null = null
  let tokenFetch: Promise<string> | null = null
  // Единственное расписание обновления токена (Stage 1C.2, Task 3): перезапрос
  // за TOKEN_MARGIN до истечения — ровно там, где ensureToken перестаёт считать
  // токен свежим. Раньше это делала витрина своим таймером, и токен обновлялся
  // столько раз, сколько открыто вкладок. Пол в 5 с — на случай почти истёкшего
  // ответа сервера: крутить таймер в ноль незачем.
  function scheduleTokenRefresh(): void {
    if (tokenTimer) clearTimeout(tokenTimer)
    tokenTimer = setTimeout(() => { void fetchToken().catch(() => {}) }, Math.max(5_000, mediaTokenExp - Date.now() - TOKEN_MARGIN))
  }
  // ЕДИНСТВЕННАЯ точка, где токен появляется и обновляется: сюда сходятся и
  // ленивый путь (ensureToken из contentUrl/streamUrl/thumbUrl/tokenInfo), и
  // плановый таймер — поэтому и публикация вкладкам ровно одна. tokenFetch
  // склеивает параллельные запросы (N вкладок на холодном старте + сработавший
  // таймер) в один поход в сеть.
  function fetchToken(): Promise<string> {
    if (tokenFetch) return tokenFetch
    tokenFetch = rest.get<{ token: string; expires_at: string }>('/media/token')
      .then((r) => {
        mediaToken = r.token
        mediaTokenExp = new Date(r.expires_at).getTime()
        scheduleTokenRefresh()
        onToken?.({ token: mediaToken, expiresAt: mediaTokenExp })
        return mediaToken
      })
      .finally(() => { tokenFetch = null })
    return tokenFetch
  }
  async function ensureToken(): Promise<string> {
    if (mediaToken && Date.now() < mediaTokenExp - TOKEN_MARGIN) return mediaToken
    return fetchToken()
  }
  // Тело meta() — вынесено, чтобы streamUrl тоже мог достать size/mime без
  // повторной реализации кэша (metaCache не кэширует, пока сервер не проставил thumb).
  async function loadMeta(id: number): Promise<MediaMeta> {
    const hit = metaCache.get(id)
    // Don't cache until the server has finished processing (a thumb may appear
    // a moment after upload); re-fetch while hasThumb is still false.
    if (hit && hit.hasThumb) return hit
    const r = await rest.get<{ id: number; mime: string; size: number; width: number; height: number; duration: number; blur_preview: string; file_name?: string; has_thumb?: boolean; waveform?: string }>(`/media/${id}`)
    const m: MediaMeta = { id: r.id, mime: r.mime, size: r.size, width: r.width, height: r.height, duration: r.duration, blurPreview: r.blur_preview ?? '', fileName: r.file_name ?? '', hasThumb: !!r.has_thumb, waveform: r.waveform ?? '' }
    metaCache.set(id, m)
    return m
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
    signal?: AbortSignal,
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
          }, signal)
          loaded[index - 1] = end - start
          report()
          return
        } catch (e) {
          // Отмена пользователем — не ретраить, пробрасываем сразу.
          if (signal?.aborted || attempt >= PART_ATTEMPTS) throw e
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
        if (signal?.aborted || round === RESUME_ROUNDS - 1) throw e
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
        waveform: a.waveform ? b64FromBytes(a.waveform) : undefined,
      })
      const progress = a.progressId && onUploadProgress
        ? (loaded: number, total: number) => onUploadProgress(a.progressId!, loaded, total)
        : undefined
      // Отмена с бабла (tweb ProgressivePreloader cancel): abort рвёт PUT/части,
      // upload() кидает 'aborted'. Регистрируется по progressId (=clientMsgId).
      const ac = a.progressId ? new AbortController() : undefined
      if (ac && a.progressId) uploadAborts.set(a.progressId, ac)
      try {
        if (fileUpload?.isReady()) {
          // DNP-ON: стрим всего файла чанками по каналу; бэкенд собирает объект и
          // авто-процессит на последнем чанке — finalize НЕ нужен. onProgress —
          // тонкая обёртка над опциональным progress (форвардит, если задан);
          // семантика та же, что при прямой передаче progress.
          const blob = a.blob ?? new Blob([a.bytes!])
          const onProgress = (loaded: number, total: number) => progress?.(loaded, total)
          await fileUpload.uploadStream(r.media_id, blob, a.size, onProgress, ac?.signal)
        } else if (a.blob && a.size > CHUNK_THRESHOLD) {
          // Large files with a Blob → chunked/resumable path; everything else → single PUT.
          await uploadChunked(r.media_id, a.blob, a, progress, ac?.signal)
        } else {
          const bytes = a.bytes ?? await a.blob!.arrayBuffer()
          await rest.putBytes(`/media/${r.media_id}/content`, bytes, a.mime, progress, ac?.signal)
        }
      } finally {
        if (a.progressId) uploadAborts.delete(a.progressId)
      }
      return r.media_id
    },
    // Отмена активного аплоада по progressId (clientMsgId оптимистичного бабла).
    async cancelUpload(progressId: string): Promise<void> {
      uploadAborts.get(progressId)?.abort()
    },
    async meta(id: number): Promise<MediaMeta> { return loadMeta(id) },
    async contentUrl(id: number): Promise<string> {
      const tok = await ensureToken()
      return rest.mediaUrl(`/media/${id}/content`, tok)
    },
    // streamUrl — URL для <video>/<audio>. При DNP-ON отдаёт /dnp-stream/{id} (SW
    // соберёт 206 из чанков Noise-канала; size/mime — для Content-Range/Content-Type,
    // mp4fix армит Chromium AAC-esds патч). Иначе — нативный token-URL (как contentUrl).
    async streamUrl(id: number): Promise<string> {
      if (!fileDownload) {
        const tok = await ensureToken()
        return rest.mediaUrl(`/media/${id}/content`, tok)
      }
      const m = await loadMeta(id)
      let u = `/dnp-stream/${id}?size=${m.size}&mime=${encodeURIComponent(m.mime)}`
      if (m.mime.includes('mp4')) u += '&mp4fix=1'
      return u
    },
    // contentBlob скачивает медиа целиком через DNP-канал (blob создаётся вызывающим
    // main-потоком: objectURL из воркера в DOM невалиден). Только при DNP-ON.
    async contentBlob(id: number): Promise<Blob> {
      if (!fileDownload) throw new Error('media: канал недоступен')
      return fileDownload.downloadMedia(id)
    },
    // The cached media token + its expiry, so the MAIN thread can build media URLs
    // synchronously (no per-image RPC round-trip → no scroll jitter).
    // Stage 1C.2 (Task 3): единственный путь ЗАПРОСА токена для витрины (её
    // расписания больше нет). Он же — канал поздней вкладки: SuperMessagePort
    // события не буферизует, поэтому подключившаяся к живому воркеру вкладка
    // узнаёт текущий токен ответом этого RPC (из кэша, без похода в сеть), а не
    // ждёт следующего планового обновления.
    async tokenInfo(): Promise<MediaTokenInfo> {
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
