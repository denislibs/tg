// Stage 1C.2 (Task 3): медиа-токен — воркер единственный владелец. Здесь пины на
// сторону ВЛАДЕЛЬЦА: единственная точка получения токена публикует его наружу
// (onToken) и на первом ленивом запросе, и на плановом обновлении; расписание
// живёт тут же; порог свежести после переезда остался ровно один (TOKEN_MARGIN),
// а параллельные потребители не размножают походы в сеть.
//
// Зеркало (core/mediaUrl.ts) проверяется отдельно — core/mediaUrl.test.ts, а
// стык владельца с зеркалом через настоящий веер воркера —
// core/workerCore.mediaToken.test.ts (сравнение ответа владельца с состоянием
// зеркала напрямую, а не «через витрину»).
import { describe, expect, it, vi, afterEach } from 'vitest'
import { newMediaManager, type MediaTokenInfo } from './mediaManager'

const TTL = 900_000 // как на бэке: mediaTokenTTL = 15 мин (mediatoken.go)
const MARGIN = 60_000 // единственный запас свежести (mediaManager.ts::TOKEN_MARGIN)

// rest, отдающий на каждый /media/token новый токен с заданным временем жизни;
// счётчик походов в сеть — отдельным полем, чтобы пинить их число.
function fakeRest(ttl = TTL) {
  let n = 0
  const get = vi.fn(async (p: string) => {
    if (p === '/media/token') {
      n++
      return { token: `mtok${n}`, expires_at: new Date(Date.now() + ttl).toISOString() }
    }
    return { id: 42, mime: 'image/png', size: 3, width: 10, height: 8, duration: 0, blur_preview: '', has_thumb: true }
  })
  return {
    rest: { post: vi.fn(), get, putBytes: vi.fn(), contentUrl: (p: string) => '/api' + p, mediaUrl: (p: string, t: string) => '/api' + p + '?token=' + t } as never,
    tokenGets: () => get.mock.calls.filter((c) => c[0] === '/media/token').length,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('mediaManager: медиа-токен — владелец и его расписание (Stage 1C.2, Task 3)', () => {
  // Что ломается без onToken в fetchToken: вкладки не узнают ни первый токен,
  // ни одно последующее обновление — зеркало навсегда останется пустым, а
  // медиа-баблы застрянут на подложке (URL синхронно собрать не из чего).
  it('первый (ленивый) запрос публикует снимок токена наружу', async () => {
    const { rest } = fakeRest()
    const got: MediaTokenInfo[] = []
    const mgr = newMediaManager({ rest, onToken: (t) => got.push(t) })

    const info = await mgr.tokenInfo()

    expect(got).toHaveLength(1)
    expect(got[0]).toEqual(info) // публикуется ровно то, что владелец отдал звонящему
    expect(got[0].token).toBe('mtok1')
  })

  // Полнота канала: токен появляется не только через tokenInfo(). Любой путь,
  // которому нужен токен, идёт через ensureToken → fetchToken → publish.
  it('токен, добытый ради contentUrl/streamUrl, публикуется тем же каналом', async () => {
    for (const call of [
      (m: ReturnType<typeof newMediaManager>) => m.contentUrl(42),
      (m: ReturnType<typeof newMediaManager>) => m.streamUrl(42),
    ]) {
      const { rest } = fakeRest()
      const got: MediaTokenInfo[] = []
      const mgr = newMediaManager({ rest, onToken: (t) => got.push(t) })
      await call(mgr)
      expect(got).toHaveLength(1)
      expect(got[0].token).toBe('mtok1')
    }
  })

  // Единственное расписание обновления. Что ломается без scheduleTokenRefresh:
  // токен никто не перезапрашивает заранее (витрина свой таймер потеряла) —
  // он тихо доживает до истечения, и все URL начинают отдавать 401.
  it('обновляет токен сам за MARGIN до истечения и публикует новый', async () => {
    vi.useFakeTimers()
    const { rest, tokenGets } = fakeRest()
    const got: MediaTokenInfo[] = []
    const mgr = newMediaManager({ rest, onToken: (t) => got.push(t) })
    await mgr.tokenInfo()
    expect(tokenGets()).toBe(1)

    await vi.advanceTimersByTimeAsync(TTL - MARGIN - 1_000) // ещё рано
    expect(tokenGets()).toBe(1)

    await vi.advanceTimersByTimeAsync(2_000) // прошли момент планового обновления
    expect(tokenGets()).toBe(2)
    expect(got).toHaveLength(2)
    expect(got[1].token).toBe('mtok2')
    // Обновление само переарминает таймер — расписание не одноразовое.
    await vi.advanceTimersByTimeAsync(TTL)
    expect(got.length).toBeGreaterThanOrEqual(3)
  })

  // Порог свежести один и тот же и по значению, и по месту. Мутация 60_000 →
  // 30_000 красит второй ассерт (запрос не пошёл), 60_000 → 90_000 — первый
  // (пошёл лишний).
  it('ensureToken отдаёт кэш до отметки «истечение минус MARGIN» и идёт в сеть после неё', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const { rest, tokenGets } = fakeRest()
    const mgr = newMediaManager({ rest })
    await mgr.contentUrl(1)
    expect(tokenGets()).toBe(1)

    // Часы двигаем без прокрутки таймеров — проверяем именно гейт ensureToken.
    vi.setSystemTime(t0 + TTL - MARGIN - 1_000)
    await mgr.contentUrl(2)
    expect(tokenGets()).toBe(1)

    vi.setSystemTime(t0 + TTL - MARGIN + 1_000)
    await mgr.contentUrl(3)
    expect(tokenGets()).toBe(2)
  })

  // Число походов в сеть. Что ломается без tokenFetch: на холодном старте
  // столько GET /media/token, сколько вкладок и элементов дёрнули медиа разом —
  // и столько же взаимно затирающих публикаций.
  it('параллельные потребители склеиваются в один поход в сеть и одну публикацию', async () => {
    const { rest, tokenGets } = fakeRest()
    const got: MediaTokenInfo[] = []
    const mgr = newMediaManager({ rest, onToken: (t) => got.push(t) })

    const [info, url, stream] = await Promise.all([mgr.tokenInfo(), mgr.contentUrl(1), mgr.streamUrl(2)])

    expect(tokenGets()).toBe(1)
    expect(got).toHaveLength(1)
    expect(url).toContain(info.token)
    expect(stream).toContain(info.token)
  })

  // Пин на clearTimeout + пол в 5 с внутри scheduleTokenRefresh. Сервер отдаёт
  // почти истёкший токен (10 с при запасе 60) — каждый вызов идёт в сеть, и
  // каждый успех арминает новый таймер поверх старого. Без clearTimeout прошлый
  // таймер доживает и стреляет лишним запросом; без пола задержка отрицательная
  // и таймер начинает бить очередью.
  it('переарминает свой таймер, а не копит их (и не уходит в отрицательную задержку)', async () => {
    vi.useFakeTimers()
    const { rest, tokenGets } = fakeRest(10_000)
    const mgr = newMediaManager({ rest })
    await mgr.contentUrl(1) // GET #1, таймер на t0+5с (пол)
    await vi.advanceTimersByTimeAsync(2_000)
    await mgr.contentUrl(2) // GET #2, таймер переармлен на t0+7с
    expect(tokenGets()).toBe(2)

    await vi.advanceTimersByTimeAsync(3_500) // t0+5.5с: старый таймер сюда попадал бы
    expect(tokenGets()).toBe(2)
  })

  it('onToken опционален — без него токен добывается как прежде', async () => {
    const { rest } = fakeRest()
    const mgr = newMediaManager({ rest })
    await expect(mgr.contentUrl(42)).resolves.toBe('/api/media/42/content?token=mtok1')
  })
})
