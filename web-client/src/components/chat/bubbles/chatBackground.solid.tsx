/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chat/bubbles/chatBackground.tsx` (812502980) —
 * фон чата: градиент + узор или картинка, с переходами между слоями.
 *
 * Потребителей два, как у оригинала (`:4-7`):
 *  1. Solid-компонент `<ChatBackground>` — встраивается по месту: экран
 *     блокировки (`passcodeLock/background.solid.tsx`) и плитки вкладки «Обои»
 *     (`sidebarLeft/tabs/background.solid.tsx::AppBackgroundTab.addWallPaper`).
 *  2. Синглтон `appChatBackground` — фон всей страницы первым потомком body;
 *     ставит его старт (`client/boot.ts`, tweb `index.ts:458-459`, `:567-568`),
 *     тему чата публикует оболочка (`App.tsx`, tweb `Chat.publishBackground`).
 *
 * Два слота DOM (двойная буферизация, `:9-12`): видимый и тот, где строится
 * следующий фон; готовый фон меняет их ролями через переход прозрачности.
 * Гонки — счётчиком `tempId`: устаревший прогон эффекта выбрасывает то, что
 * успел построить.
 *
 * Расхождения с оригиналом (номера — таблица «Отложено» плана волны 2D,
 * `docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`):
 *  • О-11/О-38 — нет серверных обоев и `settings.themes[]`: тема и её обои
 *    берутся адаптером `wallpapers.ts` (`getAppTheme`/`getThemeWallPaper`) из
 *    нашей настройки обоев вместо `themeController.getTheme`/`getThemeSettings`.
 *  • О-39 — тема чата — встроенная `ChatTheme` (`chatThemes.ts`), а не облачная
 *    `Theme`; публикует её оболочка по активному чату (`useShellTheme`), а не
 *    инстанс `Chat`, поэтому у `setBackground` нет колбэков одного чата
 *    (`onCachedStatus`, `onHighlightColor` в контейнер, `deferReveal` —
 *    `:636-643`, их зовёт только `chat.ts:388-433`) и у компонента — проп
 *    `deferReveal`. Цвет подсветки пишется только в `:root` (`:623`).
 *  • О-40 — файл обоев отдаёт медиа-конвейер (`core/chat/chatBackgroundStore.ts`).
 *  • Не перенесено то, у чего у нас нет потребителя: проп `peerId` с
 *    `resolveFromPeer` (`:141-157`, превью чата и попапы), `class` (`fakeBubbles`),
 *    `themeController`/`managers` (горячая перезагрузка экрана блокировки),
 *    `onCachedStatus`, `reRender` (Document PiP), `resize` (`appImManager.ts:1021`;
 *    холсты сам пересчитывает слушатель `resize` компонента).
 *  • `untrack` в `resolveBackgroundSync` (`:170`) не нужен: наша тема и обои —
 *    не Solid-сигналы, подписки из чтения не возникает.
 *  • `gradientRenderer.cleanup()` (`:303`, `:330`) не зовётся: у tweb он пуст
 *    (`gradientRenderer.ts:450-453`), у нашего порта его нет.
 */
import { type Component, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import { render } from 'solid-js/web'

import type { WallPaper } from '@layer'
import ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'
import ChatBackgroundPatternRenderer from '@core/chat/patternRenderer'
import ChatBackgroundStore from '@core/chat/chatBackgroundStore'
import { cachedMediaUrl } from '@core/mediaCache'
import { applyHighlightingColorHsla, getCurrentPreset } from '@core/theme/themeController'
import { getColorsFromWallPaper, highlightingColor } from '@shared/lib/color'
import { averageColorFromCanvas, averageColorFromImage } from '@shared/lib/averageColor'
import renderImageFromUrl from '@helpers/dom/renderImageFromUrl'
import windowSize from '@helpers/windowSize'
import { logger, LogTypes } from '@lib/logger'
import rootScope from '@lib/rootScope'
import { MOUNT_CLASS_TO } from '@config/debug'
import { useSettingsStore } from '@/settings'
import { useLockStore } from '@stores/lockStore'
import { resolvePreset } from '@/theme'
import {
  type AppTheme,
  type ChatBackgroundTheme,
  DEFAULT_BACKGROUND_SLUG,
  getAppTheme,
  getThemeWallPaper,
  type WallPaperSettingsState,
} from '@/wallpapers'
import patternUrl from '@/assets/pattern.svg'

import styles from './chatBackground.module.scss'

/**
 * - `auto` — instant if file is already in cache, else 200ms fade.
 * - `instant` — no transition.
 * - `fade` — 200ms opacity fade-in over previous bg.
 * - `crossfade-forwards` / `crossfade-backwards` — synced with the chat slide animation
 *   (`var(--transition-standard-in)` 0.3s / `var(--transition-standard-out)` 0.25s).
 */
export type ChatBackgroundTransition = 'auto' | 'instant' | 'fade' | 'crossfade-forwards' | 'crossfade-backwards'

/** Metadata about the active background's compositing, surfaced to mirror consumers (folders sidebar). */
export type ActiveBackgroundMeta = {
  /**
   * The wallpaper is a dark pattern rendered via the black *mask* path (e.g. the `night` theme): the
   * visible chat is heavily darkened by the mask, but the raw gradient — what mirror consumers copy —
   * stays at full brightness. Consumers should darken their mirror to match the chat (otherwise the
   * folders sidebar shows the full-brightness gradient, e.g. a bright purple bar in `night`).
   */
  isDarkMaskPattern: boolean
}

export type ChatBackgroundProps = {
  theme?: ChatBackgroundTheme
  wallPaper?: WallPaper
  transition?: ChatBackgroundTransition
  /**
   * Pattern-canvas size (CSS pixels). Defaults to the window size — correct for full-screen chat
   * backgrounds, but wasteful for thumbnails. Picker / theme-tile previews should pass the actual
   * rendered size of `.background-item` so we don't build a 1400×900 canvas to be CSS-scaled into
   * a ~72×96 tile.
   */
  width?: number
  height?: number
  gradientRendererRef?: (value: ChatBackgroundGradientRenderer | undefined, meta?: ActiveBackgroundMeta) => void
  onHighlightColor?: (hsla: string) => void
  onReady?: () => void
}

type ResolvedBackground = {
  theme: ChatBackgroundTheme
  wallPaper: WallPaper
}

/** One of the two double-buffered DOM layers. Holds the renderers/canvases currently mounted into `el`. */
type Slot = {
  el: HTMLElement
  appliedTheme?: ChatBackgroundTheme
  appliedWallPaper?: WallPaper
  patternRenderer?: ChatBackgroundPatternRenderer
  gradientCanvas?: HTMLCanvasElement
  patternCanvas?: HTMLCanvasElement
  image?: HTMLImageElement
}

/**
 * Pre-built background not yet attached to a slot. The Solid effect builds these offstage so a
 * stale run (superseded by a newer one) can throw it away without touching live DOM.
 */
type BuiltContent = {
  resolved: ResolvedBackground
  isPattern: boolean
  isDarkPattern: boolean
  isTinted: boolean
  patternRenderer?: ChatBackgroundPatternRenderer
  patternCanvas?: HTMLCanvasElement
  gradientRenderer?: ChatBackgroundGradientRenderer
  gradientCanvas?: HTMLCanvasElement
  image?: HTMLImageElement
  readyPromise: Promise<void>
}

const FADE_TRANSITION_CLASSES = [
  styles.SlotFade,
  styles.SlotCrossfadeForwards,
  styles.SlotCrossfadeBackwards,
]

const log = logger('CHAT-BG', LogTypes.Log | LogTypes.Warn | LogTypes.Error)

// ── Адаптер темы и обоев (О-11/О-38) ─────────────────────────────────────────

/** tweb `themeController.getResolvedThemeName` (`themeController.ts:497-501`). */
const getResolvedThemeName = () => getCurrentPreset() ?? resolvePreset(useSettingsStore.getState().themeChoice)

/**
 * Наша настройка обоев на момент разрешения. Своё фото под замком без готового
 * адреса не берётся: медиа-конвейер без ключа недоступен, и вместо пустого
 * слоя фон рисует обои темы (О-40).
 */
function getWallPaperSettingsState(): WallPaperSettingsState {
  const { wallpaper, customWallpaperMediaId, customWallpaperBlur } = useSettingsStore.getState()
  const canShowCustom = customWallpaperMediaId != null &&
    (!useLockStore.getState().locked || cachedMediaUrl(customWallpaperMediaId) !== undefined)
  return {
    wallpaper,
    customWallpaperMediaId: canShowCustom ? customWallpaperMediaId : undefined,
    customWallpaperBlur,
  }
}

/** tweb `themeController.getTheme()` — активная тема приложения. */
const getGlobalTheme = (): AppTheme => getAppTheme(getResolvedThemeName())

function resolveBackgroundSync(options: { theme?: ChatBackgroundTheme, wallPaper?: WallPaper }): ResolvedBackground {
  const theme = options.theme ?? getGlobalTheme()
  const wallPaper = options.wallPaper ?? getThemeWallPaper(theme, getWallPaperSettingsState(), getResolvedThemeName())
  return { theme, wallPaper }
}

function getWallPaperUrl(wallPaper: WallPaper): { urlOrPromise: string | Promise<string> | undefined, isColorOnly: boolean } {
  const colors = getColorsFromWallPaper(wallPaper)
  const slug = (wallPaper as WallPaper.wallPaper)?.slug
  const isColorOnly = !!colors && !slug && !wallPaper.settings?.intensity

  if(isColorOnly || !slug) {
    return { urlOrPromise: undefined, isColorOnly }
  }

  // Built-in default pattern is bundled — used on auth screens before managers exist.
  if(slug === DEFAULT_BACKGROUND_SLUG) {
    return { urlOrPromise: patternUrl, isColorOnly }
  }

  const settings = wallPaper.settings
  const urlOrPromise = ChatBackgroundStore.getBackground({
    slug,
    blur: !!settings?.pFlags.blur,
  })

  return { urlOrPromise, isColorOnly }
}

function buildContent(
  layer: HTMLElement,
  resolved: ResolvedBackground,
  url: string | undefined,
  width: number,
  height: number,
): BuiltContent {
  const { wallPaper } = resolved
  const colors = getColorsFromWallPaper(wallPaper)
  const isPattern = !!(wallPaper as WallPaper.wallPaper)?.pFlags?.pattern
  const themeName = (resolved.theme as AppTheme)?.name
  // Two compositing strategies for dark patterns:
  // - Default (mask): pattern canvas painted black with pattern-shape holes, covering most of the gradient.
  //   Only the pattern shape gets the gradient color. Used by `night` (its bright peach/pink/purple gradient
  //   would be too vivid at full opacity — the mask "darkens" the result by black-ing the gaps).
  // - Overlay (Android-faithful): gradient at full opacity, pattern image as a soft-light overlay (with
  //   color invert because the bundled pattern.svg is black-on-transparent and we need light doodles over
  //   the dark gradient). Matches MotionBackgroundDrawable's positive-intensity flow. Used by `tinted` so
  //   its dark navy gradient is actually visible (matches Android Dark Blue's appearance).
  const useOverlayRender = themeName === 'tinted'
  // Tinted forces its rendering parameters from the default tinted wallpaper so picker selections preserve
  // the "Dark Blue" rendering style (overlay + intensity 38) regardless of the picked theme's intensity sign.
  // Picker still controls gradient colors and accent — only the rendering knobs (intensity, isDarkPattern)
  // are held to default tinted's values.
  let intensity = wallPaper.settings?.intensity && wallPaper.settings.intensity / 100
  if(useOverlayRender) intensity = -0.38
  const isDarkPattern = useOverlayRender || (!!intensity && intensity < 0)

  let patternCanvas: HTMLCanvasElement | undefined
  let gradientCanvas: HTMLCanvasElement | undefined
  let image: HTMLImageElement | undefined
  let patternRenderer: ChatBackgroundPatternRenderer | undefined
  let gradientRenderer: ChatBackgroundGradientRenderer | undefined

  if(url && isPattern) {
    patternRenderer = ChatBackgroundPatternRenderer.getInstance({
      element: layer,
      url,
      width,
      height,
      mask: isDarkPattern && !useOverlayRender,
    })
    patternCanvas = patternRenderer.createCanvas()
    patternCanvas.classList.add(styles.CanvasCommon)
    if(!isDarkPattern || useOverlayRender) patternCanvas.classList.add(styles.Blend)
    if(useOverlayRender) patternCanvas.classList.add(styles.DarkPatternInvert)
  } else if(url) {
    image = document.createElement('img')
    image.alt = ''
    image.classList.add(styles.CanvasCommon)
  }

  if(colors) {
    const created = ChatBackgroundGradientRenderer.create(colors)
    gradientRenderer = created.gradientRenderer
    gradientCanvas = created.canvas
    gradientCanvas.classList.add(styles.CanvasCommon, styles.GradientCanvas)
  }

  if(intensity) {
    // Mask path applies opacity to the gradient (so the small visible gradient area in pattern shape
    // is dimmed). Overlay path applies opacity to the pattern overlay (gradient stays full).
    const setOpacityTo = image ?? (isDarkPattern && !useOverlayRender ? gradientCanvas : patternCanvas)
    let opacityMax = Math.abs(intensity) * (isDarkPattern && !useOverlayRender ? .5 : 1)
    if(image) opacityMax = Math.max(0.3, 1 - intensity)
    else if(isDarkPattern && !useOverlayRender) opacityMax = Math.max(0.3, opacityMax)
    setOpacityTo?.style.setProperty('--opacity-max', '' + opacityMax)
  }

  const readyPromise = new Promise<void>((resolve) => {
    if(patternRenderer && patternCanvas) {
      void patternRenderer.renderToCanvas(patternCanvas).then(() => resolve())
    } else if(image && url) {
      void renderImageFromUrl(image, url, () => resolve(), false)
    } else {
      resolve()
    }
  })

  return {
    resolved,
    isPattern,
    isDarkPattern,
    isTinted: useOverlayRender,
    patternRenderer,
    patternCanvas,
    gradientRenderer,
    gradientCanvas,
    image,
    readyPromise,
  }
}

/** Releases renderers attached to a built-but-not-mounted content (used when an effect run is superseded). */
function disposeBuilt(built: BuiltContent) {
  if(built.patternRenderer && built.patternCanvas) built.patternRenderer.cleanup(built.patternCanvas)
}

/** Moves a built content into a slot's DOM, taking ownership of its renderers. */
function attachBuiltToSlot(slot: Slot, built: BuiltContent) {
  slot.el.classList.toggle(styles.IsPattern, built.isPattern)
  slot.el.classList.toggle(styles.IsImage, !!built.image)
  slot.el.classList.toggle(styles.IsTinted, built.isTinted)

  if(built.gradientCanvas) slot.el.append(built.gradientCanvas)
  if(built.patternCanvas) slot.el.append(built.patternCanvas)
  if(built.image) slot.el.append(built.image)

  slot.appliedTheme = built.resolved.theme
  slot.appliedWallPaper = built.resolved.wallPaper
  slot.patternRenderer = built.patternRenderer
  slot.gradientCanvas = built.gradientCanvas
  slot.patternCanvas = built.patternCanvas
  slot.image = built.image
}

function clearSlot(slot: Slot) {
  if(slot.patternRenderer && slot.patternCanvas) {
    slot.patternRenderer.cleanup(slot.patternCanvas)
  }
  while(slot.el.firstChild) slot.el.removeChild(slot.el.firstChild)
  slot.appliedTheme = undefined
  slot.appliedWallPaper = undefined
  slot.patternRenderer = undefined
  slot.gradientCanvas = undefined
  slot.patternCanvas = undefined
  slot.image = undefined
}

function transitionClassFor(transition: ChatBackgroundTransition): string | undefined {
  switch(transition) {
    case 'fade': return styles.SlotFade
    case 'crossfade-forwards': return styles.SlotCrossfadeForwards
    case 'crossfade-backwards': return styles.SlotCrossfadeBackwards
    default: return undefined
  }
}

function resolveTransition(
  requested: ChatBackgroundTransition | undefined,
  cached: boolean,
  hadPrevious: boolean,
): ChatBackgroundTransition {
  // First-ever bg, or caller didn't override: cache hit → instant, miss → fade.
  if(!hadPrevious || !requested || requested === 'auto') {
    return cached ? 'instant' : 'fade'
  }
  return requested
}

function computeHighlightingHsla(built: BuiltContent): string | undefined {
  if(!built.gradientCanvas && !built.image) return
  const pixel = built.image ? averageColorFromImage(built.image) : averageColorFromCanvas(built.gradientCanvas!)
  return highlightingColor(Array.from(pixel) as [number, number, number, number])
}

function createSlotEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.classList.add(styles.Slot)
  return el
}

export const ChatBackground: Component<ChatBackgroundProps> = (props) => {
  let layer!: HTMLDivElement

  // Two double-buffered slots: `visibleSlot` is what the user currently sees, `stagingSlot` is
  // where the next bg is built. After the transition completes their roles swap.
  let visibleSlot!: Slot
  let stagingSlot!: Slot

  // Monotonic counter — each effect run claims one. If a later run starts before this one
  // finishes (e.g. props change during async URL load), the older run aborts at its next checkpoint.
  let tempId = 0

  /** Promotes `stagingSlot` to visible and demotes `visibleSlot`, then swaps the references. */
  const presentStagingSlot = (transition: ChatBackgroundTransition) => {
    const incoming = stagingSlot
    const outgoing = visibleSlot

    incoming.el.classList.remove(...FADE_TRANSITION_CLASSES)
    outgoing.el.classList.remove(...FADE_TRANSITION_CLASSES)

    const transitionClass = transitionClassFor(transition)
    if(transitionClass) {
      incoming.el.classList.add(transitionClass)
      outgoing.el.classList.add(transitionClass)
    }

    if(transition === 'instant') {
      incoming.el.classList.add(styles.SlotActive)
      outgoing.el.classList.remove(styles.SlotActive)
      ;[visibleSlot, stagingSlot] = [incoming, outgoing]
      clearSlot(stagingSlot)
      return
    }

    // Force reflow so the just-added transition class kicks in cleanly.
    void incoming.el.offsetWidth

    incoming.el.classList.add(styles.SlotActive)
    // Crossfades and plain fade alike: the outgoing slot fades out (tweb `:416-420`).
    outgoing.el.classList.remove(styles.SlotActive)

    ;[visibleSlot, stagingSlot] = [incoming, outgoing]

    if(stagingSlot.appliedWallPaper) {
      stagingSlot.el.addEventListener('transitionend', () => {
        stagingSlot.el.classList.remove(styles.SlotActive)
        clearSlot(stagingSlot)
      }, { once: true })
    }
  }

  onMount(() => {
    visibleSlot = { el: createSlotEl() }
    stagingSlot = { el: createSlotEl() }
    layer.append(visibleSlot.el, stagingSlot.el)

    const onResize = () => void ChatBackgroundPatternRenderer.resizeInstancesOf(layer)
    window.addEventListener('resize', onResize)
    onCleanup(() => {
      window.removeEventListener('resize', onResize)
      clearSlot(visibleSlot)
      clearSlot(stagingSlot)
    })
  })

  createEffect(on(
    () => [props.theme, props.wallPaper] as const,
    async(deps) => {
      const [theme, wallPaper] = deps
      const myTempId = ++tempId

      const resolved = resolveBackgroundSync({ theme, wallPaper })

      if(visibleSlot.appliedTheme === resolved.theme && visibleSlot.appliedWallPaper === resolved.wallPaper) {
        log('same background, skipping')
        props.onReady?.()
        return
      }

      // Load the wallpaper file (may be cached or kick off a download).
      const { urlOrPromise } = getWallPaperUrl(resolved.wallPaper)
      let url: string | undefined
      let cached = true
      if(urlOrPromise !== undefined) {
        cached = !(urlOrPromise instanceof Promise)
        try {
          url = await urlOrPromise
        } catch(err) {
          log.warn('wallpaper load failed', err)
          props.onReady?.()
          return
        }
        if(myTempId !== tempId) return
      }

      // Build canvases/renderers offstage; only mount into the slot once we know we're still current.
      const built = buildContent(
        layer,
        resolved,
        url,
        props.width ?? windowSize.width,
        props.height ?? windowSize.height,
      )
      await built.readyPromise
      if(myTempId !== tempId) {
        disposeBuilt(built)
        return
      }

      const hadPrevious = !!visibleSlot.appliedWallPaper
      const transition = resolveTransition(props.transition, cached, hadPrevious)

      clearSlot(stagingSlot)
      attachBuiltToSlot(stagingSlot, built)

      const hsla = computeHighlightingHsla(built)
      if(hsla) props.onHighlightColor?.(hsla)

      presentStagingSlot(transition)
      // `isDarkMaskPattern`: dark pattern via the mask path (night) — gradient stays bright while
      // the visible chat is darkened by the mask. Tinted (overlay) and light renders show the
      // gradient directly, so their mirror needs no extra darkening.
      props.gradientRendererRef?.(built.gradientRenderer, {
        isDarkMaskPattern: built.isDarkPattern && !built.isTinted,
      })
      props.onReady?.()
    },
  ))

  return <div ref={layer} class={styles.Layer} />
}

/**
 * Page-wide singleton. Lives at module scope, mounts a `<ChatBackground>` into a body-level div.
 *
 * Imperative API surface:
 * - `attach(parent)` — mount the layer (idempotent; default parent is `document.body`).
 * - `setBackground({theme, wallPaper, transition})` — drive a new bg, returns a
 *   promise that resolves once the new layer is on screen. Calling again before resolution
 *   resolves the previous promise as superseded.
 * - `getActiveGradientRenderer()` — current gradient renderer (used by send-message animation).
 * - `getReadyPromise()` — promise of the most recent `setBackground` call (or resolved if idle).
 */
const appChatBackground = (() => {
  const element = document.createElement('div')
  element.setAttribute('aria-hidden', 'true')

  // Solid signal driving the embedded `<ChatBackground>` props.
  const [props, setProps] = createSignal<ChatBackgroundProps>({})

  let activeGradientRenderer: ChatBackgroundGradientRenderer | undefined
  let activeGradientMeta: ActiveBackgroundMeta | undefined
  const gradientRendererListeners = new Set<(r: ChatBackgroundGradientRenderer | undefined, meta?: ActiveBackgroundMeta) => void>()
  let mounted = false

  // `pendingResolve` resolves the promise returned from the in-flight setBackground call.
  // Replaced (and called) when a newer setBackground arrives.
  let pendingResolve: (() => void) | undefined
  let latestReady: Promise<void> = Promise.resolve()
  // Resolved theme/wallPaper of the render currently in flight (set just before `setProps`,
  // cleared on its `onReady`). Lets a duplicate call for the *same* background attach to the
  // in-flight render instead of superseding it — see the in-flight guard in `setBackground`.
  let pendingTheme: ChatBackgroundTheme | undefined
  let pendingWallPaper: WallPaper | undefined
  // Tracks the most-recently-applied (settled) theme/wallPaper so we can short-circuit a
  // setBackground call whose deps match — otherwise the inner `on(...)` effect wouldn't fire
  // and the returned promise would hang.
  let lastAppliedTheme: ChatBackgroundTheme | undefined
  let lastAppliedWallPaper: WallPaper | undefined
  let hasSettled = false
  // While the displayed background belongs to an explicit per-chat theme/wallpaper (a chat that
  // pinned its own background) rather than the global theme, `backgroundOwnedByChat` is true and
  // `ownedTheme`/`ownedWallPaper` hold the *raw* opts that established it. The `theme_changed`
  // re-paint below re-publishes those instead of the global theme: a per-chat theme is a stable
  // object across day/night, so re-resolving it picks the new variant.
  let backgroundOwnedByChat = false
  let ownedTheme: ChatBackgroundTheme | undefined
  let ownedWallPaper: WallPaper | undefined

  const attach = (parent: HTMLElement = document.body) => {
    if(element.parentElement !== parent) {
      parent.insertBefore(element, parent.firstChild)
    }
    if(mounted) return
    mounted = true

    render(() => (
      <ChatBackground
        theme={props().theme}
        wallPaper={props().wallPaper}
        transition={props().transition}
        gradientRendererRef={(r, meta) => {
          activeGradientRenderer = r
          activeGradientMeta = meta
          for(const listener of gradientRendererListeners) listener(r, meta)
        }}
        onHighlightColor={(hsla) => {
          // Always update the global root — the auth shell, sidebars, and any
          // bubble outside an active chat container all read the highlighting
          // color from `:root`.
          applyHighlightingColorHsla(hsla)
        }}
        onReady={() => props().onReady?.()}
      />
    ), element)
  }

  const setBackground = (opts: {
    theme?: ChatBackgroundTheme,
    wallPaper?: WallPaper,
    transition?: ChatBackgroundTransition
  } = {}): Promise<void> => {
    // Resolve undefined theme/wallPaper to the *current global* theme + wallpaper up front:
    // the short-circuit below keys off these references, and a changed global wallpaper must
    // not match the previous `undefined` (tweb `:644-652`).
    const { theme: resolvedTheme, wallPaper: resolvedWallPaper } =
      resolveBackgroundSync({ theme: opts.theme, wallPaper: opts.wallPaper })

    // Per-chat ownership: an explicit theme that differs from the global one, or an explicit
    // wallpaper. (An undefined theme resolves to the global theme — not per-chat.)
    backgroundOwnedByChat = (!!opts.theme && opts.theme !== getGlobalTheme()) || !!opts.wallPaper
    ownedTheme = opts.theme
    ownedWallPaper = opts.wallPaper

    // A render for the *same* resolved background is already in flight (a theme switch:
    // `theme_changed` re-publishes synchronously and the shell re-publishes the same thing a
    // tick later). Attach to the in-flight render instead of superseding it — superseding would
    // resolve the awaited `getReadyPromise()` early (tweb `:665-678`).
    if(pendingResolve && pendingTheme === resolvedTheme && pendingWallPaper === resolvedWallPaper) {
      return latestReady
    }

    // Resolve any (different) in-flight promise as superseded so awaiters don't hang.
    pendingResolve?.()

    let resolve!: () => void
    latestReady = new Promise<void>((r) => resolve = r)
    pendingResolve = resolve

    // The component's effect runs via `on([theme, wallPaper])` (referential equality).
    // If theme & wallPaper are unchanged the effect won't fire — onReady would never be called
    // and awaiters would hang. Short-circuit in that case.
    if(hasSettled && lastAppliedTheme === resolvedTheme && lastAppliedWallPaper === resolvedWallPaper) {
      resolve()
      if(pendingResolve === resolve) pendingResolve = undefined
      return latestReady
    }

    pendingTheme = resolvedTheme
    pendingWallPaper = resolvedWallPaper
    setProps({
      theme: resolvedTheme,
      wallPaper: resolvedWallPaper,
      transition: opts.transition,
      onReady: () => {
        hasSettled = true
        lastAppliedTheme = resolvedTheme
        lastAppliedWallPaper = resolvedWallPaper
        // Clear the in-flight marker only if it still points at this render (a newer, different
        // setProps may have replaced it).
        if(pendingTheme === resolvedTheme && pendingWallPaper === resolvedWallPaper) {
          pendingTheme = undefined
          pendingWallPaper = undefined
        }
        resolve()
        if(pendingResolve === resolve) pendingResolve = undefined
      },
    })

    return latestReady
  }

  // Re-paint when the global theme switches (day ↔ night). `instant`, not `fade`: theme switches
  // animate via the view transition (`core/theme/themeTransition.ts`), which awaits this
  // re-render (`getReadyPromise`) before snapshotting the new state (tweb `:732-757`).
  rootScope.addEventListener('theme_changed', () => {
    if(!hasSettled) return
    void setBackground({
      theme: backgroundOwnedByChat ? ownedTheme : getGlobalTheme(),
      wallPaper: backgroundOwnedByChat ? ownedWallPaper : undefined,
      transition: 'instant',
    })
  })

  return {
    element,
    attach,
    setBackground,
    getActiveGradientRenderer: () => activeGradientRenderer,
    /**
     * Subscribe to changes of the active gradient renderer (replaced on wallpaper/theme swap).
     * Listener is called with the current renderer immediately on subscribe. Returns an
     * unsubscribe function.
     */
    onActiveGradientRendererChange: (
      listener: (r: ChatBackgroundGradientRenderer | undefined, meta?: ActiveBackgroundMeta) => void,
    ) => {
      gradientRendererListeners.add(listener)
      listener(activeGradientRenderer, activeGradientMeta)
      return () => {
        gradientRendererListeners.delete(listener)
      }
    },
    getReadyPromise: () => latestReady,
  }
})()

/**
 * Смена обоев в настройках → перерисовка фона (О-11). У tweb выбор во вкладке
 * «Обои» сам зовёт `appImManager.applyCurrentTheme` → `setBackground`
 * (`background.tsx:253-257`, `appImManager.ts:2629-2637`, переход `fade`); у нас
 * обои — ключи стора, и их пишут три места (сетка, «Цвет», «Сбросить»), поэтому
 * перерисовку заводит подписка на эти ключи. Ставит старт (`client/boot.ts`).
 */
export function watchWallPaperSettings(): () => void {
  return useSettingsStore.subscribe((state, prev) => {
    if(
      state.wallpaper === prev.wallpaper &&
      state.customWallpaperMediaId === prev.customWallpaperMediaId &&
      state.customWallpaperBlur === prev.customWallpaperBlur
    ) {
      return
    }

    void appChatBackground.setBackground({ transition: 'fade' })
  })
}

export type AppChatBackground = typeof appChatBackground
// tweb :796 — `MOUNT_CLASS_TO && (…)`; `if` вместо `&&` — `no-unused-expressions`.
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.appChatBackground = appChatBackground
export default appChatBackground

