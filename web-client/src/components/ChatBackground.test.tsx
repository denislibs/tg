// Регрессия ревью Task 3 (раунд 2): у отслеживающего Image был только onload —
// при сбое загрузки (404/протухший токен/удалённое медиа) activateSlot никогда
// не вызывался, hadPreviousRef оставался false, и .Slot навсегда застревал на
// opacity:0 (весь слой обоев пропадал на сессию). Проверяем, что onerror тоже
// активирует слот — и для узора (pattern.svg), и для оверлей-картинки.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../settings'
import s from './ChatBackground.module.scss'

// Реальный ChatBackgroundGradientRenderer лезет в canvas 2D-контекст, которого
// нет в happy-dom (getContext('2d') → null) — эта задача рендерер не трогала,
// подменяем безопасной заглушкой, чтобы не тащить canvas в тест готовности слота.
vi.mock('../core/chat/gradientRenderer', () => ({
  default: class {
    init() {}
    toNextPosition() {}
  },
}))

// renderPattern рисует в 2D-контекст, которого в happy-dom нет (getContext → null),
// поэтому вживую он молча выходит на первой строке и проверить стратегию нечем.
// Подменяем шпионом, `patternOpacity` оставляем настоящим.
const renderPatternSpy = vi.fn()
vi.mock('../core/chat/patternRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/chat/patternRenderer')>()),
  renderPattern: (...args: unknown[]) => renderPatternSpy(...args),
}))

import ChatBackground from './ChatBackground'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'

// Task 7: своё фото обоев резолвит useMediaUrl → managers.media.downloadMediaURL.
// В этих кейсах кастомного медиа нет — достаточно провайдера с пустым стабом.
const fakeManagers = { media: { downloadMediaURL: vi.fn(async (id: number) => `blob:media-${id}`) } } as unknown as Managers
const bg = () => (
  <ManagersProvider managers={fakeManagers}>
    <ChatBackground />
  </ManagersProvider>
)

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

    render(bg())

    const patternImg = FakeImage.instances[0]
    expect(patternImg).toBeTruthy()
    patternImg.onerror?.()

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
  })

  it('сбой загрузки оверлей-картинки — слот активируется (пустой div вместо фото)', () => {
    vi.stubGlobal('Image', FakeImage)
    useSettingsStore.setState({ wallpaper: { kind: 'image', src: 'https://example.test/photo.jpg' } })

    render(bg())

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

    render(bg())

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

    render(bg())

    const patternImg = FakeImage.instances[0]
    expect(patternImg).toBeTruthy()
    // Синхронная ветка cached в компоненте активирует слот ещё внутри эффекта —
    // без ручного onload.

    const slot = document.body.querySelector(`.${s.Slot}`)
    expect(slot?.classList.contains(s.SlotActive)).toBe(true)
    expect(slot?.classList.contains(s.SlotFade)).toBe(false)
  })
})

// Регрессия: `setTheme` вызывается в layout-эффекте ThemedApp (useThemeToggle),
// а React прогоняет layout-эффекты снизу вверх — на рендере, вызванном сменой
// темы, переменные на <html> ещё старые, и градиент инициализировался цветами
// ПРОШЛОЙ темы. На шелле это маскировали последующие перерисовки, на статичном
// экране входа обои так и оставались от предыдущей темы.
describe('ChatBackground: обои следуют за сменой темы', () => {
  const setThemeVars = (theme: string, grad: string[]) => {
    const el = document.documentElement
    el.setAttribute('data-theme', theme)
    grad.forEach((c, i) => el.style.setProperty(`--tg-bgGrad${i}`, c))
  }

  it('после смены data-theme градиент перечитывает цвета новой темы', async () => {
    vi.stubGlobal('Image', FakeImage)
    useSettingsStore.setState({ wallpaper: { kind: 'default' } })
    setThemeVars('day', ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'])

    render(bg())

    const canvas = () => document.body.querySelector('canvas') as HTMLCanvasElement | null
    expect(canvas()?.dataset.colors).toBe('#dbddbb,#6ba587,#d5d88d,#88b884')

    // Так тему применяет themeController: пишет переменные и переставляет
    // data-theme на <html> — уже ПОСЛЕ того, как React отрисовал компонент.
    setThemeVars('night', ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'])

    await waitFor(() => {
      expect(canvas()?.dataset.colors).toBe('#fec496,#dd6cb9,#962fbf,#4f5bd5')
    })
  })

  // Регрессия (сообщено с экрана): в тёмной теме фон выходил «недостаточно тёмным» —
  // яркий градиент был виден целиком. Причина — гонка отложенной отрисовки узора.
  // Первый прогон эффекта идёт ДО применения темы (dataTheme ещё null → стратегия
  // light), заводит Image и ждёт; тик темы перезапускает эффект, но imgRef ещё пуст,
  // поэтому заводится второй Image. Второй берётся из memory-кэша и красит маской,
  // а первый (сетевой) доезжает позже и перекрывает холст светлой стратегией.
  // В tweb такого не бывает: `mask` вшит в инстанс рендерера при сборке контента
  // (chatBackground.tsx:242-248), а обогнанный прогон эффекта выбрасывается
  // (`disposeBuilt`, chatBackground.tsx:299 — «used when an effect run is superseded»).
  it('опоздавшая загрузка узора от прошлой темы не перекрашивает холст светлой стратегией', async () => {
    vi.stubGlobal('Image', FakeImage)
    useSettingsStore.setState({ wallpaper: { kind: 'default' } })
    setThemeVars('day', ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'])
    renderPatternSpy.mockClear()

    render(bg())

    // Прогон №1 (тема ещё day) завёл свой Image и ждёт загрузки.
    const stale = FakeImage.instances[0]
    expect(stale).toBeTruthy()

    setThemeVars('night', ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'])

    // Прогон №2 (night) заводит второй Image — imgRef ещё пуст.
    await waitFor(() => expect(FakeImage.instances.length).toBe(2))
    const fresh = FakeImage.instances[1]

    // Кэш отдаёт свежий раньше: он красит маской.
    fresh.complete = true
    fresh.naturalWidth = 10
    fresh.onload?.()
    expect(renderPatternSpy).toHaveBeenCalled()
    const lastCall = renderPatternSpy.mock.calls[renderPatternSpy.mock.calls.length - 1]
    expect(lastCall?.[2]).toMatchObject({ mask: true })

    // Сетевой доезжает после — и не должен ничего перерисовать.
    const callsBefore = renderPatternSpy.mock.calls.length
    stale.complete = true
    stale.naturalWidth = 10
    stale.onload?.()
    expect(renderPatternSpy.mock.calls.length).toBe(callsBefore)
  })
})
