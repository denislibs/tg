export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export class RestClient {
  constructor(private base: string, private getToken: () => string | null) {}

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
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new HttpError(res.status, (data && data.error) || `HTTP ${res.status}`)
    return data as R
  }
}
