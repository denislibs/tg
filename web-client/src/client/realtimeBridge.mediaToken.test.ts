// Подъём насоса smp → rootScope перепроверяет медиа-токен у владельца.
//
// Зачем строка `void primeMediaToken(true)` в startRealtime(): всё, что воркер
// публиковал ДО подъёма насоса, мимо вкладки — SuperMessagePort кадры не
// буферизует. Под passcode-локом это окно длиной в весь лок (startRealtime
// гейтится runWhenUnlocked в useAppBootstrap), а Shell под экраном блокировки
// отрисован, и медиа-баблы токен уже спраймили. Сменись за это время активная
// сессия — сбрасывающий кадр rt:logging_out до зеркала не долетит, и оно
// останется с ключом прошлого пользователя до самого истечения (до 15 минут).
//
// Модульные синглтоны (bootstrap's `cached`, realtimeBridge's `started`,
// состояние зеркала) — vi.resetModules() + динамический импорт в каждом кейсе,
// как в realtimeBridge.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'

const { tokenInfo } = vi.hoisted(() => ({ tokenInfo: vi.fn() }))
// Настоящий воркер здесь не нужен: проверяем ровно то, что вкладка спрашивает
// владельца. smp — минимальный порт (насос вешает on, rootScope.setPort — emit).
vi.mock('./bootstrap', () => ({
  startClient: () => ({
    smp: { on: vi.fn(), emit: vi.fn() },
    managers: { media: { tokenInfo }, realtime: { start: vi.fn(async () => {}) } },
  }),
}))

const TOK = (token: string) => ({ token, expiresAt: Date.now() + 900_000 })

async function setup() {
  vi.resetModules()
  tokenInfo.mockReset()
  const mediaUrl = await import('../core/mediaUrl')
  const { startRealtime } = await import('./realtimeBridge')
  return { mediaUrl, startRealtime }
}

afterEach(() => { vi.restoreAllMocks() })

describe('realtimeBridge.startRealtime — перепроверка медиа-токена на подъёме насоса', () => {
  it('накопленный до подъёма насоса снимок перепроверяется у владельца', async () => {
    const { mediaUrl, startRealtime } = await setup()
    tokenInfo.mockResolvedValue(TOK('current-session'))
    mediaUrl.applyMediaToken(TOK('stale-session')) // спраймлен под локом, кадры мимо

    startRealtime()

    expect(tokenInfo).toHaveBeenCalledTimes(1)
  })

  // Отзывчивость: перепроверка не создаёт окна с пустым токеном. Зеркало
  // продолжает отдавать удержанный снимок синхронно, пока не приедет ответ, —
  // иначе каждая разблокировка стоила бы ленте кадра с подложками.
  it('до ответа владельца зеркало продолжает отдавать снимок синхронно', async () => {
    const { mediaUrl, startRealtime } = await setup()
    tokenInfo.mockReturnValue(new Promise(() => {})) // ответ не приезжает
    mediaUrl.applyMediaToken(TOK('stale-session'))

    startRealtime()

    expect(mediaUrl.hasMediaToken()).toBe(true)
    expect(mediaUrl.mediaContentUrl(7)).toContain('stale-session')
  })

  // Обычный старт (без лока): useAppBootstrap уже запросил токен, и запрос
  // перепроверки склеивается с ним — лишнего RPC на каждую загрузку страницы
  // быть не должно.
  it('на обычном старте склеивается с запросом из useAppBootstrap — один RPC', async () => {
    const { mediaUrl, startRealtime } = await setup()
    tokenInfo.mockReturnValue(new Promise(() => {}))
    void mediaUrl.primeMediaToken() // ровно то, что делает useAppBootstrap до startRealtime()

    startRealtime()

    expect(tokenInfo).toHaveBeenCalledTimes(1)
  })
})
