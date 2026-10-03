/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chatTips/index.tsx` (812502980, 291 строка) — колода карточек
 * пустой колонки чата (Б-13 бэклога волны 7). Монтирует `appImManager.construct` рядом с
 * `chatsContainer` (tweb `appImManager.ts:375-377`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *  1. Нет HMR-веток (`useHotReloadGuard`, `SolidJSHotReloadGuardProvider`, `import.meta.hot`,
 *     `:16-17`, `:79-82`, `:270-291`): у нас их не портируют (шапка
 *     `sidebarLeft/tabs/notifications.solid.tsx`), синглтоны импортируются напрямую. Метка
 *     `MOUNT_CLASS` и уборка прежнего монтирования по DOM (`:247-251`) оставлены: они же
 *     держат повторный вызов `renderChatTips`.
 *  2. `pinServiceColor` (`:139-145`) не портирован: своего цвета подсветки у глобальной темы,
 *     отдельного от корня (`themeController.applyHighlightingColor({element})` без `hsla`), у
 *     нас нет — его пишет только фон чата прямо на корень
 *     (`chat/bubbles/chatBackground.solid.tsx`). Плашки берут `--message-highlighting-color`
 *     корня; колода при открытом чате и так скрыта.
 *  3. Живой регион объявления шага (`announcement`, `div.sr-only`, `:89-101`, `:213`) не
 *     портирован: класса `.sr-only` у нас нет (партиал `scss/partials/_accessibility.scss` не
 *     портирован) — без него текст объявления встал бы видимой строкой под карточкой.
 *  4. Подписка на `peer_changed` — `subscribeOn(appImManager)` прямо на синглтон (у tweb —
 *     через guard, `:73-75`).
 */
import { createEffect, createSignal, createUniqueId, For, onCleanup, Show, type Component } from 'solid-js'
import { Dynamic, Portal, render } from 'solid-js/web'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import { useMediaSizes } from '@helpers/mediaSizes'
import classNames from '@helpers/string/classNames'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import I18n, { i18n } from '@lib/langPack'
import appImManager from '@lib/appImManager'
import { useAppSettings } from '@stores/appSettings.solid'
import animationIntersector from '@components/animationIntersector'
import Button from '@components/buttonTsx.solid'
import Scrollable from '@components/scrollable2.solid'
import AppearanceTipCard from './appearanceCard.solid'
import ChatsTipCard from './chatsCard.solid'
import StickersTipCard from './stickersCard.solid'
import { TipSlotProvider } from './tipCard.solid'
import styles from './chatTips.module.scss'

/**
 * Tip cards for the empty chat column — what the middle column shows while no chat is open
 * (nothing but the wallpaper, before this), after the macOS client's `WidgetController`
 * (Telegram-Mac/WidgetController.swift). One tip at a time, centred, stepped through with the
 * Previous / Next pills under it. Each card carries the real control it talks about, so the app
 * is configurable without ever leaving the empty screen:
 *
 * - **Appearance** — light/dark/system plus the cloud-theme thumbnails.
 * - **Stickers** — the "Suggest Stickers by Emoji" mode plus a few trending packs.
 * - **Chats** — the peers to jump back into, filtered by popular / recently searched / recently
 *   closed (see `contacts.pushRecentlyClosedChat`).
 *
 * The deck collapses to a service pill with the corner toggle, and stays collapsed (and on the tip
 * it was left on) across reopens.
 */

// Order follows macOS' `WidgetController.viewDidLoad` — Appearance, Stickers, then Recent Peers.
// (Its App Icon widget in between has no tweb equivalent.)
const TIPS: Component[] = [AppearanceTipCard, StickersTipCard, ChatsTipCard]

/** How far a waiting card sits to the side, in px. macOS slides its widgets by 50. */
const SLIDE = 50

/**
 * Animation group for everything the cards play, so it can be parked wholesale while a chat is
 * open — the deck stays mounted and ready, but its stickers have no business looping behind a
 * conversation.
 */
const ANIMATION_GROUP = 'CHAT-TIPS'

/** Show the deck anyway if the card that is up never reports in (a failed fetch, say). */
const REVEAL_TIMEOUT = 2000

/**
 * A single-column layout — a handheld, or the width at which the chat list turns into a drawer
 * over the chat — has no empty column to fill: the chat list itself is the empty state there, and
 * the chat column only ever shows up with a chat in it. So the deck isn't drawn at all, not just
 * hidden: nothing mounts, nothing is fetched, until the window is wide enough for two columns.
 */
function ChatTips() {
  const mediaSizes = useMediaSizes()
  return (
    <Show when={!mediaSizes.isLessThanFloatingLeftSidebar}>
      <ChatTipsDeck />
    </Show>
  )
}

function ChatTipsDeck() {
  // Расхождение 4
  const [peerId, setPeerId] = createSignal(appImManager.chat?.peerId)
  subscribeOn(appImManager)('peer_changed', (chat) => setPeerId(chat.peerId))

  const [appSettings, setAppSettings] = useAppSettings()

  // The selected tip and the collapsed state are persisted, so reopening the empty column — or the
  // app — comes back to the tip you left on instead of rewinding to the first.
  const index = () => Math.min(appSettings.chatTips?.index ?? 0, TIPS.length - 1)
  const hidden = () => !!appSettings.chatTips?.hidden

  // Each card renders its title under this id; the slot is named by it.
  const titleIds = TIPS.map(() => createUniqueId())
  const carouselId = createUniqueId()

  // Cyclic — with three tips and two labelled buttons, wrapping around beats dead ends.
  // Расхождение 3: без объявления заголовка шага.
  const step = (by: number) => {
    const next = (index() + by + TIPS.length) % TIPS.length
    void setAppSettings('chatTips', 'index', next)
  }

  // Where a card waits while it isn't the one showing: its side is its cyclic position relative to
  // the current tip — next waits on the right, previous on the left. That makes a step animate
  // correctly both ways without tracking which way we went, because the card being left behind
  // becomes "previous" and leaves to the left while the arriving one was "next" and comes in from
  // the right (mirrored when stepping back).
  const offsetOf = (i: number) =>
    (i - index() + TIPS.length) % TIPS.length === 1 ? `${SLIDE}px` : `${-SLIDE}px`

  const shown = () => !peerId()

  // The deck stays folded until the card that is up has its content, then springs in with the same
  // animation the collapse toggle plays — so the column never shows a card assembling itself.
  // One-way: stepping on to a card that is still loading keeps the deck up rather than folding it.
  const [revealed, setRevealed] = createSignal(false)
  const onTipReady = (i: number) => i === index() && setRevealed(true)
  const revealTimeout = setTimeout(() => setRevealed(true), REVEAL_TIMEOUT)
  onCleanup(() => clearTimeout(revealTimeout))

  const folded = () => hidden() || !revealed()

  // Park the cards' animations whenever they aren't on screen. `lockGroup` alone only stops new
  // playback — the stickers already running have to be paused explicitly, since the intersection
  // observer still counts them as on-screen (the deck is hidden with `visibility`, not unmounted).
  // `unlockGroup` re-checks the group on its own and picks them back up.
  createEffect(() => {
    if(shown() && !folded()) {
      animationIntersector.unlockGroup(ANIMATION_GROUP)
      // Re-observing is what makes the intersector recompute visibility: a player paused by hand
      // stays out of its `visible` set, and `unlockGroup`'s own re-check won't resume it.
      animationIntersector.refreshGroup(ANIMATION_GROUP)
    } else {
      animationIntersector.lockGroup(ANIMATION_GROUP)
      animationIntersector.checkAnimations(true, ANIMATION_GROUP)
    }
  })
  onCleanup(() => animationIntersector.unlockGroup(ANIMATION_GROUP))

  // Opening a chat hides the deck but never tears it down: a rebuild would refetch and re-wrap
  // every sticker, and closing the chat would show the cards assembling themselves again. They
  // stay mounted and ready, just not painted.
  return (
    <div class={classNames(styles.host, !shown() && styles.hostHidden)}>
      {/* Portalled to the body and fixed, the way the auth flow pins its corner buttons.
          `#column-center` carries a translateX that centres the chat beside the sidebar, so its
          box overflows the viewport on the right — anything pinned to that box's own corner
          lands off-screen. */}
      <Show when={shown()}>
        <Portal mount={document.body}>
          <Button.Icon
            class={styles.toggleButton}
            icon={hidden() ? 'lamp_filled' : 'close'}
            aria-label={I18n.format('ChatTips.Title', true)}
            aria-expanded={!hidden()}
            aria-controls={carouselId}
            onClick={() => void setAppSettings('chatTips', 'hidden', !hidden())}
          />
        </Portal>
      </Show>
      <Scrollable
        class={classNames(
          styles.scrollable,
          (!IS_TOUCH_SUPPORTED || IS_MOBILE_SAFARI) && 'no-scrollbar',
        )}
      >
        <div class={styles.placeholder} />
        <div id={carouselId} class={classNames(styles.carousel, folded() && styles.carouselHidden)}>
          {/* All three cards stay mounted and cross-fade in place, the way macOS keeps its
              widget controllers alive and only swaps which view sits in the hierarchy. That is
              what stops the content flashing: each card loads once, when the tips first
              appear, so stepping to it shows finished content instead of rebuilding it. Every
              card is the same fixed size, so they can simply stack.
              It also rules out a whole class of bug — nothing mounts or unmounts on a step, so
              a transition that never finishes (a page that isn't compositing never fires
              `transitionend`) can't leave a dead card on top swallowing clicks. */}
          <div class={styles.stage}>
            <For each={TIPS}>{(Tip, i) => (
              // A waiting card is only faded, so `inert` is what takes it out of the tab order
              // and the accessibility tree.
              <div
                class={classNames(styles.slot, i() === index() && styles.slotActive)}
                style={{ '--tip-slide': offsetOf(i()) }}
                role="group"
                aria-labelledby={titleIds[i()]}
                inert={i() !== index()}
              >
                <TipSlotProvider value={{ ready: () => onTipReady(i()), titleId: titleIds[i()] }}>
                  <Dynamic component={Tip} />
                </TipSlotProvider>
              </div>
            )}</For>
          </div>
          <div class={styles.nav}>
            <Button
              class={styles.navButton}
              icon="arrow_prev"
              onClick={() => step(-1)}
            >
              {i18n('ChatTips.PreviousTip')}
            </Button>
            <Button
              class={styles.navButton}
              iconAfter="arrow_next"
              onClick={() => step(1)}
            >
              {i18n('ChatTips.NextTip')}
            </Button>
          </div>
        </div>
        <div class={styles.placeholder} />
      </Scrollable>
      {/* Always mounted, centred under the deck, and cross-faded against it — that's how macOS
          handles the same label, and it means toggling animates rather than swapping one
          centred block for another. */}
      <div
        class={classNames(styles.selectChat, hidden() && styles.selectChatShown)}
        aria-hidden={!hidden()}
      >
        <span class={styles.selectChatPill}>{i18n('EmptyPeer.Description')}</span>
      </div>
    </div>
  )
}

/**
 * Marks the mount so a later call can find and clear it. Deliberately a plain class: the
 * CSS-module one is rehashed every time the stylesheet changes.
 */
const MOUNT_CLASS = 'chat-tips-mount'

type MountElement = HTMLElement & { disposeChatTips?: () => void }

/**
 * Mounts the tips right above the chat stack: `anchor` is `appImManager.chatsContainer`, so the
 * cards paint over the empty chat but stay under the call / audio plates appended after it.
 */
export function renderChatTips(anchor: HTMLElement) {
  // Clear any earlier mount by looking at the DOM rather than at module state.
  document.querySelectorAll<MountElement>('.' + MOUNT_CLASS).forEach((el) => {
    el.disposeChatTips?.()
    el.remove()
  })

  const container: MountElement = document.createElement('div')
  container.classList.add(MOUNT_CLASS, styles.mount)
  anchor.after(container)

  container.disposeChatTips = render(() => <ChatTips />, container)
}
