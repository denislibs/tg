export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/**
 * Тело ответа-ошибки — конструктор `error{code, text}` (разбор:
 * docs/readiness/tl-rest-analysis.md, Р3). Прежде это был безымянный
 * `{error: "..."}`.
 *
 * Текст берётся ТОЛЬКО у своего конструктора: чужое тело (прокси, шлюз, чужой
 * сервис) описания нашей ошибки не несёт, и подставлять оттуда произвольную
 * строку значило бы показать пользователю чужой текст.
 */
function errorOf(status: number, body: unknown): HttpError {
  const e = body as { _?: string; text?: string } | null | undefined
  const text = e?._ === 'error' && typeof e.text === 'string' ? e.text : `HTTP ${status}`
  return new HttpError(status, text)
}

// Structural-контракт канального RPC (реализуется ChannelRpc). Импортируем как тип-форму,
// а не класс, чтобы не создавать цикл restClient↔channelRpc.
export interface ChannelRpcLike {
  isReady(): boolean
  call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }>
}

export class RestClient {
  // `ready` (опц.) — резолвится, когда токен загружен из хранилища. Запросы ждут
  // его, иначе на старте REST-RPC уходит без токена → 401 «missing token» (гонка:
  // TokenStore.load() читает IDB асинхронно, а UI уже шлёт запросы). Мемоизирован
  // в TokenStore, после первой загрузки резолвится мгновенно.
  constructor(
    private base: string,
    private getToken: () => string | null,
    private ready?: () => Promise<void>,
    private channelRpc?: ChannelRpcLike,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const tok = this.getToken()
    if (tok) h.Authorization = `Bearer ${tok}`
    return h
  }

  async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : ''
    return this.request<R>('GET', path + qs)
  }

  async post<R>(path: string, body: unknown): Promise<R> {
    return this.request<R>('POST', path, body)
  }

  async put<R>(path: string, body: unknown): Promise<R> {
    return this.request<R>('PUT', path, body)
  }

  async patch<R>(path: string, body: unknown): Promise<R> {
    return this.request<R>('PATCH', path, body)
  }

  async del<R>(path: string, body?: unknown): Promise<R> {
    return this.request<R>('DELETE', path, body)
  }

  async putBytes(path: string, body: ArrayBuffer, contentType: string, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    if (this.ready) await this.ready() // дождаться загрузки токена (см. конструктор)
    // XHR вместо fetch: у fetch нет событий прогресса ОТПРАВКИ, а спиннер
    // загрузки медиа (tweb ProgressivePreloader) живёт на xhr.upload.onprogress.
    // Если XHR в этом контексте недоступен — тихий фолбэк на fetch (без прогресса).
    if (typeof XMLHttpRequest === 'undefined') {
      const headers: Record<string, string> = { 'Content-Type': contentType }
      const tok = this.getToken()
      if (tok) headers.Authorization = `Bearer ${tok}`
      const res = await fetch(this.base + path, { method: 'PUT', headers, body, signal })
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', this.base + path)
      xhr.setRequestHeader('Content-Type', contentType)
      const tok = this.getToken()
      if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`)
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total)
        }
      }
      // Отмена аплоада (tweb ProgressivePreloader cancel): signal → xhr.abort()
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.onabort = () => reject(new HttpError(0, 'aborted'))
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new HttpError(xhr.status, `HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new HttpError(0, 'network error'))
      xhr.send(body)
    })
  }

  // Байты медиа worker-fetch'ем с Bearer-заголовком (Task 6, конвейер
  // downloadMediaURL): сессионный токен идёт заголовком, в URL никакого токена
  // нет (прежний путь картинок нёс короткоживущий медиа-токен query-параметром —
  // см. core/mediaUrl.ts). Бинарь остаётся в воркере: blob → CacheStorage →
  // objectURL, через RPC-границу он не сериализуется.
  async getBlob(path: string): Promise<Blob> {
    if (this.ready) await this.ready() // дождаться загрузки токена (см. конструктор)
    const h: Record<string, string> = {}
    const tok = this.getToken()
    if (tok) h.Authorization = `Bearer ${tok}`
    const res = await fetch(this.base + path, { headers: h })
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
    return res.blob()
  }

  // Build a same-origin, token-carrying URL for browser media elements (img/video).
  contentUrl(path: string): string {
    const tok = this.getToken()
    return this.base + path + (tok ? `?token=${encodeURIComponent(tok)}` : '')
  }

  // Build a media URL carrying an explicit (short-lived, media-scoped) token,
  // rather than the session bearer token. Used for avatars/media in <img>/<video>.
  mediaUrl(path: string, token: string): string {
    return this.base + path + `?token=${encodeURIComponent(token)}`
  }

  private async request<R>(method: string, path: string, body?: unknown): Promise<R> {
    // При DNP-ON и готовом канале REST идёт через Noise-канал; иначе (логин/пре-канал) — fetch.
    if (this.channelRpc?.isReady()) {
      const { status, body: respBody } = await this.channelRpc.call(method, path, body)
      if (status < 200 || status >= 300) throw errorOf(status, respBody)
      return respBody as R
    }
    if (this.ready) await this.ready() // дождаться загрузки токена (см. конструктор)
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok) throw errorOf(res.status, data)
    return data as R
  }
}
