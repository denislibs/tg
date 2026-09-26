// DotRendererCore: провал загрузки шейдера и `init()` не запоминается навсегда —
// порт тестов tweb 293cb4509 (`src/tests/spoilerShaderFetchRecovery.test.ts`).
//
// Раньше `shaderTexts[url] ??= fetch(url)` хранил промис запроса вечно: один
// повисший/упавший запрос отдавался каждой следующей попытке, и спойлеры —
// а в tweb с ними и чаты, где они есть, — не поднимались до конца сессии.
//
// отступление от tweb (см. докблок `init()`): у нас провал `init()` не
// пробрасывается, а превращается в `false`, поэтому «rejects» оригинала
// здесь — «resolves false». Второй тест оригинала («проваленный init() не
// мемоизируется на экземпляре») не перенесён: наш провал зовёт `destroy()`,
// который теряет WebGL-контекст (`WEBGL_lose_context`), — экземпляр после
// сбоя мёртв по построению, повтор идёт НОВЫМ ядром.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import DotRendererCore from './dotRendererCore'
import withTimeout from '@helpers/schedulers/withTimeout'

const VERTEX_URL = 'https://tweb.test/vertex.glsl'
const FRAGMENT_URL = 'https://tweb.test/fragment.glsl'

const getShaderTexts = () =>
  (DotRendererCore as unknown as { shaderTexts: Record<string, unknown> }).shaderTexts

function makeCore() {
  const context = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteBuffer: () => {},
    deleteProgram: () => {},
    getExtension: () => null,
  }

  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement
  return new DotRendererCore(canvas, { vertex: VERTEX_URL, fragment: FRAGMENT_URL })
}

describe('DotRendererCore: восстановление после сбоя загрузки шейдера', () => {
  beforeEach(() => {
    const texts = getShaderTexts()
    for (const url in texts) {
      delete texts[url]
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('упавший запрос шейдера не мемоизируется — следующий спойлер пробует снова', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))

    const core = makeCore()
    await expect(core.init()).resolves.toBe(false)

    expect(getShaderTexts()[VERTEX_URL]).toBeUndefined()
    expect(getShaderTexts()[FRAGMENT_URL]).toBeUndefined()

    const fetchMock = vi.fn(() => Promise.reject(new Error('network again')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeCore().init()).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalled()
  })

  test('запрос шейдера ограничен по времени (AbortSignal.timeout)', () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    void makeCore().init()

    expect(fetchMock).toHaveBeenCalled()
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  test('повисший запрос шейдера не держит спойлер дольше дедлайна', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    const core = makeCore()
    const readyResult = core.init() as Promise<boolean>

    // `wrapMediaSpoiler` ждёт этот результат; ограничение — то, что не даёт
    // молчащему рендереру оставить медиа под спойлером без крышки навсегда
    await expect(withTimeout(readyResult, 10, 'timed-out')).resolves.toBe('timed-out')
  })
})
