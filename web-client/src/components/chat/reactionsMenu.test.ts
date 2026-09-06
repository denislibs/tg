// Панель быстрых реакций — порт tweb `ChatReactionsMenu` (reactionsMenu.ts).
//
// Пины: разметка и число ячеек (tweb `REACTIONS_MAX_LENGTH = 7`, :42 +
// `getActiveAvailableReactions` — без `inactive`); последовательность
// `appear → select`, переключаемая ПО ПОСЛЕДНЕМУ КАДРУ `appear` (:653-663);
// перезапуск `select` на наведении (:711-735); клик отдаёт реакцию наружу
// (:156-171); и поведение без каталога — панель обязана остаться невидимой,
// а не показать пустую пилюлю.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { Reaction } from '@core/models'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import wrapSticker from '@components/wrappers/sticker'
import animationIntersector from '@components/animationIntersector'
import { getMiddleware } from '@helpers/middleware'
import { useSettingsStore } from '@/settings'
import ChatReactionsMenu, { REACTIONS_MAX_LENGTH } from './reactionsMenu'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)) },
}))

const wrapStickerMock = vi.mocked(wrapSticker)

/** Плеер-двойник: панель различает плеер от статики через `instanceof`
 *  (у оригинала обе роли панели — всегда lottie). */
function fakePlayer() {
  const player = Object.create(LottiePlayer.prototype) as LottiePlayer
  const frameListeners: ((frameNo: number) => void)[] = []
  Object.assign(player, {
    maxFrame: 10,
    paused: true,
    autoplay: false,
    addEventListener: (name: string, cb: (frameNo: number) => void) => {
      if (name === 'enterFrame') frameListeners.push(cb)
    },
    restart: vi.fn(),
    play: vi.fn(),
  })
  return { player, fireFrame: (n: number) => frameListeners.forEach((cb) => cb(n)) }
}

type CatalogEntry = Partial<AvailableReaction> & { emoji: string }

function makeCatalog(...entries: CatalogEntry[]) {
  return {
    list: vi.fn(async () => entries.map((e) => ({
      title: '', position: 0, premium: false, inactive: false,
      appearMediaId: 1, selectMediaId: 2, staticMediaId: 3,
      ...e,
    } as AvailableReaction))),
  }
}

/** Каталог из N реакций с разными эмодзи — «в панель влезает не всё». */
function bigCatalog(n: number) {
  return makeCatalog(...Array.from({ length: n }, (_, i) => ({ emoji: `e${i}` })))
}

function menu(catalog?: { list(): Promise<AvailableReaction[]> }) {
  return new ChatReactionsMenu({
    managers: { reactions: catalog },
    type: 'horizontal',
    middleware: getMiddleware().get(),
    onFinish,
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let onFinish: Mock<(reaction: Reaction) => void>

function cells(m: ChatReactionsMenu) {
  return Array.from(m.container.querySelectorAll<HTMLElement>('.btn-menu-reactions-reaction'))
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  useSettingsStore.setState({ reduceMotion: false })
  onFinish = vi.fn()
  // Каждый `render` — своя пара плееров: у ячейки их два (appear + select).
  wrapStickerMock.mockImplementation(() => ({
    render: Promise.resolve(fakePlayer().player), width: 28, height: 28, destroy: vi.fn(),
  }))
})

describe('ChatReactionsMenu — разметка (tweb :106-176, 526-682)', () => {
  it('строит контейнер ширины, хвостик и панель классами оригинала', async() => {
    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    expect(m.widthContainer.classList.contains('btn-menu-reactions-container')).toBe(true)
    expect(m.widthContainer.classList.contains('btn-menu-reactions-container-horizontal')).toBe(true)
    expect(m.widthContainer.classList.contains('btn-menu-transition')).toBe(true)
    expect(m.widthContainer.querySelector('.btn-menu-reactions-bubble.btn-menu-reactions-bubble-big')).toBeTruthy()
    expect(m.container.classList.contains('btn-menu-reactions')).toBe(true)

    const cell = cells(m)[0]
    const scale = cell.firstElementChild as HTMLElement
    expect(scale.classList.contains('btn-menu-reactions-reaction-scale')).toBe(true)
    expect(scale.children[0].classList.contains('btn-menu-reactions-reaction-appear')).toBe(true)
    expect(scale.children[1].classList.contains('btn-menu-reactions-reaction-select')).toBe(true)
    expect(scale.children[1].classList.contains('hide')).toBe(true)
  })

  it('показывает панель только после отрисовки ячеек (`is-visible`, tweb :192-196)', async() => {
    const m = menu(makeCatalog({ emoji: '👍' }))
    expect(m.widthContainer.classList.contains('is-visible')).toBe(false)

    await m.init()
    await flush()

    expect(m.widthContainer.classList.contains('is-visible')).toBe(true)
  })
})

describe('ChatReactionsMenu — состав (tweb :213 + getActiveAvailableReactions)', () => {
  it('берёт не больше REACTIONS_MAX_LENGTH реакций в порядке каталога', async() => {
    const m = menu(bigCatalog(REACTIONS_MAX_LENGTH + 3))
    await m.init()
    await flush()

    // 7 — само число оригинала (tweb :42), а не «сколько получилось».
    expect(REACTIONS_MAX_LENGTH).toBe(7)
    expect(cells(m)).toHaveLength(REACTIONS_MAX_LENGTH)
  })

  it('не показывает `inactive` реакции', async() => {
    const m = menu(makeCatalog(
      { emoji: '👍', inactive: true, appearMediaId: 91, selectMediaId: 92 },
      { emoji: '❤️', appearMediaId: 81, selectMediaId: 82 },
      { emoji: '🔥', inactive: true, appearMediaId: 71, selectMediaId: 72 },
    ))
    await m.init()
    await flush()

    expect(cells(m)).toHaveLength(1)
    // Отрисована ИМЕННО активная: в панель ушли только её файлы ролей.
    const mediaIds = wrapStickerMock.mock.calls.map((call) => call[0].mediaId).sort()
    expect(mediaIds).toEqual([81, 82])
  })

  it('без каталога панель остаётся невидимой и пустой (исход `chatReactionsNone`, tweb :245-247)', async() => {
    const m = menu(undefined)
    await m.init()
    await flush()

    expect(cells(m)).toHaveLength(0)
    expect(m.widthContainer.classList.contains('is-visible')).toBe(false)
  })

  it('реакция без файлов ролей показывает своё эмодзи, а не пустую ячейку', async() => {
    const m = menu(makeCatalog({
      emoji: '🔥', appearMediaId: undefined, selectMediaId: undefined,
      staticMediaId: undefined, centerMediaId: undefined,
    }))
    await m.init()
    await flush()

    expect(cells(m)).toHaveLength(1)
    expect(cells(m)[0].textContent).toBe('🔥')
    expect(wrapStickerMock).not.toHaveBeenCalled()
  })

  it('приехавшая иконка снимает текстовое эмодзи', async() => {
    const m = menu(makeCatalog({ emoji: '🔥' }))
    await m.init()
    await flush()

    expect(cells(m)[0].textContent).toBe('')
  })

  it('пустой каталог (ассетов реакций нет) панель не показывает', async() => {
    const m = menu(makeCatalog())
    await m.init()
    await flush()

    expect(cells(m)).toHaveLength(0)
    expect(m.widthContainer.classList.contains('is-visible')).toBe(false)
  })
})

describe('ChatReactionsMenu — appear → select (tweb :642-676)', () => {
  /** Пара «appear, select» одной ячейки: `wrapSticker` зовётся в порядке
   *  select → appear (tweb :644 и :658), поэтому двойники раздаются по вызову. */
  function withPlayers() {
    const select = fakePlayer()
    const appear = fakePlayer()
    const players = [select, appear]
    let i = 0
    wrapStickerMock.mockImplementation(() => ({
      render: Promise.resolve(players[i++]!.player), width: 28, height: 28, destroy: vi.fn(),
    }))
    return { select, appear }
  }

  it('до последнего кадра `appear` виден он, `select` спрятан', async() => {
    const { appear } = withPlayers()
    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    appear.fireFrame(5)
    await flush()

    const cell = cells(m)[0]
    expect(cell.querySelector('.btn-menu-reactions-reaction-appear')!.classList.contains('hide')).toBe(false)
    expect(cell.querySelector('.btn-menu-reactions-reaction-select')!.classList.contains('hide')).toBe(true)
  })

  it('на последнем кадре `appear` слои меняются местами', async() => {
    const { appear } = withPlayers()
    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    appear.fireFrame(appear.player.maxFrame)
    await flush()

    const cell = cells(m)[0]
    expect(cell.querySelector('.btn-menu-reactions-reaction-appear')!.classList.contains('hide')).toBe(true)
    expect(cell.querySelector('.btn-menu-reactions-reaction-select')!.classList.contains('hide')).toBe(false)
  })

  it('ждёт первого кадра `select` перед подменой (tweb :670-676)', async() => {
    const { select, appear } = withPlayers()
    let resolveFirstFrame: (player: LottiePlayer) => void = () => {}
    vi.mocked(lottieLoader.waitForFirstFrame).mockReturnValueOnce(
      new Promise((resolve) => { resolveFirstFrame = resolve }) as Promise<LottiePlayer>,
    )

    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    appear.fireFrame(appear.player.maxFrame)
    await flush()
    const cell = cells(m)[0]
    expect(cell.querySelector('.btn-menu-reactions-reaction-select')!.classList.contains('hide')).toBe(true)

    resolveFirstFrame(select.player)
    await flush()
    expect(cell.querySelector('.btn-menu-reactions-reaction-select')!.classList.contains('hide')).toBe(false)
  })

  it('наведение перезапускает `select`, пока `appear` доиграл (tweb :711-735)', async() => {
    const { select, appear } = withPlayers()
    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    appear.fireFrame(appear.player.maxFrame)
    await flush()

    const cell = cells(m)[0]
    // `appear` ещё играет — оригинал ховер игнорирует (:723-726).
    appear.player.paused = false
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(select.player.restart).not.toHaveBeenCalled()

    appear.player.paused = true
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(select.player.restart).toHaveBeenCalledTimes(1)
    expect(select.player.autoplay).toBe(true)
  })
})

describe('ChatReactionsMenu — выбор и уборка', () => {
  it('клик по ячейке отдаёт наружу её реакцию (tweb :156-171)', async() => {
    const m = menu(makeCatalog({ emoji: '👍' }, { emoji: '❤️' }))
    await m.init()
    await flush()

    cells(m)[1].click()

    expect(onFinish).toHaveBeenCalledWith({ _: 'reactionEmoji', emoticon: '❤️' })
  })

  it('клик мимо ячейки ничего не выбирает', async() => {
    const m = menu(makeCatalog({ emoji: '👍' }))
    await m.init()
    await flush()

    m.container.click()

    expect(onFinish).not.toHaveBeenCalled()
  })

  it('панель снимает запрет простоя на свою группу только на время жизни (tweb :149,313)', async() => {
    const spy = vi.spyOn(animationIntersector, 'setOverrideIdleGroup')
    const m = menu(makeCatalog({ emoji: '👍' }))
    const group = spy.mock.calls[0][0]
    expect(spy).toHaveBeenCalledWith(group, true)

    await m.init()
    await flush()
    m.cleanup()

    expect(spy).toHaveBeenCalledWith(group, false)
    spy.mockRestore()
  })
})
