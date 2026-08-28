import { describe, it, expect, vi, afterEach } from 'vitest'
import { RestClient, HttpError } from './restClient'

describe('RestClient', () => {
  it('GETs with the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rest = new RestClient('/api', () => 'tok123')

    const out = await rest.get<{ status: string }>('/health')
    expect(out).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok123' })
  })

  it('throws on non-2xx with the error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ _: 'error', code: 401, text: 'invalid code' }), { status: 401 })))
    const rest = new RestClient('/api', () => null)
    await expect(rest.post('/auth/sign_in', {})).rejects.toThrow('invalid code')
  })

  it('чужое тело отказа НЕ подставляется как текст ошибки', async () => {
    // Прокси/шлюз отвечает своей страницей: описания ошибки в ней нет, и
    // показать её пользователю значило бы показать чужой HTML. Текст берётся
    // только у своего конструктора `error`.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gateway is down' }), { status: 502 })))
    const rest = new RestClient('/api', () => null)
    await expect(rest.get('/me')).rejects.toThrow('HTTP 502')
  })

  it('ждёт готовности токена перед запросом (нет гонки missing-token на старте)', async () => {
    // Воркер грузит токен из IDB асинхронно; REST-RPC не должен уйти без него.
    let token: string | null = null
    let markReady!: () => void
    const ready = new Promise<void>((res) => { markReady = () => { token = 'tok'; res() } })
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const rest = new RestClient('/api', () => token, () => ready)
    const p = rest.get('/me')
    // токен ещё не загружен → запрос не ушёл
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    markReady()
    await p
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('putBytes PUTs a raw body with the content-type and bearer (XHR + progress)', async () => {
    // putBytes использует XMLHttpRequest ради событий прогресса отправки —
    // мокаем минимально: open/setRequestHeader/send + upload.onprogress + onload.
    const opened: { method: string; url: string } = { method: '', url: '' }
    const headers: Record<string, string> = {}
    const progresses: number[] = []
    class FakeXHR {
      status = 0
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open(method: string, url: string) { opened.method = method; opened.url = url }
      setRequestHeader(k: string, v: string) { headers[k] = v }
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 3 })
        this.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 3 })
        this.status = 204
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    const c = new RestClient('/api', () => 'tok')
    await c.putBytes('/media/5/content', new Uint8Array([1, 2, 3]).buffer, 'image/png', (loaded) => progresses.push(loaded))
    expect(opened.method).toBe('PUT')
    expect(opened.url).toBe('/api/media/5/content')
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers.Authorization).toBe('Bearer tok')
    expect(progresses).toEqual([2, 3])
  })
})

const channelRpc = (ready: boolean, resp: { status: number; body: unknown }) => ({
  isReady: () => ready,
  call: vi.fn(async () => resp),
})

describe('RestClient routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes through the channel when channelRpc.isReady() and returns the body', async () => {
    const ch = channelRpc(true, { status: 200, body: { id: 5 } })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    await expect(rc.get('/me')).resolves.toEqual({ id: 5 })
    expect(ch.call).toHaveBeenCalledWith('GET', '/me', undefined)
  })

  it('maps a non-2xx channel status to HttpError', async () => {
    const ch = channelRpc(true, { status: 403, body: { _: 'error', code: 403, text: 'forbidden' } })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    const err = await rc.get('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 403, message: 'forbidden' })
  })

  it('falls back to fetch when channel is NOT ready', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ via: 'http' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ch = channelRpc(false, { status: 200, body: null })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    await expect(rc.get('/me')).resolves.toEqual({ via: 'http' })
    expect(ch.call).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('with no channelRpc uses fetch (unchanged behavior)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok')
    await expect(rc.post('/z', { a: 1 })).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalled()
  })

  // ── провод TL ──────────────────────────────────────────────────────────────
  //
  // Формат просит КЛИЕНТ заголовком `Accept` — так же, как у сокета
  // подпротоколом `tl.1`. Витрина при этом одна: сервер собирает её из той же
  // модели, поэтому переключение обратимо.

  it('без включённого провода TL заголовок Accept не просит байтов', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok')

    await rc.get('/me')
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBeUndefined()
  })

  it('провод TL: просит байты заголовком и разбирает их по Content-Type', async () => {
    const body = new Uint8Array([1, 2, 3, 4])
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-tl' } }))
    vi.stubGlobal('fetch', fetchMock)
    const decode = vi.fn((_raw: Uint8Array) => ({ _: 'peerUser', user_id: 7 }))
    const rc = new RestClient('/api', () => 'tok')
    rc.useTLWire(decode)

    await expect(rc.get('/saved')).resolves.toEqual({ _: 'peerUser', user_id: 7 })
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toContain('application/x-tl')
    expect(Array.from(decode.mock.calls[0][0])).toEqual([1, 2, 3, 4])
  })

  it('витрина БЕЗ конструктора остаётся JSON-ом даже на проводе TL', async () => {
    // Границы шага A/B названы явно: чужие протоколы, транспорт медиа и наши
    // подсистемы без предмета в схеме кодировать нечем. Клиент узнаёт это по
    // Content-Type ответа, а не по своей просьбе.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ has_password: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const decode = vi.fn((_raw: Uint8Array) => ({ _: 'НЕ ДОЛЖНО ВЫЗЫВАТЬСЯ' }))
    const rc = new RestClient('/api', () => 'tok')
    rc.useTLWire(decode)

    await expect(rc.get('/me/password')).resolves.toEqual({ has_password: true })
    expect(decode).not.toHaveBeenCalled()
  })

  it('отказ на проводе TL тоже разбирается — и текст берётся у конструктора', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9]), {
      status: 400, headers: { 'Content-Type': 'application/x-tl' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok')
    rc.useTLWire(() => ({ _: 'error', code: 400, text: 'PHONE_INVALID' }))

    await expect(rc.post('/auth/sign_in', {})).rejects.toThrow('PHONE_INVALID')
  })
})
