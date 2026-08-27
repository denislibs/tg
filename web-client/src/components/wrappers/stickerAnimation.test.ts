// Полёт стикер-эффекта — порт tweb `wrappers/stickerAnimation.ts`.
//
// Пины: узел живёт в ОБЩЕМ контейнере поверх приложения (а не в цели, иначе его
// резал бы `overflow` чипа реакции), позиция считается по цели на первом кадре,
// и полёт снимается всеми тремя способами оригинала — последний кадр,
// исчезнувшая цель, уничтоженный плеер.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import { getMiddleware } from '@helpers/middleware'
import wrapSticker from './sticker'
import wrapStickerAnimation, { emojiAnimationContainer } from './stickerAnimation'

vi.mock('./sticker', () => ({ default: vi.fn() }))
const wrapStickerMock = vi.mocked(wrapSticker)

function fakePlayer() {
  const player = Object.create(LottiePlayer.prototype) as LottiePlayer
  const listeners: Record<string, ((...args: never[]) => void)[]> = {}
  const firstFrame: (() => void)[] = []
  Object.assign(player, {
    maxFrame: 10,
    addEventListener: (name: string, cb: (...args: never[]) => void) => { (listeners[name] ??= []).push(cb) },
    onFirstFrame: (cb: () => void) => { firstFrame.push(cb) },
    play: vi.fn(),
    remove: vi.fn(),
  })
  return {
    player,
    fireFirstFrame: () => firstFrame.forEach((cb) => cb()),
    fire: (name: string, ...args: unknown[]) => (listeners[name] ?? []).forEach((cb) => (cb as (...a: unknown[]) => void)(...args)),
  }
}

/** Цель полёта: 22×22 в точке (100, 200) — так же, как иконка чипа реакции. */
function makeTarget() {
  const target = document.createElement('div')
  target.getBoundingClientRect = () => ({ left: 100, top: 200, width: 22, height: 22 }) as DOMRect
  document.body.append(target)
  return target
}

function run(target: HTMLElement, player: LottiePlayer) {
  wrapStickerMock.mockReturnValue({ render: Promise.resolve(player), width: 80, height: 80, destroy: vi.fn() })
  return wrapStickerAnimation({
    mediaId: 7,
    size: 80,
    target,
    play: false,
    middleware: getMiddleware().get(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  emojiAnimationContainer.replaceChildren()
})

describe('wrapStickerAnimation', () => {
  it('узел кладётся в ОБЩИЙ контейнер, подвешенный к body', async () => {
    const target = makeTarget()
    const { animationDiv } = run(target, fakePlayer().player)

    expect(emojiAnimationContainer.parentElement).toBe(document.body)
    expect(animationDiv.parentElement).toBe(emojiAnimationContainer)
    expect(animationDiv.classList.contains('emoji-animation')).toBe(true)
    expect(animationDiv.style.width).toBe('80px')
    expect(animationDiv.style.height).toBe('80px')
  })

  it('первый кадр центрирует квадрат по цели', async () => {
    const target = makeTarget()
    const p = fakePlayer()
    const { animationDiv } = run(target, p.player)
    await vi.waitFor(() => expect(wrapStickerMock).toHaveBeenCalled())
    await Promise.resolve()

    p.fireFirstFrame()

    // (22 - 80) / 2 = -29 → left 100-29 = 71, top 200-29 = 171
    expect(animationDiv.style.left).toBe('71px')
    expect(animationDiv.style.top).toBe('171px')
  })

  it('последний кадр снимает полёт (tweb :125-129)', async () => {
    const target = makeTarget()
    const p = fakePlayer()
    const { animationDiv, stickerPromise } = run(target, p.player)
    await stickerPromise

    p.fire('enterFrame', 10)

    expect(animationDiv.parentElement).toBeNull()
    expect(p.player.remove).toHaveBeenCalled()
  })

  it('цель ушла из DOM — полёт снят, даже если кадр не последний', async () => {
    const target = makeTarget()
    const p = fakePlayer()
    const { animationDiv, stickerPromise } = run(target, p.player)
    await stickerPromise

    target.remove()
    p.fire('enterFrame', 1)

    expect(animationDiv.parentElement).toBeNull()
  })

  it('плеер уничтожен (middleware вызывающего) — полёт снят', async () => {
    const target = makeTarget()
    const p = fakePlayer()
    const { animationDiv, stickerPromise } = run(target, p.player)
    await stickerPromise

    p.fire('destroy')

    expect(animationDiv.parentElement).toBeNull()
  })

  it('файл оказался не анимацией — играть нечем, узел снят', async () => {
    const target = makeTarget()
    wrapStickerMock.mockReturnValue({
      render: Promise.resolve(document.createElement('img')),
      width: 80, height: 80, destroy: vi.fn(),
    })
    const { animationDiv, stickerPromise } = wrapStickerAnimation({
      mediaId: 7, size: 80, target, play: false, middleware: getMiddleware().get(),
    })

    await expect(stickerPromise).rejects.toMatchObject({ type: 'FILE_INVALID' })
    expect(animationDiv.parentElement).toBeNull()
  })

  it('скроллер: полёт следует за целью и отписывается при снятии', async () => {
    const target = makeTarget()
    const scrollable = { container: document.createElement('div') }
    const removeSpy = vi.spyOn(scrollable.container, 'removeEventListener')
    const p = fakePlayer()
    wrapStickerMock.mockReturnValue({ render: Promise.resolve(p.player), width: 80, height: 80, destroy: vi.fn() })
    const { stickerPromise } = wrapStickerAnimation({
      mediaId: 7, size: 80, target, play: false, middleware: getMiddleware().get(), scrollable,
    })
    await stickerPromise

    p.fire('enterFrame', 10)
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
