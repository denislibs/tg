/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/background.tsx` (812502980) — фон чата за
 * карточкой экрана блокировки, кроме мобильного экрана (`ScreenSize.mobile`), и
 * ручка к его градиенту: экран сдвигает градиент на каждый ввод
 * (`passcodeLockScreen.tsx:113-122`).
 *
 * Расхождения с tweb:
 *  1. У tweb внутри — тот же Solid-`<ChatBackground>`, что рисует фон чата
 *     (`chat/bubbles/chatBackground.tsx`). Наш фон чата — React
 *     (`components/ChatBackground.tsx`, портал в body), в Solid-дерево его не
 *     вставить; здесь — его слои из тех же частей: сетчатый градиент
 *     (`ChatBackgroundGradientRenderer`), узор (`renderPattern`) и стратегия
 *     приглушения по теме (`patternModeFor`), классы — `ChatBackground.module.scss`.
 *     Переедет фон чата на Solid — этот файл сводится к оригиналу.
 *  2. Своё фото обоев (`customWallpaperMediaId`) не рисуется: под замком медиа-
 *     конвейер (воркер, зашифрованный `cachedFiles`) без ключа недоступен —
 *     вместо него градиент темы. Пресет, сплошной цвет и картинка по адресу — как
 *     в чате.
 *  3. Тема не отслеживается на лету (смена системной под открытым экраном):
 *     фон строится один раз на показ, как и снимок темы, от которого он зависит.
 */
import { type Component, createSignal, onCleanup, onMount, Show } from 'solid-js'
import mediaSizes, { ScreenSize } from '@helpers/mediaSizes'
import ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'
import { patternModeFor, patternOpacity, renderPattern } from '@core/chat/patternRenderer'
import { useSettingsStore } from '@/settings'
import patternUrl from '@/assets/pattern.svg'
import styles from '@components/ChatBackground.module.scss'

type GradientRendererRef = (value: ChatBackgroundGradientRenderer | undefined) => void

const LockChatBackground: Component<{ gradientRendererRef: GradientRendererRef }> = (props) => {
  const html = document.documentElement
  const computed = getComputedStyle(html)
  const mode = patternModeFor(html.getAttribute('data-theme'))
  const { wallpaper } = useSettingsStore.getState()

  const overlay = wallpaper.kind === 'color' ?
    { background: wallpaper.color } :
    wallpaper.kind === 'image' ?
      { 'background-image': `url(${wallpaper.src})`, 'background-size': 'cover', 'background-position': 'center' } :
      undefined
  const colors = wallpaper.kind === 'preset' ?
    wallpaper.colors :
    [0, 1, 2, 3].map((i) => computed.getPropertyValue(`--tg-bgGrad${i}`).trim())

  const patternOpacityMax = patternOpacity(mode.intensity, mode.mask)

  let slot!: HTMLDivElement
  let gradientCanvas: HTMLCanvasElement | undefined
  let patternCanvas: HTMLCanvasElement | undefined

  const reveal = (cached: boolean) => {
    if(!cached) {
      slot.classList.add(styles.SlotFade)
      void slot.offsetWidth // tweb chatBackground.tsx:411-414
    }
    slot.classList.add(styles.SlotActive)
  }

  onMount(() => {
    if(overlay) {
      reveal(true)
      return
    }

    const gradientRenderer = new ChatBackgroundGradientRenderer()
    gradientCanvas!.dataset.colors = colors.filter(Boolean).join(',')
    gradientRenderer.init(gradientCanvas!)
    props.gradientRendererRef(gradientRenderer)
    onCleanup(() => props.gradientRendererRef(undefined))

    const img = new Image()
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      patternCanvas!.width = Math.ceil(window.innerWidth * dpr)
      patternCanvas!.height = Math.ceil(window.innerHeight * dpr)
      if(!img.complete || !img.naturalWidth) return
      renderPattern(patternCanvas!, img as HTMLImageElement & { width: number, height: number }, {
        mask: mode.mask,
        viewportHeight: window.innerHeight,
        dpr,
      })
    }

    let disposed = false
    onCleanup(() => {
      disposed = true
      window.removeEventListener('resize', paint)
    })
    img.onload = () => {
      if(disposed) return
      paint()
      reveal(false)
    }
    // узор не загрузился — показываем градиент без него, а не пустоту
    img.onerror = () => { if(!disposed) reveal(false) }
    img.src = patternUrl
    if(img.complete && img.naturalWidth) {
      img.onload = null
      paint()
      reveal(true)
    }
    window.addEventListener('resize', paint)
  })

  return (
    <div class={styles.Layer}>
      <div ref={slot} class={styles.Slot}>
        <Show
          when={!overlay}
          fallback={<div style={{ position: 'absolute', inset: 0, ...overlay }} />}
        >
          {/* нижний слой при маске (night): фон приложения, сквозь дырки узора — приглушённый градиент */}
          {mode.mask && <div style={{ position: 'absolute', inset: 0, background: 'var(--background-color)' }} />}
          <canvas
            ref={gradientCanvas}
            width={50}
            height={50}
            class={styles.GradientCanvas}
            style={{ opacity: mode.mask ? patternOpacityMax : 1 }}
          />
          <canvas
            ref={patternCanvas}
            style={{
              'position': 'absolute',
              'inset': 0,
              'width': '100%',
              'height': '100%',
              'opacity': mode.mask ? 1 : patternOpacityMax,
              'mix-blend-mode': mode.mask ? 'normal' : 'soft-light',
              'filter': mode.invert ? 'invert(1)' : undefined,
            }}
          />
        </Show>
      </div>
    </div>
  )
}

const Background: Component<{ gradientRendererRef: GradientRendererRef }> = (props) => {
  const [activeScreen, setActiveScreen] = createSignal(mediaSizes.activeScreen)
  const onChangeScreen = () => setActiveScreen(mediaSizes.activeScreen)
  mediaSizes.addEventListener('changeScreen', onChangeScreen)
  onCleanup(() => mediaSizes.removeEventListener('changeScreen', onChangeScreen))

  return (
    <Show when={activeScreen() !== ScreenSize.mobile}>
      <LockChatBackground gradientRendererRef={props.gradientRendererRef} />
    </Show>
  )
}

export default Background
