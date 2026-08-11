// Зеркало медиа-токена на смене активной сессии (resetMediaToken).
//
// Кто зовёт — проектор по кадру rt:logging_out (пин на саму строку —
// client/realtime/storeProjection.mediaTokenReset.test.ts); здесь проверяется,
// что именно сброс делает с модульным состоянием зеркала: снимок прошлого
// пользователя больше не отдаётся, подписчики разбужены (иначе бабл остался бы
// с мёртвым src и подложкой), а летящий ответ владельца, запрошенный ПРОШЛОЙ
// сессией, к зеркалу не приземляется.
//
// Модульное состояние (token/version/priming) живёт в модуле — каждый кейс
// поднимает свежий реестр (vi.resetModules) и импортирует зеркало и
// React-хелперы ПОСЛЕ сброса, как в mediaUrl.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tokenInfo } = vi.hoisted(() => ({ tokenInfo: vi.fn() }))
vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers: { media: { tokenInfo } } }) }))

const TOK = (token: string) => ({ token, expiresAt: Date.now() + 900_000 })

let m: typeof import('./mediaUrl')
let rtl: typeof import('@testing-library/react')

// Микротаски внутренних .then/.finally зеркала: их несколько подряд, одного
// `await Promise.resolve()` не хватает (на этом мутация .finally сначала
// выживала — тест просто не доживал до неё).
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

// Управляемый ответ владельца: тест сам решает, когда он приземлится.
function deferred() {
  let resolve!: (t: { token: string; expiresAt: number }) => void
  const promise = new Promise<{ token: string; expiresAt: number }>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.resetModules()
  tokenInfo.mockReset()
  tokenInfo.mockResolvedValue(TOK('worker-tok'))
  m = await import('./mediaUrl')
  rtl = await import('@testing-library/react')
})

describe('mediaUrl — сброс зеркала на смене активной сессии', () => {
  it('после сброса прежний токен не отдаётся, а подписчики разбужены', () => {
    m.applyMediaToken(TOK('account-a'))
    const { result } = rtl.renderHook(() => m.useMediaTokenVersion())
    const v0 = result.current

    rtl.act(() => { m.resetMediaToken() })

    expect(m.hasMediaToken()).toBe(false)
    expect(m.mediaContentUrl(7)).not.toContain('account-a')
    expect(result.current).not.toBe(v0) // баблы пересоберут src и запросят токен текущей сессии
  })

  // Гонка перехода: вкладка спросила токен, ответ ещё летит, и ровно в этот
  // момент сессия ушла. Без обесценивания поколения ответ прошлой сессии
  // приземлился бы уже ПОСЛЕ сброса — зеркало снова отдавало бы ключ прошлого
  // пользователя, причём молча.
  it('ответ владельца, запрошенный до сброса, к зеркалу не применяется', async () => {
    const d = deferred()
    tokenInfo.mockReturnValueOnce(d.promise)
    const p = m.primeMediaToken()

    m.resetMediaToken()
    d.resolve(TOK('account-a'))
    await p

    expect(m.hasMediaToken()).toBe(false)
  })

  // Склейка запросов (priming) переживать сброс не должна: следующий
  // потребитель обязан начать НОВЫЙ запрос, иначе он ждал бы ответа, которому
  // зеркало всё равно не поверит, — и остался бы без токена навсегда
  // (застрявшая подложка вместо картинки).
  it('после сброса следующий потребитель идёт к владельцу заново', async () => {
    const d = deferred()
    tokenInfo.mockReturnValueOnce(d.promise)
    void m.primeMediaToken()

    m.resetMediaToken()
    tokenInfo.mockResolvedValueOnce(TOK('account-b'))
    await m.primeMediaToken()

    expect(tokenInfo).toHaveBeenCalledTimes(2)
    expect(m.hasMediaToken()).toBe(true)
    expect(m.mediaContentUrl(7)).toContain('account-b')

    d.resolve(TOK('account-a')) // опоздавший ответ прошлой сессии ничего не меняет
    await flush()
    expect(m.mediaContentUrl(7)).toContain('account-b')
  })

  // Поколение переставило и то, ЧТО отдаётся звонящему (был `return priming`,
  // стало `return p`): промис обязан остаться тем самым, который ждёт ответа
  // владельца. Резолвнись он раньше — те, кто именно ждёт токен перед сборкой
  // URL (StickerMedia, waveform, mediaPlaybackController, secret/mediaCache),
  // пошли бы строить URL с пустым токеном.
  it('ожидающий primeMediaToken() дожидается ответа владельца, а не резолвится раньше', async () => {
    const d = deferred()
    tokenInfo.mockReturnValueOnce(d.promise)
    let settled = false
    void m.primeMediaToken().then(() => { settled = true })

    await flush()
    expect(settled).toBe(false)

    d.resolve(TOK('account-b'))
    await flush()

    expect(settled).toBe(true)
    expect(m.hasMediaToken()).toBe(true)
  })

  // Тот же опоздавший ответ не должен и снимать склейку ТЕКУЩЕЙ сессии: иначе
  // его finally обнулит чужой priming и параллельные баблы разъедутся по
  // отдельным RPC вместо одного.
  it('опоздавший ответ прошлой сессии не сбивает склейку текущей', async () => {
    const dOld = deferred()
    const dNew = deferred()
    tokenInfo.mockReturnValueOnce(dOld.promise)
    void m.primeMediaToken()

    m.resetMediaToken()
    tokenInfo.mockReturnValueOnce(dNew.promise)
    void m.primeMediaToken()
    expect(tokenInfo).toHaveBeenCalledTimes(2)

    dOld.resolve(TOK('account-a'))
    await flush()
    void m.primeMediaToken() // должен присоединиться к летящему запросу, а не завести третий

    expect(tokenInfo).toHaveBeenCalledTimes(2)

    dNew.resolve(TOK('account-b'))
    await flush()
    expect(m.mediaContentUrl(7)).toContain('account-b')
  })
})
