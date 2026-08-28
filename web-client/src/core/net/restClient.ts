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

// Провод REST: JSON либо TL — по договорённости, заключённой ЗАГОЛОВКОМ.
//
// Тот же приём, что у сокета, где формат просится подпротоколом `tl.1`: провод
// это свойство ЗАПРОСА, а не витрины. Сервер умеет обе формы и собирает их из
// одной модели (`backend/.../wiretl.go`), поэтому переключение обратимо.
const WIRE_TL_CONTENT_TYPE = 'application/x-tl'

export class RestClient {
  // `ready` (опц.) — резолвится, когда токен загружен из хранилища. Запросы ждут
  // его, иначе на старте REST-RPC уходит без токена → 401 «missing token» (гонка:
  // TokenStore.load() читает IDB асинхронно, а UI уже шлёт запросы). Мемоизирован
  // в TokenStore, после первой загрузки резолвится мгновенно.
  // Разбор TL подключается ИЗВНЕ (`useTLWire`), а не импортируется здесь:
  // `tl_utils` со схемой тянет за собой сотни килобайт, и при выключенном
  // флаге они не должны попадать в бандл — так же сделано у сокета.
  private decodeTL?: (raw: Uint8Array) => unknown

  constructor(
    private base: string,
    private getToken: () => string | null,
    private ready?: () => Promise<void>,
    private channelRpc?: ChannelRpcLike,
  ) {}

  /** Включает провод TL: клиент начинает просить его заголовком `Accept`. */
  useTLWire(decode: (raw: Uint8Array) => unknown): void {
    this.decodeTL = decode
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    // Тело запроса остаётся JSON и на проводе TL: конструкторов у наших
    // ЗАПРОСОВ нет — ими стали только витрины (шаги A/B фазы 3).
    if (this.decodeTL) h.Accept = `${WIRE_TL_CONTENT_TYPE}, application/json`
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
    const data = await this.decodeBody(res)
    if (!res.ok) throw errorOf(res.status, data)
    return data as R
  }

  /**
   * Тело ответа в дерево — формой, которую выбрал СЕРВЕР.
   *
   * Различается по `Content-Type`, а не по нашей просьбе: витрина без
   * конструктора уезжает JSON-ом на любом проводе (чужие протоколы, транспорт
   * медиа, свои подсистемы без предмета в схеме — названные границы шага A/B),
   * и это не сбой. Ровно так же сокет различает кадр без конструктора.
   */
  private async decodeBody(res: Response): Promise<unknown> {
    const kind = (res.headers.get('Content-Type') ?? '').split(';')[0].trim()
    if (this.decodeTL && kind === WIRE_TL_CONTENT_TYPE) {
      const raw = new Uint8Array(await res.arrayBuffer())
      if (!raw.length) return undefined
      return this.decodeTL(raw)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : undefined
  }
}
