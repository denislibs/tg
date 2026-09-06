// Реакции бабла — порт tweb `ReactionsElement`/`ReactionElement`.
//
// Пины: разметка чипа; развилка «аватарки ИЛИ число» (tweb reaction.ts:1029,
// :1065 + reactions.ts:304-307 — считается по СУММЕ реакций сообщения, а не по
// одному чипу); отсутствие узла, когда реакций нет вовсе; и эффект вокруг чипа
// (`fireAroundAnimation`) — кто его запускает и что он рисует.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageReactions, Reaction } from '@core/models'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import { getMiddleware } from '@helpers/middleware'
import { resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror, saveChatFull } from '@core/chatFullCache'
import { useSettingsStore } from '@/settings'
import wrapSticker from '@components/wrappers/sticker'
import wrapStickerAnimation from '@components/wrappers/stickerAnimation'
import {
  createReactionsElement,
  getAvailableReactionsForPeer,
  REACTIONS_DISPLAY_COUNTER_AT,
  type ReactionsElementOptions,
} from './reactions'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
vi.mock('@components/wrappers/stickerAnimation', () => ({ default: vi.fn() }))

const wrapStickerMock = vi.mocked(wrapSticker)
const wrapStickerAnimationMock = vi.mocked(wrapStickerAnimation)

/** Плеер-двойник: ветка эффекта различает плеер от статики через `instanceof`
 *  (у оригинала эффект — всегда lottie), поэтому двойник обязан быть им же. */
function fakePlayer() {
  const player = Object.create(LottiePlayer.prototype) as LottiePlayer
  const frameListeners: ((frameNo: number) => void)[] = []
  const firstFrameListeners: (() => void)[] = []
  Object.assign(player, {
    maxFrame: 10,
    // Канвасы у настоящего плеера есть всегда (`lottiePlayer.ts:102`), и
    // иконка чипа помечает их классом `media-sticker` — двойник без них
    // притворялся бы контрактом, которого не бывает.
    canvas: [document.createElement('canvas')],
    paused: true,
    addEventListener: (name: string, cb: (frameNo: number) => void) => {
      if (name === 'enterFrame') frameListeners.push(cb)
    },
    onFirstFrame: (cb: () => void) => { firstFrameListeners.push(cb) },
    play: vi.fn(function(this: LottiePlayer) { (this as { paused: boolean }).paused = false }),
    remove: vi.fn(),
  })
  return {
    player,
    fireFirstFrame: () => firstFrameListeners.forEach((cb) => cb()),
    fireFrame: (n: number) => frameListeners.forEach((cb) => cb(n)),
  }
}

/** Два пира условия `canRenderAvatars` (tweb reactions.ts:304-307): в личке
 *  «список видно» выводит сам клиент, в группе — только по флагу сервера. */
const USER: PeerId = 42
const CHAT: PeerId = -700

const AROUND_ID = 111
const CENTER_ID = 222

const STATIC_ID = 333

type CatalogEntry = Partial<AvailableReaction> & { emoji: string }

/** Каталог мемоизируется по объекту-менеджеру (порт кэша оригинала,
 *  appReactionsManager.ts:169), поэтому двойник у каждого теста СВОЙ — иначе
 *  счёт вызовов `list` тёк бы между тестами. */
function makeCatalog(...entries: CatalogEntry[]) {
  return {
    list: vi.fn(async () => entries.map((e) => ({
      title: '', position: 0, premium: false, inactive: false, ...e,
    } as AvailableReaction))),
  }
}

let catalog: ReturnType<typeof makeCatalog>

const agg = (...counts: { emoticon: string; count: number; mine?: boolean; recent?: PeerId[] }[]): MessageReactions => ({
  _: 'messageReactions',
  results: counts.map((c) => ({
    _: 'reactionCount',
    reaction: { _: 'reactionEmoji', emoticon: c.emoticon },
    count: c.count,
    ...(c.mine ? { chosen_order: 0 } : {}),
  })),
  recent_reactions: counts.flatMap((c) => (c.recent ?? []).map((peerId) => ({
    _: 'messagePeerReaction' as const,
    peer_id: { _: 'peerUser' as const, user_id: peerId },
    date: 0,
    reaction: { _: 'reactionEmoji' as const, emoticon: c.emoticon },
  }))),
})

/** Тот же агрегат, но сервер сказал «список реагировавших доступен»
 *  (`messageReactions.pFlags.can_see_list`) — так он приезжает из ГРУППЫ. */
const canSeeList = (a: MessageReactions): MessageReactions => ({ ...a, pFlags: { can_see_list: true } })

/** Бабл, УЖЕ показанный в ленте: только у такого изменение реакций играет
 *  эффект (tweb `ReactionsElement.isConnected`, reactions.ts:421). */
function mountedBubble(): HTMLElement {
  const bubble = document.createElement('div')
  document.body.append(bubble)
  return bubble
}

function options(over: Partial<ReactionsElementOptions> = {}): ReactionsElementOptions {
  return {
    peerId: USER,
    bubble: mountedBubble(),
    middleware: getMiddleware().get(),
    managers: { peers: { fillMirror: vi.fn(async () => {}) }, reactions: catalog },
    ...over,
  }
}

beforeEach(() => {
  resetPeerMirror()
  resetChatFullMirror()
  document.body.replaceChildren()
  vi.clearAllMocks()
  useSettingsStore.setState({ reduceMotion: false })
  catalog = makeCatalog({ emoji: '👍', aroundMediaId: AROUND_ID, centerMediaId: CENTER_ID })
  wrapStickerMock.mockReturnValue({
    render: Promise.resolve(fakePlayer().player), width: 22, height: 22, destroy: vi.fn(),
  })
  wrapStickerAnimationMock.mockImplementation(() => ({
    animationDiv: document.createElement('div'),
    stickerPromise: Promise.resolve(fakePlayer().player),
  }))
})

describe('createReactionsElement', () => {
  it('чип несёт эмодзи и разметку оригинала', () => {
    const el = createReactionsElement(agg({ emoticon: '👍', count: 1 }))!

    expect(el.classList.contains('reactions')).toBe(true)
    expect(el.classList.contains('reactions-block')).toBe(true)

    const chip = el.querySelector('.reaction')!
    // tweb reaction.ts:757-758: класс раскладки И общий для block/tag
    // `reaction-like-block` — в нём высота пилюли, её внешние отступы и
    // `--chosen-background-color` (`_reaction.scss:219-230`).
    expect(chip.classList.contains('reaction-block')).toBe(true)
    expect(chip.classList.contains('reaction-like-block')).toBe(true)
    expect(chip.querySelector('.reaction-sticker')!.textContent).toBe('👍')
  })

  it('is-last — только на последнем чипе ряда (tweb reactions.ts:319)', () => {
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 1 },
      { emoticon: '🔥', count: 1 },
    ))!

    const chips = el.querySelectorAll('.reaction')
    expect(chips[0].classList.contains('is-last')).toBe(false)
    expect(chips[1].classList.contains('is-last')).toBe(true)
  })

  it('МОЯ реакция помечена is-chosen ВМЕСТЕ с forwards (tweb reaction.ts:1086-1097)', () => {
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 2, mine: true },
      { emoticon: '🔥', count: 1 },
    ))!

    const chips = el.querySelectorAll('.reaction')
    expect(chips[0].classList.contains('is-chosen')).toBe(true)
    // Подложку акцентного цвета CSS зажигает только по паре классов
    // (`_reaction.scss:127-133`), поэтому `forwards` — часть состояния, а не
    // деталь анимации.
    expect(chips[0].classList.contains('forwards')).toBe(true)
    expect(chips[1].classList.contains('is-chosen')).toBe(false)
    expect(chips[1].classList.contains('forwards')).toBe(false)
  })

  it('при первом показе бабла заливка не проигрывается (tweb reaction.ts:1093 — duration 0)', () => {
    const el = createReactionsElement(agg({ emoticon: '👍', count: 2, mine: true }))!

    // `animating` — единственный класс, включающий transition
    // (`_reaction.scss:140-148`); на ещё не вставленном чипе его быть не должно.
    expect(el.querySelector('.reaction')!.classList.contains('animating')).toBe(false)
  })

  it('реакций нет — узла тоже нет (пустой занял бы строку под баблом)', () => {
    expect(createReactionsElement(undefined)).toBeUndefined()
    expect(createReactionsElement({ _: 'messageReactions', results: [] })).toBeUndefined()
  })

  it('порядок чипов — порядок вектора результатов', () => {
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 5 },
      { emoticon: '🔥', count: 9 },
    ))!

    const stickers = [...el.querySelectorAll('.reaction-sticker')].map((s) => s.textContent)
    expect(stickers).toEqual(['👍', '🔥'])
  })
})

describe('иконка чипа из каталога (tweb ReactionElement.render/renderDoc)', () => {
  const flushIcon = async () => {
    for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('роль каталога — center, размер показа 40 (is-regular), класс is-regular', async () => {
    const el = createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 1 }), options())!
    await flushIcon()

    // tweb reaction.ts:817 + :888-897. Размер — ПОКАЗЫВАЕМЫЙ: `is-regular`
    // раздувает медиа до `--reaction-size + --reaction-offset * -2` = 22 + 18
    // (`_reaction.scss:47-56`), и канвас обязан быть нарисован в этот размер,
    // иначе CSS растянет 22 до 40 мылом.
    expect(wrapStickerMock).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: CENTER_ID, width: 40, height: 40, play: false, loop: false, needFadeIn: false,
    }))
    // tweb :807-811.
    const sticker = el.querySelector('.reaction-sticker')!
    expect(sticker.classList.contains('is-regular')).toBe(true)
    expect(sticker.classList.contains('is-static')).toBe(false)
    // Текстовое эмодзи — только подложка на время загрузки, иконка его снимает.
    expect(sticker.textContent).toBe('')
  })

  it('нет center — берётся static, класс is-static и размер контейнера (tweb :807-808,:817)', async () => {
    catalog = makeCatalog({ emoji: '\u{1F44D}', staticMediaId: STATIC_ID })

    const el = createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 1 }), options())!
    await flushIcon()

    // У `is-static` правила раздувания нет вовсе (`_reaction.scss:47-56` — только
    // `is-regular`), значит показывается ровно `REACTIONS_SIZE[Block]`.
    expect(wrapStickerMock).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: STATIC_ID, width: 22, height: 22,
    }))
    const sticker = el.querySelector('.reaction-sticker')!
    expect(sticker.classList.contains('is-static')).toBe(true)
  })

  it('канвас иконки помечен media-sticker — иначе правила чипа до него не достают', async () => {
    // На этом классе висят ОБА правила иконки: гашение на время эффекта
    // (`_reaction.scss:41-45`) и размер `is-regular` (:47-56). У tweb медиа
    // иконки всегда `img.media-sticker` (`static: true`, reaction.ts:894), у нас
    // — `canvas.lottie`, и без явного класса чип оставался бы видимым ПОД
    // оверлеем эффекта.
    const canvas = document.createElement('canvas')
    const player = fakePlayer().player
    Object.assign(player, { canvas: [canvas] })
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(player), width: 40, height: 40, destroy: vi.fn() })

    createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 1 }), options())
    await flushIcon()

    expect(canvas.classList.contains('media-sticker')).toBe(true)
  })

  it('inactive-реакция помечает ЧИП (tweb :813-815)', async () => {
    catalog = makeCatalog({ emoji: '\u{1F44D}', centerMediaId: CENTER_ID, inactive: true })

    const el = createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 1 }), options())!
    await flushIcon()

    expect(el.querySelector('.reaction')!.classList.contains('is-inactive')).toBe(true)
  })

  it('реакции нет в каталоге — остаётся текстовое эмодзи, стикер не грузится', async () => {
    const el = createReactionsElement(agg({ emoticon: '\u{1F525}', count: 1 }), options())!
    await flushIcon()

    expect(wrapStickerMock).not.toHaveBeenCalled()
    expect(el.querySelector('.reaction-sticker')!.textContent).toBe('\u{1F525}')
  })

  it('каталог читается ОДИН раз на все чипы (порт кэша appReactionsManager.ts:169)', async () => {
    const opts = options()
    createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 1 }, { emoticon: '\u{1F525}', count: 1 }), opts)
    createReactionsElement(agg({ emoticon: '\u{1F44D}', count: 2 }), opts)
    await flushIcon()

    expect(catalog.list).toHaveBeenCalledTimes(1)
  })
})

describe('аватарки вместо числа (tweb renderAvatars/renderCounter)', () => {
  it('до порога в личке — стек аватарок, числа нет', () => {
    expect(REACTIONS_DISPLAY_COUNTER_AT).toBe(4)

    const el = createReactionsElement(agg({ emoticon: '👍', count: 2, recent: [7, 8] }), options())!

    expect(el.querySelector('.reaction-counter')).toBeNull()
    const stack = el.querySelector('.stacked-avatars')!
    expect(stack.querySelectorAll('.stacked-avatars-avatar-container')).toHaveLength(2)
  })

  it('с порога — число, а стека нет', () => {
    const el = createReactionsElement(agg({ emoticon: '👍', count: 4, recent: [7] }), options())!

    expect(el.querySelector('.reaction-counter')!.textContent).toBe('4')
    expect(el.querySelector('.stacked-avatars')).toBeNull()
  })

  it('порог считается по СУММЕ реакций сообщения (tweb reactions.ts:304-307)', () => {
    // Каждый чип поодиночке ниже порога, но вместе их уже четыре.
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 2, recent: [7] },
      { emoticon: '🔥', count: 2, recent: [8] },
    ), options())!

    expect(el.querySelectorAll('.reaction-counter')).toHaveLength(2)
    expect(el.querySelector('.stacked-avatars')).toBeNull()
  })

  it('в группе БЕЗ can_see_list — аватарок нет, показывается число', () => {
    // Так приезжает вещательный канал: реакции там анонимны, сервер флага не
    // ставит, и остаётся ветка оригинала `canRenderAvatars === false`.
    const el = createReactionsElement(agg({ emoticon: '👍', count: 2, recent: [7] }), options({ peerId: CHAT }))!

    expect(el.querySelector('.stacked-avatars')).toBeNull()
    expect(el.querySelector('.reaction-counter')!.textContent).toBe('2')
  })

  it('в группе С can_see_list — стек аватарок, числа нет (tweb reactions.ts:306)', () => {
    const el = createReactionsElement(
      canSeeList(agg({ emoticon: '👍', count: 2, recent: [7, 8] })),
      options({ peerId: CHAT }),
    )!

    expect(el.querySelector('.reaction-counter')).toBeNull()
    const stack = el.querySelector('.stacked-avatars')!
    expect(stack.querySelectorAll('.stacked-avatars-avatar-container')).toHaveLength(2)
  })

  it('can_see_list порога не отменяет: с порога в группе снова число', () => {
    const el = createReactionsElement(
      canSeeList(agg({ emoticon: '👍', count: 4, recent: [7] })),
      options({ peerId: CHAT }),
    )!

    expect(el.querySelector('.reaction-counter')!.textContent).toBe('4')
    expect(el.querySelector('.stacked-avatars')).toBeNull()
  })

  it('без опций (нечем строить аватарки) — тоже число', () => {
    const el = createReactionsElement(agg({ emoticon: '👍', count: 1 }))!
    expect(el.querySelector('.reaction-counter')!.textContent).toBe('1')
  })

  it('большое число сокращается (tweb reaction.ts:1035 formatNumber)', () => {
    // В канале счётчик уходит в тысячи; сырое «12500» растянуло бы пилюлю.
    const el = createReactionsElement(agg({ emoticon: '👍', count: 12500 }), options({ peerId: CHAT }))!
    expect(el.querySelector('.reaction-counter')!.textContent).toBe('12.5K')

    const el2 = createReactionsElement(agg({ emoticon: '👍', count: 1234 }), options({ peerId: CHAT }))!
    expect(el2.querySelector('.reaction-counter')!.textContent).toBe('1.23K')
  })
})

describe('fireAroundAnimation', () => {
  /** Прошлое поколение узла: только из него берётся «а сколько было». */
  const previousWith = (...counts: Parameters<typeof agg>) =>
    createReactionsElement(agg(...counts), options())!

  /** Пропустить все ступени цепочки запуска (heavy-animation, каталог,
   *  `Promise.all` плееров) — иначе «не позвали» значило бы «не успели». */
  const flush = async () => {
    for (let i = 0; i < 10; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('своя новая реакция запускает эффект: around-полёт + оверлей center-иконки', async () => {
    const icon = fakePlayer()
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(icon.player), width: 40, height: 40, destroy: vi.fn() })
    const around = fakePlayer()
    wrapStickerAnimationMock.mockReturnValue({
      animationDiv: document.createElement('div'),
      stickerPromise: Promise.resolve(around.player),
    })

    const previous = previousWith({ emoticon: '👍', count: 1 })
    const el = createReactionsElement(
      agg({ emoticon: '👍', count: 2, mine: true }),
      options({ previous }),
    )!

    await vi.waitFor(() => expect(wrapStickerAnimationMock).toHaveBeenCalled())

    // tweb reaction.ts:1185-1194 — квадрат 80px вокруг ИКОНКИ чипа.
    const stickerContainer = el.querySelector<HTMLElement>('.reaction-sticker')!
    expect(wrapStickerAnimationMock.mock.calls[0][0]).toMatchObject({
      mediaId: AROUND_ID, size: 80, target: stickerContainer, play: false,
    })
    // tweb :1233-1245 — иконка эффекта размером REACTIONS_SIZE[Block] + 18.
    // `wrapSticker` теперь зовут и чипы, и эффект, причём В ОДИН И ТОТ ЖЕ
    // размер (в этом и смысл: оверлей подменяет иконку без скачка), поэтому
    // вызов эффекта ищется по его группе `none` (tweb :1250).
    const effectCall = wrapStickerMock.mock.calls.find(([o]) => o.group === 'none')![0]
    expect(effectCall).toMatchObject({
      mediaId: CENTER_ID, width: 40, height: 40, play: false, loop: false,
    })

    await vi.waitFor(() => expect(icon.player.play).not.toBe(undefined))
    icon.fireFirstFrame()

    // tweb :1456-1467. Пин на СОСТОЯНИЕ плееров, а не на факт вызова: «эффект
    // играет» — это `paused === false` у обоих, иначе двойник, у которого
    // `play()` ничего не делает, объявил бы анимацию сыгранной.
    expect(stickerContainer.querySelector('.reaction-sticker-activate')).not.toBeNull()
    expect(stickerContainer.classList.contains('has-animation')).toBe(true)
    expect(icon.player.paused).toBe(false)
    expect(around.player.paused).toBe(false)
  })

  it('правило `has-animation` ДОСТАЁТ до иконки чипа', async () => {
    // Оригинал гасит базовую иконку на время эффекта:
    // `.reaction-sticker.has-animation > .media-sticker {opacity: 0}`
    // (`_reaction.scss:41-45`). Стилей jsdom не считает, поэтому пин на то, что
    // здесь и решает: СЕЛЕКТОР ЭТОГО ПРАВИЛА совпадает с нашим узлом. Раньше не
    // совпадал — канвас lottie шёл без класса `media-sticker`, и иконка
    // оставалась видна под оверлеем.
    const chipCanvas = document.createElement('canvas')
    const chipIcon = fakePlayer()
    Object.assign(chipIcon.player, { canvas: [chipCanvas] })
    const effect = fakePlayer()
    wrapStickerMock.mockImplementation((o) => {
      const isEffect = o.group === 'none'
      // Настоящий `wrapSticker` вешает канвас плеера в переданный контейнер —
      // без этого «родитель» селектора не проверить.
      if (!isEffect) o.div.append(chipCanvas)
      return {
        render: Promise.resolve(isEffect ? effect.player : chipIcon.player),
        width: o.width, height: o.height, destroy: vi.fn(),
      }
    })

    const previous = previousWith({ emoticon: '👍', count: 1 })
    createReactionsElement(agg({ emoticon: '👍', count: 2, mine: true }), options({ previous }))

    await vi.waitFor(() => expect(wrapStickerAnimationMock).toHaveBeenCalled())
    await flush()
    effect.fireFirstFrame()

    expect(chipCanvas.matches('.reaction-sticker.has-animation > .media-sticker')).toBe(true)
  })

  it('чужая реакция на МОЁМ сообщении тоже играет (tweb pFlags.out)', async () => {
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(fakePlayer().player), width: 40, height: 40, destroy: vi.fn() })

    const previous = previousWith({ emoticon: '👍', count: 1 })
    createReactionsElement(agg({ emoticon: '👍', count: 2 }), options({ previous, isOut: true }))

    await vi.waitFor(() => expect(wrapStickerAnimationMock).toHaveBeenCalled())
  })

  it('чужая реакция на ЧУЖОМ сообщении не играет', async () => {
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(fakePlayer().player), width: 40, height: 40, destroy: vi.fn() })

    const previous = previousWith({ emoticon: '👍', count: 1 })
    createReactionsElement(agg({ emoticon: '👍', count: 2 }), options({ previous }))

    await flush()
    expect(wrapStickerAnimationMock).not.toHaveBeenCalled()
  })

  it('первая сборка бабла (узел ещё не в документе) не играет ничего', async () => {
    createReactionsElement(
      agg({ emoticon: '👍', count: 2, mine: true }),
      options({ bubble: document.createElement('div') }),
    )

    await flush()
    expect(wrapStickerAnimationMock).not.toHaveBeenCalled()
  })

  it('ПЕРВАЯ реакция на сообщении (прошлого узла нет) играет — это тоже изменение', async () => {
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(fakePlayer().player), width: 40, height: 40, destroy: vi.fn() })

    createReactionsElement(agg({ emoticon: '👍', count: 1, mine: true }), options())

    await vi.waitFor(() => expect(wrapStickerAnimationMock).toHaveBeenCalled())
  })

  it('режим «без анимаций» гасит эффект (tweb liteMode effects_reactions)', async () => {
    const previous = previousWith({ emoticon: '👍', count: 1 })
    useSettingsStore.setState({ reduceMotion: true })

    createReactionsElement(agg({ emoticon: '👍', count: 2, mine: true }), options({ previous }))

    await flush()
    expect(wrapStickerAnimationMock).not.toHaveBeenCalled()
  })

  /** tweb :1446-1456 — оверлей на последнем кадре снимается СРАЗУ, только если
   *  иконка самого чипа уже показана; иначе сначала ждём её. */
  describe('снятие оверлея ждёт иконку чипа (tweb wrapStickerPromise)', () => {
    /** Развести двойники: группа `none` — иконка эффекта (tweb :1250), всё
     *  остальное — иконка самого чипа. */
    const splitByWidth = (chipRender: Promise<LottiePlayer>, effect: LottiePlayer) => {
      wrapStickerMock.mockImplementation((o) => ({
        render: o.group === 'none' ? Promise.resolve(effect) : chipRender,
        width: o.width, height: o.height, destroy: vi.fn(),
      }))
    }

    const fireLastFrame = async (previousCount: number) => {
      const icon = fakePlayer()
      const previous = previousWith({ emoticon: '👍', count: previousCount })
      const el = createReactionsElement(
        agg({ emoticon: '👍', count: previousCount + 1, mine: true }),
        options({ previous }),
      )!
      await vi.waitFor(() => expect(wrapStickerAnimationMock).toHaveBeenCalled())
      await flush()
      const sticker = el.querySelector<HTMLElement>('.reaction-sticker')!
      return { icon, sticker }
    }

    it('иконка чипа уже показана — оверлей снимается на последнем кадре', async () => {
      const effect = fakePlayer()
      splitByWidth(Promise.resolve(fakePlayer().player), effect.player)

      const { sticker } = await fireLastFrame(1)
      effect.fireFirstFrame()
      expect(sticker.classList.contains('has-animation')).toBe(true)

      effect.fireFrame(effect.player.maxFrame)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      expect(sticker.classList.contains('has-animation')).toBe(false)
    })

    it('иконка чипа ещё грузится — оверлей на последнем кадре остаётся', async () => {
      const effect = fakePlayer()
      splitByWidth(new Promise<LottiePlayer>(() => {}), effect.player)

      const { sticker } = await fireLastFrame(1)
      effect.fireFirstFrame()
      effect.fireFrame(effect.player.maxFrame)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      expect(sticker.classList.contains('has-animation')).toBe(true)
    })
  })

  it('реакции нет в каталоге — играть нечем', async () => {
    const previous = previousWith({ emoticon: '🔥', count: 1 })
    createReactionsElement(agg({ emoticon: '🔥', count: 2, mine: true }), options({ previous }))

    await flush()
    expect(catalog.list).toHaveBeenCalled()
    expect(wrapStickerAnimationMock).not.toHaveBeenCalled()
  })
})

/**
 * Политика реакций пира — порт `getAvailableReactionsForPeer`
 * (appReactionsManager.ts:206-277). Пины на ИСХОД, а не на маршрут: панель
 * выбора показывает ровно то, что вернёт эта функция.
 */
describe('getAvailableReactionsForPeer', () => {
  /** Каталог из трёх реакций; порядок каталога — «сердце, палец, огонь». */
  const trio = () => makeCatalog(
    { emoji: '❤' }, { emoji: '👍' }, { emoji: '🔥' },
  )

  const emoticons = (r: { reactions: Reaction[] } | undefined) =>
    r!.reactions.map((x) => (x._ === 'reactionEmoji' ? x.emoticon : x._))

  const chatFullWith = (available: unknown) => {
    saveChatFull(CHAT, {
      _: 'channelFull', id: 700, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0,
      unread_count: 0, chat_photo: null,
      ...(available === undefined ? {} : { available_reactions: available }),
    } as never)
  }

  it('личка — весь активный каталог, тип chatReactionsAll (tweb :214-224)', async () => {
    catalog = trio()
    const r = await getAvailableReactionsForPeer(USER, { reactions: catalog })

    expect(r!.type).toBe('chatReactionsAll')
    expect(emoticons(r)).toEqual(['❤', '👍', '🔥'])
  })

  it('inactive-реакция не предлагается (tweb getActiveAvailableReactions :199-204)', async () => {
    catalog = makeCatalog({ emoji: '❤' }, { emoji: '👍', inactive: true })
    const r = await getAvailableReactionsForPeer(USER, { reactions: catalog })

    expect(emoticons(r)).toEqual(['❤'])
  })

  it('chatReactionsNone — предлагать нечего (tweb :227,250-252)', async () => {
    catalog = trio()
    chatFullWith({ _: 'chatReactionsNone' })

    const r = await getAvailableReactionsForPeer(CHAT, { reactions: catalog })
    expect(r!.type).toBe('chatReactionsNone')
    expect(r!.reactions).toEqual([])
  })

  it('chatReactionsAll — весь активный каталог', async () => {
    catalog = trio()
    chatFullWith({ _: 'chatReactionsAll' })

    const r = await getAvailableReactionsForPeer(CHAT, { reactions: catalog })
    expect(emoticons(r)).toEqual(['❤', '👍', '🔥'])
  })

  it('chatReactionsSome — только разрешённые и В ПОРЯДКЕ КАТАЛОГА (tweb :253-262)', async () => {
    catalog = trio()
    // Политика перечисляет их задом наперёд — порядок обязан задавать каталог.
    chatFullWith({
      _: 'chatReactionsSome',
      reactions: [{ _: 'reactionEmoji', emoticon: '🔥' }, { _: 'reactionEmoji', emoticon: '❤' }],
    })

    const r = await getAvailableReactionsForPeer(CHAT, { reactions: catalog })
    expect(r!.type).toBe('chatReactionsSome')
    expect(emoticons(r)).toEqual(['❤', '🔥'])
  })

  it('карточки в зеркале нет — спрашиваем её у владельца (tweb getChatFull :226)', async () => {
    catalog = trio()
    const card = vi.fn(async () => ({
      fullChat: { available_reactions: { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '👍' }] } },
    }))

    const r = await getAvailableReactionsForPeer(CHAT, { reactions: catalog, groups: { card } as never })

    expect(card).toHaveBeenCalledWith(CHAT)
    expect(emoticons(r)).toEqual(['👍'])
  })

  it('карточка спрашивается ОДИН раз на чат: ответ прогревает зеркало', async () => {
    // Политику спрашивает каждый бабл под курсором (`onBubblesMouseMove`), а
    // зеркало в треде комментариев не наполняет никто (`components/Chat.tsx:348`
    // гейтит `useChatInfoCard` термом `!thread`). Без записи ответа в зеркало
    // проход по ленте стоил бы по запросу на бабл — оригинал же пишет ответ в
    // `chatsFull` (`saveFullPeerResult`, appProfileManager.ts:217).
    catalog = trio()
    const card = vi.fn(async () => ({
      fullChat: { available_reactions: { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '👍' }] } },
    }))
    const managers = { reactions: catalog, groups: { card } as never }

    for (let i = 0; i < 30; ++i) {
      expect(emoticons(await getAvailableReactionsForPeer(CHAT, managers))).toEqual(['👍'])
    }

    expect(card).toHaveBeenCalledTimes(1)
  })

  it('карточка спрашивается ОДИН раз и при ОДНОВРЕМЕННЫХ вопросах', async () => {
    // Пока ответ летит, зеркало ещё холодное: дедупликация летящего похода —
    // порт `invokeApiSingleProcess` (appProfileManager.ts:643).
    catalog = trio()
    const card = vi.fn(async () => ({
      fullChat: { available_reactions: { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '👍' }] } },
    }))
    const managers = { reactions: catalog, groups: { card } as never }

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getAvailableReactionsForPeer(CHAT, managers)),
    )

    expect(card).toHaveBeenCalledTimes(1)
    for (const r of results) expect(emoticons(r)).toEqual(['👍'])
  })

  it('провалившийся поход не запоминается — следующий спрашивает заново', async () => {
    catalog = trio()
    const card = vi.fn(async () => { throw new Error('offline') })
    const managers = { reactions: catalog, groups: { card } as never }

    await getAvailableReactionsForPeer(CHAT, managers)
    await getAvailableReactionsForPeer(CHAT, managers)

    expect(card).toHaveBeenCalledTimes(2)
  })

  it('карточку достать нечем — реакции НЕ выключаются молча', async () => {
    // Право проверяет и бэк (`usecase/chat/reaction.go:35-46`); панель,
    // исчезнувшая из-за незнания политики, — это другой баг, а не защита.
    catalog = trio()
    const r = await getAvailableReactionsForPeer(CHAT, { reactions: catalog })

    expect(r!.type).toBe('chatReactionsAll')
    expect(emoticons(r)).toEqual(['❤', '👍', '🔥'])
  })

  it('каталога нет вовсе — политике не на чём стоять', async () => {
    expect(await getAvailableReactionsForPeer(USER, {})).toBeUndefined()
  })
})
