import { describe, it, expect, vi } from 'vitest'
import { RestClient } from './restClient'

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
