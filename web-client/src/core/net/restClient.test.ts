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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid code' }), { status: 401 })))
    const rest = new RestClient('/api', () => null)
    await expect(rest.post('/auth/sign_in', {})).rejects.toThrow('invalid code')
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
    const ch = channelRpc(true, { status: 403, body: { error: 'forbidden' } })
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
})
