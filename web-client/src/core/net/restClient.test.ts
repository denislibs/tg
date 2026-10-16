import { describe, it, expect, vi, afterEach } from 'vitest'
import { RestClient, HttpError } from './restClient'
import { APP_VERSION_FULL } from '../../config/app'

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

  // Заголовки запроса (ключ входа QR) принадлежат неавторизованному устройству, а
  // не сессии DNP-канала: такой запрос идёт fetch-ом МИМО готового канала, иначе
  // сервер не увидел бы заголовок (`rpc_req` их не несёт).
  it('заголовки запроса идут fetch-ом мимо готового канала', async () => {
    const channel = { isReady: () => true, call: vi.fn() }
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"_":"boolTrue"}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok', undefined, channel)
    await rc.post('/auth/export_login_token', {}, { headers: { 'X-Login-Key': 'a'.repeat(64) } })
    expect(channel.call).not.toHaveBeenCalled()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'X-Login-Key': 'a'.repeat(64), 'X-App-Version': APP_VERSION_FULL })
  })

  it('без заголовков запрос по-прежнему идёт каналом', async () => {
    const channel = { isReady: () => true, call: vi.fn(async () => ({ status: 200, body: { ok: 1 } })) }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok', undefined, channel)
    await expect(rc.post('/x', {})).resolves.toEqual({ ok: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Имя отказа (`ApiError.type` у оригинала) — это и есть `error.text`
  // конструктора: по нему экраны ветвятся, а не по человеческому тексту.
  it('имя отказа доезжает до вызывающего полем type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ _: 'error', code: 403, text: 'FRESH_RESET_AUTHORISATION_FORBIDDEN' }), { status: 403 })))
    const rest = new RestClient('/api', () => null)
    const err = await rest.del('/sessions/2').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 403, type: 'FRESH_RESET_AUTHORISATION_FORBIDDEN' })
  })

  // tweb apiManager.ts:759-791: 420 FLOOD_WAIT_N — подождать N секунд и
  // повторить; ожидание дольше 60 с и SLOWMODE_WAIT — отказ вызывающему.
  it('FLOOD_WAIT_N пережидается и запрос повторяется', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ _: 'error', code: 420, text: 'FLOOD_WAIT_2' }), { status: 420 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const rest = new RestClient('/api', () => null)
      const p = rest.get('/updates/channel_difference')
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(p).resolves.toEqual({ ok: 1 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('FLOOD_WAIT дольше 60 с и SLOWMODE_WAIT — отказ без повтора', async () => {
    for (const text of ['FLOOD_WAIT_120', 'SLOWMODE_WAIT_5']) {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ _: 'error', code: 420, text }), { status: 420 }))
      vi.stubGlobal('fetch', fetchMock)
      const rest = new RestClient('/api', () => null)
      await expect(rest.get('/x')).rejects.toMatchObject({ status: 420, type: text })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  // tweb apiManager.ts:800-808: 500 без rawError — повтор с паузой 1 с, затем
  // ×1,5 до потолка 60 с; при заданном stopTime и now >= stopTime — отказ.
  describe('повтор 500', () => {
    const fail500 = () => new Response(JSON.stringify({ _: 'error', code: 500, text: 'could not get dialogs' }), { status: 500 })
    const ok = () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    const useFetch = (...answers: Array<() => Response>) => {
      const fetchMock = vi.fn()
      for (const a of answers) fetchMock.mockImplementationOnce(async () => a())
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    afterEach(() => { vi.useRealTimers() })

    it('500, 500, 200: паузы 1 с и 1,5 с, результат 200', async () => {
      vi.useFakeTimers()
      const fetchMock = useFetch(fail500, fail500, ok)
      const p = new RestClient('/api', () => null).get('/x')
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1499)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      await expect(p).resolves.toEqual({ ok: 1 })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('пауза растёт ×1,5 и упирается в 60 с', async () => {
      vi.useFakeTimers()
      const fetchMock = useFetch(...Array.from({ length: 14 }, () => fail500), ok)
      const delays: number[] = []
      const realSetTimeout = globalThis.setTimeout
      vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) => {
        if (ms !== undefined && ms >= 1000) delays.push(ms)
        return realSetTimeout(fn, ms)
      }) as typeof setTimeout)
      const p = new RestClient('/api', () => null).get('/x')
      await vi.runAllTimersAsync()
      await expect(p).resolves.toEqual({ ok: 1 })
      expect(fetchMock).toHaveBeenCalledTimes(15)
      const expected: number[] = []
      for (let w = 0, i = 0; i < 14; i++) { w = w ? Math.min(60, w * 1.5) : 1; expected.push(w * 1000) }
      expect(delays).toEqual(expected)
      expect(delays[delays.length - 1]).toBe(60_000)
    })

    it('stopTime в прошлом (в том числе -1) — отказ без повтора', async () => {
      for (const stopTime of [-1, Date.now() - 1]) {
        const fetchMock = useFetch(fail500, ok)
        const rest = new RestClient('/api', () => null)
        await expect(rest.post('/x', {}, { stopTime })).rejects.toMatchObject({ status: 500 })
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }
    })

    it('stopTime в будущем — повтор до наступления stopTime, затем отказ', async () => {
      vi.useFakeTimers()
      const fetchMock = useFetch(fail500, fail500, ok)
      const rest = new RestClient('/api', () => null)
      const settled = rest.get('/x', undefined, { stopTime: Date.now() + 1000 }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(999) // 1-й отказ до stopTime → пауза 1 с
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1) // 2-й запрос; его отказ уже на stopTime → без паузы
      expect(await settled).toMatchObject({ status: 500 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('rawError — отказ без повтора', async () => {
      const fetchMock = useFetch(fail500, ok)
      const rest = new RestClient('/api', () => null)
      await expect(rest.post('/x', {}, { rawError: true })).rejects.toMatchObject({ status: 500 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('500 через готовый канал DNP повторяется так же', async () => {
      vi.useFakeTimers()
      const call = vi.fn()
        .mockResolvedValueOnce({ status: 500, body: { _: 'error', code: 500, text: 'x' } })
        .mockResolvedValueOnce({ status: 200, body: { ok: 1 } })
      const rc = new RestClient('/api', () => 'tok', undefined, { isReady: () => true, call })
      const p = rc.post('/x', {})
      await vi.advanceTimersByTimeAsync(1000)
      await expect(p).resolves.toEqual({ ok: 1 })
      expect(call).toHaveBeenCalledTimes(2)
    })

    it('420 и 500 в одном запросе: FLOOD_WAIT пережидается, паузы 500 идут с 1 с', async () => {
      vi.useFakeTimers()
      const flood = () => new Response(JSON.stringify({ _: 'error', code: 420, text: 'FLOOD_WAIT_2' }), { status: 420 })
      const fetchMock = useFetch(flood, fail500, ok)
      const p = new RestClient('/api', () => null).get('/x')
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(p).resolves.toEqual({ ok: 1 })
    })

    it('rawError отключает и пережидание FLOOD_WAIT (tweb :759)', async () => {
      const fetchMock = useFetch(() => new Response(JSON.stringify({ _: 'error', code: 420, text: 'FLOOD_WAIT_2' }), { status: 420 }), ok)
      await expect(new RestClient('/api', () => null).post('/x', {}, { rawError: true })).rejects.toMatchObject({ status: 420 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('прочие отказы (400, 502) не повторяются', async () => {
      for (const status of [400, 502]) {
        const fetchMock = useFetch(() => new Response('{}', { status }), ok)
        await expect(new RestClient('/api', () => null).get('/x')).rejects.toMatchObject({ status })
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }
    })
  })

  // У чужого тела имени нашей ошибки нет — и подставлять туда «HTTP 502»
  // нельзя: вызывающий принял бы это за названную причину.
  it('у чужого тела отказа имени отказа не появляется', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gateway is down' }), { status: 502 })))
    const rest = new RestClient('/api', () => null)
    const err = await rest.get('/me').catch((e: unknown) => e) as { type?: string }
    expect(err.type).toBe('')
  })

  // Версия сборки — то, чем клиент называет себя серверу (аналог `app_version`
  // преамбулы `initConnection`): из неё собирается заголовок строки в списке
  // устройств. Без заголовка строка была бы безымянной.
  it('называет свою версию сборки заголовком X-App-Version', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rest = new RestClient('/api', () => null)
    await rest.get('/me')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-App-Version']).toBe(APP_VERSION_FULL)
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
