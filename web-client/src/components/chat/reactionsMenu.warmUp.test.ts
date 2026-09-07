// Прогрев эффекта постановки — порт `warmUpReactionEffect`
// (tweb `components/chat/reaction.ts:268-278`), который оригинал зовёт на
// КАЖДУЮ ячейку панели быстрых реакций (`reactionsMenu.ts:517-520`), и порт
// фоновой предзагрузки первых семи реакций каталога
// (`appManagers/appReactionsManager.ts:88-115`).
//
// Пины на НАБЛЮДАЕМОЕ СЛЕДСТВИЕ, а не на факт вызова: после открытия панели
// файлы эффекта лежат в кэше `wrappers/stickerContent.ts` — том самом, из
// которого их берёт `wrapSticker` (`wrappers/sticker.ts:361`), — и повторный
// запрос того же файла сети уже не касается. Отдельный файл, потому что здесь
// работает НАСТОЯЩИЙ загрузчик байтов (в `reactionsMenu.test.ts` замокан весь
// `wrapSticker` целиком, и проверять там было бы нечего).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import wrapSticker from '@components/wrappers/sticker'
import { getMiddleware } from '@helpers/middleware'
import { useSettingsStore } from '@/settings'
import { hasStickerContent, loadStickerContent, resetStickerContentCache } from '@components/wrappers/stickerContent'
import { preloadReactionAssets } from './reactions'
import ChatReactionsMenu from './reactionsMenu'

// Иконки ячеек рисует `wrapSticker` — здесь он не нужен и замокан; проверяется
// ровно то, что делает прогрев САМ, помимо отрисовки.
vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)) },
}))
// Токен медиа берётся у воркера — в тесте его нет; URL строится тем же
// правилом, что и в бою (`core/mediaUrl.ts:121-124`).
vi.mock('@core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/api/media/${id}/content?token=t`,
  primeMediaToken: () => Promise.resolve(),
}))

const wrapStickerMock = vi.mocked(wrapSticker)

const USER: PeerId = 42

const AROUND_ID = 9001
const CENTER_ID = 9002
const STATIC_ID = 9003
const APPEAR_ID = 9004
const SELECT_ID = 9005

const url = (mediaId: number) => `/api/media/${mediaId}/content?token=t`

/** Реакция каталога со ВСЕМИ файлами ролей. */
const full = (emoji: string, base: number): AvailableReaction => ({
  emoji, title: '', position: 0, premium: false, inactive: false,
  aroundMediaId: base, centerMediaId: base + 1, staticMediaId: base + 2,
  appearMediaId: base + 3, selectMediaId: base + 4,
})

function makeCatalog(...entries: AvailableReaction[]) {
  return { list: vi.fn(async () => entries) }
}

/** Плеер-двойник панели: она вешает слушатель кадров и различает плеер от
 *  статики через `instanceof` (тот же двойник, что в `reactionsMenu.test.ts`). */
function fakePlayer(): LottiePlayer {
  const player = Object.create(LottiePlayer.prototype) as LottiePlayer
  Object.assign(player, {
    maxFrame: 10, paused: true, autoplay: false,
    addEventListener: vi.fn(), restart: vi.fn(), play: vi.fn(),
  })
  return player
}

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ v: '5.5.7', fr: 60, layers: [] }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  resetStickerContentCache()
  useSettingsStore.setState({ reduceMotion: false })
  fetchMock = stubFetch()
  wrapStickerMock.mockImplementation(() => ({
    render: Promise.resolve(fakePlayer()), width: 28, height: 28, destroy: vi.fn(),
  }))
})

describe('прогрев эффекта панелью (tweb reactionsMenu.ts:517-520)', () => {
  const openMenu = async (catalog: ReturnType<typeof makeCatalog>) => {
    const menu = new ChatReactionsMenu({
      managers: { reactions: catalog },
      peerId: USER,
      middleware: getMiddleware().get(),
      onFinish: vi.fn(),
    })
    await menu.init()
    return menu
  }

  it('после открытия панели файлы эффекта уже скачаны', async () => {
    await openMenu(makeCatalog({
      emoji: '👍', title: '', position: 0, premium: false, inactive: false,
      aroundMediaId: AROUND_ID, centerMediaId: CENTER_ID,
      staticMediaId: STATIC_ID, appearMediaId: APPEAR_ID, selectMediaId: SELECT_ID,
    }))

    // tweb :274-277 — прогреваются ровно два файла эффекта.
    await vi.waitFor(() => {
      expect(hasStickerContent(AROUND_ID)).toBe(true)
      expect(hasStickerContent(CENTER_ID)).toBe(true)
    })

    // Наблюдаемое следствие: то, чем эффект берёт свои файлы в момент клика
    // (`wrappers/sticker.ts:361` — тот же `loadStickerContent`), сети уже не
    // касается.
    const before = fetchMock.mock.calls.length
    await expect(loadStickerContent(AROUND_ID)).resolves.toMatchObject({ kind: 'lottie' })
    await expect(loadStickerContent(CENTER_ID)).resolves.toMatchObject({ kind: 'lottie' })
    expect(fetchMock.mock.calls.length).toBe(before)
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([url(AROUND_ID), url(CENTER_ID)])
  })

  it('«без анимаций» не качает ничего (tweb :269-271 liteMode effects_reactions)', async () => {
    useSettingsStore.setState({ reduceMotion: true })
    await openMenu(makeCatalog({
      emoji: '👍', title: '', position: 0, premium: false, inactive: false,
      aroundMediaId: AROUND_ID, centerMediaId: CENTER_ID,
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hasStickerContent(AROUND_ID)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * Фоновая предзагрузка каталога — порт `AppReactionsManager.after`
 * (appReactionsManager.ts:88-115): первые СЕМЬ реакций, по четыре файла на
 * каждую, с паузой в секунду между реакциями.
 */
describe('предзагрузка каталога (tweb appReactionsManager.ts:88-115)', () => {
  const bigCatalog = (n: number) =>
    makeCatalog(...Array.from({ length: n }, (_, i) => full(`e${i}`, 100 + i * 10)))

  it('качает четыре роли первых семи реакций и не трогает восьмую', async () => {
    vi.useFakeTimers()
    try {
      const catalog = bigCatalog(9)
      void preloadReactionAssets({ reactions: catalog })
      // Пауза между реакциями — секунда (tweb :112).
      await vi.advanceTimersByTimeAsync(7 * 1000)

      const requested = fetchMock.mock.calls.map(([u]) => u)
      // tweb :95-100 — around, static, appear, center. `select` в списке нет:
      // его качает сама панель, когда открывается.
      expect(requested).toContain(url(100))
      expect(requested).toContain(url(101))
      expect(requested).toContain(url(102))
      expect(requested).toContain(url(103))
      expect(requested).not.toContain(url(104))
      // Седьмая реакция прогрета, восьмая — нет (tweb :102 `Math.min(7, ...)`).
      expect(requested).toContain(url(160))
      expect(requested).not.toContain(url(170))
    } finally {
      vi.useRealTimers()
    }
  })

  // Точка входа — эффект React (`core/hooks/useAppBootstrap.ts`), а он
  // переигрывается на каждом монтировании Shell; у оригинала подписка на
  // `user_auth` срабатывает раз на вход. Пин на следствие: второй заход не
  // заводит НИКАКОЙ работы — он завершается в том же тике, тогда как первый
  // растянут паузами оригинала (:112).
  it('второй заход по тому же каталогу не заводит новой работы', async () => {
    vi.useFakeTimers()
    try {
      const catalog = bigCatalog(1)
      void preloadReactionAssets({ reactions: catalog })
      await vi.advanceTimersByTimeAsync(1000)
      const before = fetchMock.mock.calls.length
      expect(before).toBeGreaterThan(0)

      let done = false
      void preloadReactionAssets({ reactions: catalog }).then(() => { done = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toBe(true)
      expect(fetchMock.mock.calls.length).toBe(before)
      expect(catalog.list).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Пометка «этот каталог уже прогрет» не должна переживать ОТКАЗ запроса
   * каталога: `catalogCache` (reactions.ts:146-148) упавший запрос выбрасывает,
   * и остальное приложение список перезапросит. Если пометку не снимать, один
   * сетевой сбой на 7.5-й секунде выключал бы предзагрузку на всю жизнь
   * страницы — а у оригинала её питает зеркало воркера, которое держит свой
   * retry (appReactionsManager.ts:94).
   */
  it('отказ каталога не выключает предзагрузку навсегда', async () => {
    vi.useFakeTimers()
    try {
      const catalog = {
        list: vi.fn()
          .mockImplementationOnce(async () => { throw new Error('offline') })
          .mockImplementation(async () => [full('e0', 100)]),
      }

      await preloadReactionAssets({ reactions: catalog })
      expect(catalog.list).toHaveBeenCalledTimes(1)
      expect(fetchMock).not.toHaveBeenCalled()

      // Второй заход (следующее монтирование Shell) обязан попробовать заново.
      void preloadReactionAssets({ reactions: catalog })
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock.mock.calls.map(([u]) => u)).toContain(url(100))
    } finally {
      vi.useRealTimers()
    }
  })
})
