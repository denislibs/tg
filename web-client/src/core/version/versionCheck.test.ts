import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkVersion, APP_VERSION_FULL } from './versionCheck'
import { useUpdateStore } from '../../stores/updateStore'

function mockFetch(body: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
}

describe('checkVersion', () => {
  beforeEach(() => {
    useUpdateStore.setState({ available: false })
    vi.restoreAllMocks()
  })

  it('помечает обновление при расхождении версий', async () => {
    mockFetch('999.0.0 (999)')
    expect(await checkVersion()).toBe(true)
    expect(useUpdateStore.getState().available).toBe(true)
  })

  it('не помечает при совпадении версий', async () => {
    mockFetch(APP_VERSION_FULL)
    expect(await checkVersion()).toBe(false)
    expect(useUpdateStore.getState().available).toBe(false)
  })

  it('игнорирует не-200 ответы', async () => {
    mockFetch('999.0.0 (999)', 500)
    expect(await checkVersion()).toBe(false)
    expect(useUpdateStore.getState().available).toBe(false)
  })
})
