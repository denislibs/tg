// Часть 2 задачи «фолбэк без WASM SIMD» (backlogs/frontend/
// lottie-no-wasm-fallback.md): пины на чистую логику `renderStaticAssetFallback`
// — единственную точку деградации на все пять мест показа встроенных ассетов
// (см. докблок модуля). Интеграция с `loadAnimationAsAsset` (реальный вызов на
// NO_WASM) — отдельный тест `lottieLoader.assetFallback.test.ts`.
import { afterEach, describe, expect, it } from 'vitest'
import { makeAssetPngUrl, renderStaticAssetFallback } from './lottieAssetFallback'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('makeAssetPngUrl — тот же паттерн, что и makeAssetUrl (json → png)', () => {
  it('assets/tgs/<name>.png', () => {
    expect(makeAssetPngUrl('Mailbox')).toBe('assets/tgs/Mailbox.png')
  })
})

describe('renderStaticAssetFallback', () => {
  it('вставляет <img> с src на PNG ассета, растянутый на весь контейнер', () => {
    const container = document.createElement('div')
    renderStaticAssetFallback(container, 'key')

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('assets/tgs/key.png')
    expect(img!.style.width).toBe('100%')
    expect(img!.style.height).toBe('100%')
  })

  it('404 (нет PNG для этого имени) — onerror убирает <img>, место остаётся пустым', () => {
    const container = document.createElement('div')
    renderStaticAssetFallback(container, 'Diamond') // нет файла на диске (не из 11)

    const img = container.querySelector('img')!
    img.dispatchEvent(new Event('error'))

    expect(container.querySelector('img')).toBeNull()
  })

  it('идемпотентно на контейнер: второй вызов НЕ добавляет второй <img> (TrackingMonkey — два лоадера, один container)', () => {
    const container = document.createElement('div')
    renderStaticAssetFallback(container, 'TwoFactorSetupMonkeyIdle')
    renderStaticAssetFallback(container, 'TwoFactorSetupMonkeyTracking')

    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    // первый вызов побеждает — источник тот, что был вставлен первым
    expect(imgs[0].getAttribute('src')).toBe('assets/tgs/TwoFactorSetupMonkeyIdle.png')
  })

  it('массив контейнеров (LottieOptions.container: HTMLElement[]) — вставляет в каждый', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    renderStaticAssetFallback([a, b], 'Mailbox')

    expect(a.querySelector('img')).not.toBeNull()
    expect(b.querySelector('img')).not.toBeNull()
  })

  it('ПИН ограничения: смена имени на живом контейнере PNG не обновляет — гвард смотрит на класс, не на name', () => {
    // Сознательное поведение (см. комментарий у гварда в renderStaticAssetFallback):
    // все 9 колл-сайтов передают `name` литералом, он не меняется на протяжении
    // жизни контейнера, поэтому этот сценарий сегодня недостижим в реальном
    // вызывающем коде — пин фиксирует его как известное и принятое ограничение,
    // а не забытый баг.
    const container = document.createElement('div')
    renderStaticAssetFallback(container, 'Mailbox')
    renderStaticAssetFallback(container, 'LoveLetter')

    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe('assets/tgs/Mailbox.png')
  })
})
