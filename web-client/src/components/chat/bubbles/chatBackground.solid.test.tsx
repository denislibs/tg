/** @jsxImportSource solid-js */
/**
 * Solid-`<ChatBackground>` — порт tweb `chat/bubbles/chatBackground.tsx`
 * (812502980). Предмет — DOM, который строит оригинал:
 *  • слой `.Layer` с двумя слотами `.Slot` (двойная буферизация, `:432-444`);
 *  • обои с узором — холст градиента 50×50 (`.CanvasCommon.GradientCanvas`,
 *    `data-colors`) и холст узора (`.CanvasCommon`), три стратегии по теме
 *    (`:218-274`): день — `soft-light` (`.Blend`) с `--opacity-max` на узоре;
 *    ночь — маска `#000` + `destination-out` с `--opacity-max` на градиенте;
 *    tinted — `.Blend.DarkPatternInvert` и интенсивность −0.38;
 *  • сплошной цвет — только холст градиента; картинка — `img.CanvasCommon`,
 *    слот `.IsImage`, размытие — копия `blurWallPaperImage`;
 *  • переходы (`:390-430`): первый показ из кэша — мгновенно, `fade` — класс на
 *    обоих слотах, уходящий слот чистится по `transitionend`;
 *  • устаревший прогон эффекта выбрасывается (`tempId`, `:446-507`);
 *  • ручка к градиенту и мета маски для зеркала (`:527-534`), цвет подсветки
 *    из среднего цвета холста (`:363-367`, `:515-516`).
 *
 * Холсты — настоящие рендереры поверх поддельного 2D-контекста
 * (`test/fakeCanvas.ts`); граница — только медиа-конвейер и блюр.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import type { WallPaper } from '@layer'
import { installFakeCanvas } from '@/test/fakeCanvas'
import { highlightingColor } from '@shared/lib/color'
import {
  DEFAULT_WALLPAPERS,
  getAppTheme,
  getMediaWallPaperSlug,
  makeImageWallPaper,
  makePresetWallPaper,
} from '@/wallpapers'
import type ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'

const ensureMediaUrl = vi.hoisted(() => vi.fn(async(id: number) => `blob:media-${id}`))
vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl }))
const blur = vi.hoisted(() => vi.fn((url: string) => ({
  canvas: { toDataURL: () => 'data:blurred;' + url },
  promise: Promise.resolve(),
})))
vi.mock('@helpers/blur', () => ({ default: blur }))

import { ChatBackground, type ActiveBackgroundMeta, type ChatBackgroundProps } from './chatBackground.solid'
import styles from './chatBackground.module.scss'

let fakeCanvas: ReturnType<typeof installFakeCanvas>
let dispose: (() => void) | undefined
let host: HTMLDivElement

beforeEach(() => {
  fakeCanvas = installFakeCanvas()
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  fakeCanvas.restore()
  ensureMediaUrl.mockClear()
  blur.mockClear()
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Монтирует фон и ждёт первого `onReady`. */
async function mount(props: ChatBackgroundProps) {
  const [current, setCurrent] = createSignal(props)
  let ready!: () => void
  let readyPromise = new Promise<void>((resolve) => ready = resolve)
  dispose = render(() => (
    <ChatBackground
      theme={current().theme}
      wallPaper={current().wallPaper}
      transition={current().transition}
      width={current().width}
      height={current().height}
      gradientRendererRef={current().gradientRendererRef}
      onHighlightColor={current().onHighlightColor}
      onReady={() => ready()}
    />
  ), host)
  await readyPromise
  return {
    layer: host.firstElementChild as HTMLElement,
    /** Меняет пропы и ждёт следующего `onReady`. */
    async update(next: Partial<ChatBackgroundProps>) {
      readyPromise = new Promise<void>((resolve) => ready = resolve)
      setCurrent({ ...current(), ...next })
      await readyPromise
    },
  }
}

const slots = (layer: HTMLElement) => [...layer.children] as HTMLElement[]
const activeSlot = (layer: HTMLElement) => slots(layer).find((slot) => slot.classList.contains(styles.SlotActive))!
const opacityMax = (el: Element) => (el as HTMLElement).style.getPropertyValue('--opacity-max')

describe('ChatBackground — слои обоев с узором по теме', () => {
  it('день: слой из двух слотов; активный — градиент 50×50 и узор soft-light с --opacity-max 0.5', async() => {
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day })

    expect(layer.classList.contains(styles.Layer)).toBe(true)
    expect(slots(layer)).toHaveLength(2)
    expect(slots(layer).every((slot) => slot.classList.contains(styles.Slot))).toBe(true)

    const slot = activeSlot(layer)
    expect(slot.classList.contains(styles.IsPattern)).toBe(true)
    const [gradient, pattern, ...rest] = [...slot.children] as HTMLCanvasElement[]
    expect(rest).toHaveLength(0)

    expect(gradient.tagName).toBe('CANVAS')
    expect([gradient.width, gradient.height]).toEqual([50, 50])
    expect(gradient.dataset.colors).toBe('#dbddbb,#6ba587,#d5d88d,#88b884')
    expect(gradient.classList.contains(styles.CanvasCommon)).toBe(true)
    expect(gradient.classList.contains(styles.GradientCanvas)).toBe(true)
    expect(opacityMax(gradient)).toBe('')

    expect(pattern.tagName).toBe('CANVAS')
    expect(pattern.classList.contains(styles.CanvasCommon)).toBe(true)
    expect(pattern.classList.contains(styles.Blend)).toBe(true)
    expect(pattern.classList.contains(styles.DarkPatternInvert)).toBe(false)
    expect(opacityMax(pattern)).toBe('0.5')
    // холст узора — под размер окна × min(2, dpr), узор кладётся поверх (`source-over`)
    expect([pattern.width, pattern.height]).toEqual([window.innerWidth, window.innerHeight])
    expect(fakeCanvas.ctxOf(pattern)!.calls).toContain('drawImage(source-over)')
  })

  it('ночь: маска — узор залит #000 с прорезями, приглушается градиент (0.3), без soft-light', async() => {
    const refs: [ChatBackgroundGradientRenderer | undefined, ActiveBackgroundMeta | undefined][] = []
    const { layer } = await mount({
      theme: getAppTheme('night'),
      wallPaper: DEFAULT_WALLPAPERS.night,
      gradientRendererRef: (renderer, meta) => refs.push([renderer, meta]),
    })

    const [gradient, pattern] = [...activeSlot(layer).children] as HTMLCanvasElement[]
    expect(gradient.dataset.colors).toBe('#fec496,#dd6cb9,#962fbf,#4f5bd5')
    expect(opacityMax(gradient)).toBe('0.3')
    expect(pattern.classList.contains(styles.Blend)).toBe(false)
    expect(opacityMax(pattern)).toBe('')
    const calls = fakeCanvas.ctxOf(pattern)!.calls
    expect(calls[0]).toBe(`fillRect(#000,0,0,${pattern.width},${pattern.height})`)
    expect(calls).toContain('drawImage(destination-out)')

    expect(refs).toHaveLength(1)
    expect(refs[0][0]).toBeDefined()
    expect(refs[0][1]).toEqual({ isDarkMaskPattern: true })
  })

  it('tinted: узор soft-light + инверсия, интенсивность −0.38 на узоре, слот IsTinted, маски нет', async() => {
    const refs: (ActiveBackgroundMeta | undefined)[] = []
    const { layer } = await mount({
      theme: getAppTheme('tinted'),
      wallPaper: DEFAULT_WALLPAPERS.tinted,
      gradientRendererRef: (_renderer, meta) => refs.push(meta),
    })

    const slot = activeSlot(layer)
    expect(slot.classList.contains(styles.IsTinted)).toBe(true)
    const [gradient, pattern] = [...slot.children] as HTMLCanvasElement[]
    expect(gradient.dataset.colors).toBe('#1e3557,#182036,#1c4352,#16263a')
    expect(opacityMax(gradient)).toBe('')
    expect(pattern.classList.contains(styles.Blend)).toBe(true)
    expect(pattern.classList.contains(styles.DarkPatternInvert)).toBe(true)
    expect(opacityMax(pattern)).toBe('0.38')
    expect(fakeCanvas.ctxOf(pattern)!.calls).not.toContain('drawImage(destination-out)')
    expect(refs).toEqual([{ isDarkMaskPattern: false }])
  })

  it('пресет в дневной теме — цвета пресета, интенсивность умолчания темы', async() => {
    const colors = ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5']
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper: makePresetWallPaper(colors, 'day') })
    const [gradient, pattern] = [...activeSlot(layer).children] as HTMLCanvasElement[]
    expect(gradient.dataset.colors).toBe(colors.join(','))
    expect(opacityMax(pattern)).toBe('0.5')
  })
})

describe('ChatBackground — цвет и картинка', () => {
  it('сплошной цвет — только холст градиента одним цветом, узора нет', async() => {
    const wallPaper: WallPaper.wallPaperNoFile = {
      _: 'wallPaperNoFile',
      id: '',
      pFlags: {},
      settings: { _: 'wallPaperSettings', pFlags: {}, background_color: 0xc4e1a6 },
    }
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper })

    const slot = activeSlot(layer)
    expect(slot.classList.contains(styles.IsPattern)).toBe(false)
    expect(slot.classList.contains(styles.IsImage)).toBe(false)
    const children = [...slot.children] as HTMLCanvasElement[]
    expect(children).toHaveLength(1)
    expect(children[0].dataset.colors).toBe('#c4e1a6')
    expect(children[0].classList.contains(styles.GradientCanvas)).toBe(true)
  })

  it('своё фото — img.CanvasCommon в слоте IsImage, файл из медиа-конвейера', async() => {
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper: makeImageWallPaper(getMediaWallPaperSlug(5)) })

    const slot = activeSlot(layer)
    expect(slot.classList.contains(styles.IsImage)).toBe(true)
    expect(slot.classList.contains(styles.IsPattern)).toBe(false)
    const [image, ...rest] = [...slot.children] as HTMLImageElement[]
    expect(rest).toHaveLength(0)
    expect(image.tagName).toBe('IMG')
    expect(image.classList.contains(styles.CanvasCommon)).toBe(true)
    expect(image.getAttribute('src')).toBe('blob:media-5')
    expect(ensureMediaUrl).toHaveBeenCalledWith(5)
    expect(blur).not.toHaveBeenCalled()
  })

  it('своё фото с размытием — показывается размытая копия (blur 12 × 4)', async() => {
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper: makeImageWallPaper(getMediaWallPaperSlug(8), true) })

    const image = activeSlot(layer).querySelector('img')!
    expect(blur).toHaveBeenCalledWith('blob:media-8', 12, 4)
    expect(image.getAttribute('src')).toBe('data:blurred;blob:media-8')
  })
})

describe('ChatBackground — переходы и гонки', () => {
  it('первый показ из кэша — сразу активен без перехода; fade — класс на обоих слотах, старый слот чистится по transitionend', async() => {
    const bg = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day, transition: 'fade' })
    // первый фон строится в слоте «на подмене» и становится видимым им же
    const shown = activeSlot(bg.layer)
    const other = slots(bg.layer).find((slot) => slot !== shown)!
    expect(shown.classList.contains(styles.SlotFade)).toBe(false)
    expect(other.classList.contains(styles.SlotActive)).toBe(false)
    expect(other.children).toHaveLength(0)

    await bg.update({ wallPaper: makePresetWallPaper(['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea'], 'day') })

    expect(other.classList.contains(styles.SlotActive)).toBe(true)
    expect(shown.classList.contains(styles.SlotActive)).toBe(false)
    expect(shown.classList.contains(styles.SlotFade)).toBe(true)
    expect(other.classList.contains(styles.SlotFade)).toBe(true)
    expect((other.firstElementChild as HTMLCanvasElement).dataset.colors).toBe('#aac8ea,#cfe0f2,#c2d9ee,#b3d0ea')
    // старый фон ещё виден, пока идёт затухание
    expect(shown.children).toHaveLength(2)

    shown.dispatchEvent(new Event('transitionend'))
    expect(shown.children).toHaveLength(0)
  })

  it('instant — старый слот чистится сразу', async() => {
    const bg = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day, transition: 'instant' })
    const shown = activeSlot(bg.layer)
    await bg.update({ theme: getAppTheme('night'), wallPaper: DEFAULT_WALLPAPERS.night })
    expect(activeSlot(bg.layer)).not.toBe(shown)
    expect(shown.classList.contains(styles.SlotActive)).toBe(false)
    expect(shown.children).toHaveLength(0)
    expect(shown.classList.contains(styles.SlotFade)).toBe(false)
  })

  it('те же тема и обои — перерисовки нет', async() => {
    const bg = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day })
    const before = activeSlot(bg.layer).firstElementChild
    await bg.update({ theme: getAppTheme('day') })
    expect(activeSlot(bg.layer).firstElementChild).toBe(before)
  })

  it('обогнанный прогон выбрасывается: показывается только последний фон, файл устаревшего не декодируется', async() => {
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode')
    let resolveSlow!: (url: string) => void
    ensureMediaUrl.mockImplementationOnce(() => new Promise<string>((resolve) => resolveSlow = resolve))
    const bg = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day })

    // медленный фон (фото ещё качается) — и сразу за ним быстрый; обогнанный
    // прогон `onReady` не зовёт, поэтому его обещание не ждём
    void bg.update({ wallPaper: makeImageWallPaper(getMediaWallPaperSlug(11)) })
    await tick()
    await bg.update({ wallPaper: DEFAULT_WALLPAPERS.night, theme: getAppTheme('night') })
    resolveSlow('blob:media-11')
    await tick()
    await tick()

    expect(bg.layer.querySelector('img')).toBeNull()
    expect((activeSlot(bg.layer).firstElementChild as HTMLCanvasElement).dataset.colors).toBe('#fec496,#dd6cb9,#962fbf,#4f5bd5')
    // прогон бросил работу сразу по приезде адреса (`:490`), до сборки слоя
    expect(decode.mock.contexts.some((img) => (img as HTMLImageElement).src.includes('media-11'))).toBe(false)
    decode.mockRestore()
  })
})

describe('ChatBackground — гонка во время сборки слоя', () => {
  it('прогон, обогнанный пока грузится узор, выбрасывает построенное (`:503-507`)', async() => {
    const bg = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day })
    let finishDecode!: () => void
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode')
      .mockImplementationOnce(() => new Promise<void>((resolve) => finishDecode = resolve))
    // ночь: новый рендерер узора (маска), его картинка ещё декодируется…
    void bg.update({ theme: getAppTheme('night'), wallPaper: DEFAULT_WALLPAPERS.night })
    await tick()
    // …а за ней уже сплошной цвет, которому ждать нечего
    const color: WallPaper.wallPaperNoFile = {
      _: 'wallPaperNoFile',
      id: '',
      pFlags: {},
      settings: { _: 'wallPaperSettings', pFlags: {}, background_color: 0xc4e1a6 },
    }
    await bg.update({ theme: getAppTheme('day'), wallPaper: color })
    finishDecode()
    await tick()
    await tick()

    const canvases = [...bg.layer.querySelectorAll('canvas')]
    expect(canvases.map((canvas) => canvas.dataset.colors)).toEqual(['#c4e1a6'])
    decode.mockRestore()
  })
})

describe('ChatBackground — подсветка из среднего цвета обоев', () => {
  it('onHighlightColor — highlightingColor от среднего цвета холста градиента', async() => {
    const seen: string[] = []
    const { layer } = await mount({
      theme: getAppTheme('day'),
      wallPaper: DEFAULT_WALLPAPERS.day,
      onHighlightColor: (hsla) => seen.push(hsla),
    })
    const gradient = activeSlot(layer).firstElementChild as HTMLCanvasElement
    const [r, g, b, a] = fakeCanvas.ctxOf(gradient)!.color
    expect(seen).toEqual([highlightingColor([r, g, b, a])])
    expect(seen[0]).toMatch(/^hsla\(.+, \.4\)$/)
  })
})

describe('ChatBackground — уборка', () => {
  it('dispose снимает слушатель resize и чистит слоты', async() => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { layer } = await mount({ theme: getAppTheme('day'), wallPaper: DEFAULT_WALLPAPERS.day })
    const slot = activeSlot(layer)
    dispose!()
    dispose = undefined
    expect(slot.children).toHaveLength(0)
    expect(removeSpy.mock.calls.some(([type]) => (type as string) === 'resize')).toBe(true)
    removeSpy.mockRestore()
  })
})
