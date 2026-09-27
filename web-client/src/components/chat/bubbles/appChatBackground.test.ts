/**
 * Синглтон `appChatBackground` — порт tweb `chat/bubbles/chatBackground.tsx:560-793`
 * (812502980) — и адаптер к нашей модели обоев. Предмет:
 *  • `attach` ставит слой ПЕРВЫМ потомком body с `aria-hidden` (`:600-603`),
 *    повторный — идемпотентен;
 *  • `setBackground()` без опций рисует обои активной темы из наших настроек
 *    (О-11/О-38), обещание решается, когда фон на экране; тот же фон — пустой
 *    ход (`:690-703`), тот же фон в полёте — присоединение (`:673-678`);
 *  • `theme_changed` перерисовывает обои новой темы мгновенно (`:743-757`),
 *    а тема чата, если она владеет фоном, переигрывается своим вариантом;
 *  • ручка к градиенту для ленты и зеркала (`:763-777`), подсветка в `:root`;
 *  • смена обоев в настройках → перерисовка (`watchWallPaperSettings`, О-11);
 *  • своё фото под замком без готового адреса → обои темы (О-40).
 *
 * У синглтона состояние модуля, поэтому каждый тест поднимает свежий граф
 * (`vi.resetModules`) и берёт из него же стор настроек, тему и шину.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeCanvas } from '@/test/fakeCanvas'

const ensureMediaUrl = vi.hoisted(() => vi.fn(async(id: number) => `blob:media-${id}`))
vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl }))

let fakeCanvas: ReturnType<typeof installFakeCanvas>

beforeEach(() => {
  vi.resetModules()
  fakeCanvas = installFakeCanvas()
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  fakeCanvas.restore()
  ensureMediaUrl.mockClear()
})

async function load() {
  const { default: appChatBackground, watchWallPaperSettings } = await import('./chatBackground.solid')
  const { default: styles } = await import('./chatBackground.module.scss')
  const { useSettingsStore, DEFAULTS } = await import('@/settings')
  const { setTheme } = await import('@core/theme/themeController')
  const { useLockStore } = await import('@stores/lockStore')
  const { applyMediaUrl } = await import('@core/mediaCache')
  const { CHAT_THEMES } = await import('@/chatThemes')
  const wallpapers = await import('@/wallpapers')
  useSettingsStore.getState().update({
    themeChoice: 'day',
    wallpaper: DEFAULTS.wallpaper,
    customWallpaperMediaId: undefined,
    customWallpaperBlur: false,
  })
  setTheme('day')
  const activeSlot = () => [...appChatBackground.element.firstElementChild!.children]
    .find((slot) => slot.classList.contains(styles.SlotActive)) as HTMLElement | undefined
  const shownColors = () => (activeSlot()?.firstElementChild as HTMLElement | null)?.dataset.colors
  return {
    appChatBackground,
    watchWallPaperSettings,
    styles,
    useSettingsStore,
    setTheme,
    useLockStore,
    applyMediaUrl,
    CHAT_THEMES,
    wallpapers,
    activeSlot,
    shownColors,
  }
}

const DAY = '#dbddbb,#6ba587,#d5d88d,#88b884'
const NIGHT = '#fec496,#dd6cb9,#962fbf,#4f5bd5'

describe('appChatBackground — слой страницы', () => {
  it('attach — первым потомком body, aria-hidden; повторный attach не монтирует второй слой', async() => {
    const { appChatBackground } = await load()
    const first = document.createElement('div')
    document.body.append(first)

    appChatBackground.attach()
    appChatBackground.attach()

    expect(document.body.firstElementChild).toBe(appChatBackground.element)
    expect(appChatBackground.element.getAttribute('aria-hidden')).toBe('true')
    expect(appChatBackground.element.children).toHaveLength(1)
  })

  it('setBackground() — обои активной темы; обещание решается, когда фон на экране', async() => {
    const { appChatBackground, shownColors } = await load()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })
    expect(shownColors()).toBe(DAY)
  })

  it('тот же фон повторно — пустой ход (слот не перестраивается)', async() => {
    const { appChatBackground, activeSlot } = await load()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })
    const canvas = activeSlot()!.firstElementChild
    await appChatBackground.setBackground()
    expect(activeSlot()!.firstElementChild).toBe(canvas)
  })

  it('подсветка — hsla от среднего цвета обоев в :root', async() => {
    const { appChatBackground } = await load()
    appChatBackground.attach()
    const before = document.documentElement.style.getPropertyValue('--message-highlighting-color')
    await appChatBackground.setBackground({ transition: 'instant' })
    const after = document.documentElement.style.getPropertyValue('--message-highlighting-color')
    expect(after).toMatch(/^hsla\(.+, \.4\)$/)
    // не умолчание пресета, а вывод из холста
    expect(after).not.toBe(before)
  })
})

describe('appChatBackground — тема', () => {
  it('theme_changed: день → ночь перерисовывает обои ночной темы мгновенно', async() => {
    const { appChatBackground, setTheme, shownColors, activeSlot, styles } = await load()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })

    setTheme('night')
    await appChatBackground.getReadyPromise()

    expect(shownColors()).toBe(NIGHT)
    expect(activeSlot()!.classList.contains(styles.SlotFade)).toBe(false)
  })

  it('тема чата владеет фоном: её градиент, на смене темы — её же тёмный вариант', async() => {
    const { appChatBackground, setTheme, shownColors, CHAT_THEMES, wallpapers } = await load()
    const chatTheme = CHAT_THEMES[0]
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })
    await appChatBackground.setBackground({ theme: wallpapers.getChatThemeBackground(chatTheme), transition: 'instant' })
    expect(shownColors()).toBe(chatTheme.light.gradient.join(','))

    setTheme('night')
    await appChatBackground.getReadyPromise()
    expect(shownColors()).toBe(chatTheme.dark.gradient.join(','))

    // чат без темы — снова обои приложения
    await appChatBackground.setBackground({ transition: 'instant' })
    expect(shownColors()).toBe(NIGHT)
  })

  it('ручка к градиенту: подписчик получает текущий сразу и новый на смене, мета маски — у ночи', async() => {
    const { appChatBackground, setTheme } = await load()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })

    const seen: [unknown, boolean | undefined][] = []
    const off = appChatBackground.onActiveGradientRendererChange((renderer, meta) => seen.push([renderer, meta?.isDarkMaskPattern]))
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe(appChatBackground.getActiveGradientRenderer())
    expect(seen[0][0]).toBeDefined()
    expect(seen[0][1]).toBe(false)

    setTheme('night')
    await appChatBackground.getReadyPromise()
    expect(seen).toHaveLength(2)
    expect(seen[1][0]).not.toBe(seen[0][0])
    expect(seen[1][1]).toBe(true)

    off()
    setTheme('day')
    await appChatBackground.getReadyPromise()
    expect(seen).toHaveLength(2)
  })
})

describe('appChatBackground — настройки обоев', () => {
  it('смена обоев в сторе перерисовывает фон с fade', async() => {
    const { appChatBackground, watchWallPaperSettings, useSettingsStore, shownColors, activeSlot, styles } = await load()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })
    const unwatch = watchWallPaperSettings()

    const colors = ['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea']
    useSettingsStore.getState().update({ wallpaper: { kind: 'preset', colors } })
    await appChatBackground.getReadyPromise()
    expect(shownColors()).toBe(colors.join(','))
    expect(activeSlot()!.classList.contains(styles.SlotFade)).toBe(true)

    // посторонний ключ — не повод перерисовывать
    const canvas = activeSlot()!.firstElementChild
    useSettingsStore.getState().update({ textSize: 17 })
    await appChatBackground.getReadyPromise()
    expect(activeSlot()!.firstElementChild).toBe(canvas)
    unwatch()
  })

  it('своё фото под замком без готового адреса — обои темы; с адресом в зеркале — фото', async() => {
    const { appChatBackground, useSettingsStore, useLockStore, applyMediaUrl, shownColors, activeSlot } = await load()
    useSettingsStore.getState().update({ customWallpaperMediaId: 42 })
    useLockStore.getState().lock()
    appChatBackground.attach()
    await appChatBackground.setBackground({ transition: 'instant' })
    expect(shownColors()).toBe(DAY)
    expect(ensureMediaUrl).not.toHaveBeenCalled()

    applyMediaUrl({ id: 42, thumb: false, url: 'blob:cached-42' })
    await appChatBackground.setBackground({ transition: 'instant' })
    expect(activeSlot()!.querySelector('img')!.getAttribute('src')).toBe('blob:cached-42')
    useLockStore.getState().unlock()
  })
})
