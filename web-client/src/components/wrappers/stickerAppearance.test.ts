// Контроллер слоёв показа стикера (порт tweb stickerAppearance): превью снизу,
// медиа сверху, нижний слой снимается ТОЛЬКО под доказанно прокрашенным верхним.
// Именно этот порядок держит ячейку от мигания пустотой, поэтому он и пинится.
import { describe, it, expect, vi } from 'vitest'
import createStickerAppearance from './stickerAppearance'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

/** Плеер-заглушка: ensurePresented резолвится вручную из теста. */
function fakePlayer() {
  let release!: () => void
  const presented = new Promise<void>((resolve) => {
    release = resolve
  })
  const player = { ensurePresented: vi.fn(() => presented) } as unknown as LottiePlayer
  return { player, release }
}

function makeThumb() {
  const image = document.createElement('img')
  // happy-dom не декодирует настоящие байты — decode() резолвится сразу.
  image.decode = () => Promise.resolve()
  return image
}

describe('stickerAppearance', () => {
  it('превью встаёт нижним слоем с классами и ключом', async () => {
    const container = document.createElement('div')
    const appearance = createStickerAppearance({ container, thumbKey: '42' })

    const image = makeThumb()
    appearance.setThumb(image)
    await Promise.resolve()

    expect(container.children).toHaveLength(1)
    expect(image.classList.contains('media-sticker')).toBe(true)
    expect(image.classList.contains('thumbnail')).toBe(true)
    expect(image.dataset.stickerThumb).toBe('42')
  })

  it('нижний слой держится, пока кадр не доказан на экране', async () => {
    const container = document.createElement('div')
    const appearance = createStickerAppearance({ container, thumbKey: '42' })

    const image = makeThumb()
    appearance.setThumb(image)
    await Promise.resolve()

    const canvas = document.createElement('canvas')
    container.append(canvas)

    const { player, release } = fakePlayer()
    const done = appearance.onMediaFirstFrame({ animation: player, media: canvas, needFadeIn: false })

    // ensurePresented ещё не резолвился — превью обязано оставаться в DOM,
    // иначе на его месте на кадр-другой окажется непрокрашенный canvas.
    await Promise.resolve()
    expect(container.contains(image)).toBe(true)
    expect(player.ensurePresented).toHaveBeenCalled()

    release()
    await done

    expect(container.contains(image)).toBe(false)
    expect(container.contains(canvas)).toBe(true)
  })

  it('новое поколение усыновляет медиа прошлого и снимает его под своим кадром', async () => {
    const container = document.createElement('div')
    const oldCanvas = document.createElement('canvas')
    container.append(oldCanvas)

    // Пересоздание контроллера на том же контейнере (смена размера/стикера):
    // мёртвый canvas прошлого поколения остаётся видимым нижним слоем.
    const appearance = createStickerAppearance({ container, thumbKey: '43' })
    const newCanvas = document.createElement('canvas')
    container.append(newCanvas)

    const { player, release } = fakePlayer()
    const done = appearance.onMediaFirstFrame({ animation: player, media: newCanvas, needFadeIn: false })
    await Promise.resolve()
    expect(container.contains(oldCanvas)).toBe(true)

    release()
    await done
    expect(container.contains(oldCanvas)).toBe(false)
    expect(container.contains(newCanvas)).toBe(true)
  })

  it('при живом медиа прошлого поколения превью не вставляется поверх него', async () => {
    const container = document.createElement('div')
    container.append(document.createElement('canvas'))

    const appearance = createStickerAppearance({ container, thumbKey: '44' })
    expect(appearance.canBuildThumb()).toBe(false)

    const image = makeThumb()
    const onApplied = vi.fn()
    appearance.setThumb(image, onApplied)
    await Promise.resolve()

    expect(container.contains(image)).toBe(false)
    expect(onApplied).toHaveBeenCalled() // ожидающий колбэк обязан разрешиться
  })

  it('протухший контроллер (middleware) слои не трогает', async () => {
    const container = document.createElement('div')
    const cleaners: (() => void)[] = []
    const middleware = Object.assign(() => true, {
      onClean: (cb: () => void) => cleaners.push(cb),
    }) as unknown as Parameters<typeof createStickerAppearance>[0]['middleware']

    const appearance = createStickerAppearance({ container, thumbKey: '45', middleware })
    cleaners.forEach((cb) => cb()) // поколение погасили

    appearance.setThumb(makeThumb())
    await Promise.resolve()
    expect(container.children).toHaveLength(0)
  })
})
