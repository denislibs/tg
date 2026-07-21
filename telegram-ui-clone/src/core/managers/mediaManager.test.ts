import { describe, it, expect, vi } from 'vitest'
import { newMediaManager } from './mediaManager'

function fakeRest() {
  return {
    post: vi.fn(async () => ({ media_id: 42 })),
    get: vi.fn(async (p: string) =>
      p === '/media/token'
        ? { token: 'mtok', expires_at: new Date(Date.now() + 900_000).toISOString() }
        : { id: 42, mime: 'image/png', size: 3, width: 10, height: 8, duration: 0, blur_preview: '', has_thumb: true },
    ),
    putBytes: vi.fn(async () => {}),
    contentUrl: (p: string) => '/api' + p + '?token=tok',
    mediaUrl: (p: string, t: string) => '/api' + p + '?token=' + t,
  } as never
}

describe('MediaManager', () => {
  it('upload registers metadata then PUTs bytes, returns media_id', async () => {
    const rest = fakeRest()
    const mgr = newMediaManager({ rest })
    const id = await mgr.upload({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png', size: 3, width: 10, height: 8 })
    expect(id).toBe(42)
    expect((rest as never as { post: ReturnType<typeof vi.fn> }).post).toHaveBeenCalled()
    expect((rest as never as { putBytes: ReturnType<typeof vi.fn> }).putBytes).toHaveBeenCalledWith('/media/42/content', expect.anything(), 'image/png', undefined)
  })

  it('large file with a blob uses the chunked path: parts + finalize', async () => {
    const rest = fakeRest()
    const asFns = rest as never as {
      get: ReturnType<typeof vi.fn>
      putBytes: ReturnType<typeof vi.fn>
      post: ReturnType<typeof vi.fn>
    }
    // GET .../parts must report which parts landed (none yet).
    asFns.get.mockImplementation(async (p: string) =>
      p.endsWith('/parts') ? { received: [], total: 0 } : { media_id: 42 },
    )
    const mgr = newMediaManager({ rest })
    const size = 20 * 1024 * 1024 // 20 MiB → 3 parts (8+8+4) at CHUNK_SIZE=8 MiB
    const blob = new Blob([new Uint8Array(size)], { type: 'video/mp4' })
    const id = await mgr.upload({ blob, mime: 'video/mp4', size, fileName: 'big.mp4' })
    expect(id).toBe(42)
    // Three part PUTs, each to /media/42/parts/{n}?total=3.
    const partCalls = asFns.putBytes.mock.calls.filter((c) => String(c[0]).includes('/parts/'))
    expect(partCalls).toHaveLength(3)
    for (const c of partCalls) expect(String(c[0])).toMatch(/\/media\/42\/parts\/[123]\?total=3/)
    // Finalize posted with the total part count.
    const finalize = asFns.post.mock.calls.find((c) => String(c[0]).endsWith('/finalize'))
    expect(finalize).toBeTruthy()
    expect((finalize![1] as { total: number }).total).toBe(3)
  })

  it('meta maps + caches (one GET for two calls)', async () => {
    const rest = fakeRest()
    const mgr = newMediaManager({ rest })
    const m1 = await mgr.meta(42)
    const m2 = await mgr.meta(42)
    expect(m1.mime).toBe('image/png'); expect(m1.width).toBe(10)
    expect(m2).toEqual(m1)
    expect((rest as never as { get: ReturnType<typeof vi.fn> }).get).toHaveBeenCalledTimes(1)
  })

  it('contentUrl fetches a media token then builds a media-scoped URL', async () => {
    const mgr = newMediaManager({ rest: fakeRest() })
    expect(await mgr.contentUrl(42)).toBe('/api/media/42/content?token=mtok')
  })
})
