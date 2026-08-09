// Регрессия ревью Task 3 (раунд 2): у отслеживающего Image был только onload —
// при сбое загрузки (404/протухший токен/удалённое медиа) activateSlot никогда
// не вызывался, hadPreviousRef оставался false, и .Slot навсегда застревал на
// opacity:0 (весь слой обоев пропадал на сессию). Проверяем, что onerror тоже
// активирует слот — и для узора (pattern.svg), и для оверлей-картинки.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useSettingsStore } from '../settings'
import s from './ChatBackground.module.scss'

// useMediaTokenVersion дёргает primeMediaToken → startClient() (воркер-бутстрап) —
// вне скоупа этого теста, мокаем как StickerMedia.test.tsx.
vi.mock('../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  useMediaTokenVersion: () => 0,
}))
// Реальный ChatBackgroundGradientRenderer лезет в canvas 2D-контекст, которого
// нет в happy-dom (getContext('2d') → null) — эта задача рендерер не трогала,
// подменяем безопасной заглушкой, чтобы не тащить canvas в тест готовности слота.
vi.mock('../core/chat/gradientRenderer', () => ({
  default: class {
    init() {}
    toNextPosition() {}
  },
}))

import ChatBackground from './ChatBackground'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  complete = false
  naturalWidth = 0
  src = ''
  static instances: FakeImage[] = []
  constructor() {
    FakeImage.instances.push(this)
  }
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ wallpaper: { kind: 'default' } })
  vi.unstubAllGlobals()
  FakeImage.instances.length = 0
})

describe('ChatBackground: onerror не запирает слот навсегда', () => {
  it('сбой загрузки pattern.svg — слот активируется (градиент без узора)', () => {
    vi.stubGlobal('Image', FakeImage)
    useSettingsStore.setState({
      wallpaper: { kind: 'preset', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'] },
    })

    render(<ChatBackground />)

    const patternImg = FakeImage.instances[0]
    expect(patternImg).toBeTruthy()
    patternImg.onerror?.()

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
  })

  it('сбой загрузки оверлей-картинки — слот активируется (пустой div вместо фото)', () => {
    vi.stubGlobal('Image', FakeImage)
    useSettingsStore.setState({ wallpaper: { kind: 'image', src: 'https://example.test/photo.jpg' } })

    render(<ChatBackground />)

    const overlayImg = FakeImage.instances[0]
    expect(overlayImg).toBeTruthy()
    overlayImg.onerror?.()

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
  })
})

// Ключевое поведение задачи про обои (см. ChatBackground.tsx:78-101,
// resolveTransition): первый показ БЕЗ кэша фейдит (.SlotFade + .SlotActive),
// первый показ ИЗ кэша — сразу активен, без фейда (только .SlotActive).
describe('ChatBackground: готовность слота — первый показ без кэша / из кэша', () => {
  it('без кэша (pattern.svg грузится) — .SlotFade + .SlotActive', () => {
    vi.stubGlobal('Image', FakeImage)

    render(<ChatBackground />)

    const patternImg = FakeImage.instances[0]
    expect(patternImg).toBeTruthy()
    expect(patternImg.complete).toBe(false) // ещё не «из кэша»
    patternImg.onload?.()

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotFade)).toBe(true)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
  })

  it('из кэша (img.complete сразу после простановки src) — сразу .SlotActive, без .SlotFade', () => {
    class CachedFakeImage extends FakeImage {
      override complete = true
      override naturalWidth = 10
    }
    vi.stubGlobal('Image', CachedFakeImage)

    render(<ChatBackground />)

    const patternImg = FakeImage.instances[0]
    expect(patternImg).toBeTruthy()
    // Синхронная ветка cached в компоненте активирует слот ещё внутри эффекта —
    // без ручного onload.

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
    expect(slot?.classList.contains(s.SlotFade)).toBe(false)
  })
})
