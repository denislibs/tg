// Владелец медиа-токена на смене активной сессии (resetToken).
//
// Кто зовёт — воркер, синхронно в момент перехода и ДО публикации намерения
// (пин на саму проводку — core/workerCore.mediaTokenReset.test.ts); здесь
// проверяется, что именно сброс делает с состоянием владельца: токен прошлого
// пользователя выброшен, его расписание снято, а ответ на запрос, улетевший до
// перехода, не кэшируется и не публикуется — при этом звонящий не остаётся ни с
// чем (иначе бабл, начавший сборку URL ровно в момент перехода, застрял бы на
// подложке).
import { describe, expect, it, vi, afterEach } from 'vitest'
import { newMediaManager, type MediaTokenInfo } from './mediaManager'

const TTL = 900_000 // как на бэке: mediaTokenTTL = 15 мин (mediatoken.go)
const MARGIN = 60_000 // единственный запас свежести (mediaManager.ts::TOKEN_MARGIN)

// rest, отдающий новый токен на каждый /media/token; ответы можно задержать
// (answer) — тогда тест сам решает, когда запрос приземлится.
function fakeRest() {
  const pending: Array<(v: { token: string; expires_at: string }) => void> = []
  let n = 0
  const get = vi.fn((p: string) => {
    if (p !== '/media/token') throw new Error('unexpected get ' + p)
    n++
    const token = `mtok${n}`
    return new Promise<{ token: string; expires_at: string }>((resolve) => {
      pending.push(resolve)
      if (!hold) answer(token)
    })
  })
  let hold = false
  const answer = (token: string) => {
    pending.shift()?.({ token, expires_at: new Date(Date.now() + TTL).toISOString() })
  }
  return {
    rest: { post: vi.fn(), get, putBytes: vi.fn(), contentUrl: (p: string) => '/api' + p, mediaUrl: (p: string, t: string) => '/api' + p + '?token=' + t } as never,
    tokenGets: () => get.mock.calls.length,
    hold: () => { hold = true },
    answer,
  }
}

// Микротаски внутренних .then/.finally менеджера.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

afterEach(() => { vi.useRealTimers() })

describe('mediaManager: сброс токена на смене активной сессии', () => {
  it('после сброса прежний токен не отдаётся — владелец идёт в сеть за новым', async () => {
    const { rest, tokenGets } = fakeRest()
    const mgr = newMediaManager({ rest })
    expect(await mgr.contentUrl(1)).toContain('mtok1')

    mgr.resetToken()

    expect(await mgr.contentUrl(1)).toContain('mtok2')
    expect(tokenGets()).toBe(2)
  })

  // Расписание принадлежит сессии: у той, которой больше нет, таймер обновления
  // продолжал бы дёргать /media/token в пустоту (а на логауте — заведомо в 401).
  it('сброс снимает расписание обновления прошлой сессии', async () => {
    vi.useFakeTimers()
    const { rest, tokenGets } = fakeRest()
    const mgr = newMediaManager({ rest })
    await mgr.contentUrl(1) // таймер армится на TTL - MARGIN
    expect(tokenGets()).toBe(1)

    mgr.resetToken()
    await vi.advanceTimersByTimeAsync(TTL)

    expect(tokenGets()).toBe(1)
  })

  // Гонка перехода на стороне владельца: GET /media/token улетел с ПРЕЖНИМ
  // session-токеном, ответ вернулся уже после перехода. Закэшируй его — и
  // владелец продолжит раздавать вкладкам ключ к медиа прошлого аккаунта, а
  // onToken разошлёт его всем.
  it('ответ, улетевший до сброса, не кэшируется и не публикуется, а звонящий получает токен текущей сессии', async () => {
    const { rest, hold, answer, tokenGets } = fakeRest()
    const got: MediaTokenInfo[] = []
    const mgr = newMediaManager({ rest, onToken: (t) => got.push(t) })
    hold()
    const p = mgr.tokenInfo()

    mgr.resetToken()
    answer('mtok1') // ответ прошлой сессии
    await flush()
    answer('mtok2') // повторный запрос, уже под текущей

    expect((await p).token).toBe('mtok2')
    expect(got.map((t) => t.token)).toEqual(['mtok2'])
    expect(tokenGets()).toBe(2)
    expect(await mgr.contentUrl(1)).toContain('mtok2') // в кэше владельца — токен текущей сессии
  })

  // Опоздавший ответ не плодит лишних походов в сеть: он не начинает свой
  // запрос, а присоединяется к уже летящему запросу текущей сессии (return
  // fetchToken() внутри гейта поколения). Пин на это — здесь; отдельного
  // гейта в .finally для того же нет сознательно: стейл-ветка ЖДЁТ тот самый
  // летящий запрос, поэтому её finally отрабатывает уже после его собственного
  // и обнулять чужую склейку ей нечем (проверено мутацией — гейт в finally
  // не красил ни одного теста).
  it('опоздавший ответ прошлой сессии не сбивает склейку текущей', async () => {
    const { rest, hold, answer, tokenGets } = fakeRest()
    const mgr = newMediaManager({ rest })
    hold()
    void mgr.tokenInfo()

    mgr.resetToken()
    void mgr.tokenInfo() // запрос текущей сессии — в полёте
    expect(tokenGets()).toBe(2)

    answer('mtok1') // ответ прошлой сессии приземлился
    await flush()
    void mgr.tokenInfo() // должен присоединиться к летящему, а не завести третий

    expect(tokenGets()).toBe(2)
  })

  // Порог свежести после сброса не «сползает»: новый токен живёт по тем же
  // правилам, что и любой другой (кэш до отметки «истечение минус MARGIN»).
  it('добытый после сброса токен кэшируется как обычно', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const { rest, tokenGets } = fakeRest()
    const mgr = newMediaManager({ rest })
    await mgr.contentUrl(1)
    mgr.resetToken()
    await mgr.contentUrl(2)
    expect(tokenGets()).toBe(2)

    vi.setSystemTime(t0 + TTL - MARGIN - 1_000)
    await mgr.contentUrl(3)

    expect(tokenGets()).toBe(2)
  })
})
