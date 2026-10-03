/** @jsxImportSource solid-js */
// Порт tweb `src/components/stories/list.tsx` (812502980, 474 строки) — ряд историй над
// списком чатов. Монтирует владелец списка (`lib/appDialogsManager.ts`, tweb
// `appDialogsManager.ts:1095-1116`) в `.stories-list` между шапкой колонки и
// `.sidebar-content`. Ряд высотой в ноль (`_storiesList.scss`) и лежит поверх списка;
// место под него освобождает `.connection-status-bottom`, читая `--stories-scrolled`,
// которую пишет `calculateMovement` контейнера. Сворачивание — `useCollapsable`
// (двоичный прогресс, свёрнутые аватарки улетают к правому краю поля поиска).
//
// Расхождения с оригиналом:
//  1. Источник данных — зеркало ленты `stores/storiesStore.ts` (мост чтения
//     `subscribeExternal`), а не `StoriesProvider` (`stories/store.tsx`, 1142): у нас
//     лента приезжает витриной `/stories` целиком, порядок (свои первыми) и заморозку
//     сортировки (`toggleSorting`) держит тот же стор — шапка `storiesStore.ts`.
//     Пиры сведены к форме `PeerStories` tweb (`peerId`, `stories`, `maxReadId`)
//     через `reconcile` по `peerId` — как `addPeers` оригинала (`store.tsx:666`).
//  2. Аватарка — срез `AvatarNew({withStories, isStoryFolded})` (`avatarNew.tsx:208-221`,
//     `:291-410`, `:1020-1135`) прямо здесь: наш `components/avatar.ts` историй не
//     умеет (его шапка). Внешний узел `.avatar.has-stories` с отступом
//     `calculateSegmentsDimensions`, кольцо — канвас `DashedCircle` + простое
//     `.avatar-stories-simple`, `.avatar-background`, внутренняя аватарка — наш
//     `avatarNew` размера `willBeSize`. Клик — только на `.ListItem` (у tweb ещё и на
//     аватарке: тот же `onItemClick` второй раз, без эффекта).
//  3. Вьювер — `createStoriesViewer` (`./viewer.ts`, ВРЕМЕННО до волны 4) по `peerId`;
//     `actions.resetIndexes()`/`actions.set({peer})` нет — начальную историю выбирает
//     React-вьювер сам (`initialStoryIndex`).
//  4. Контекстное меню — только «Отправить сообщение» (`SendMessage`, :384-393).
//     «Опубликованные/архив историй» (`AppMyStoriesTab`, О-82), «Открыть канал»
//     (историй каналов у ленты нет), уведомления об историях, stealth-режим и
//     скрытие историй пира (`toggleStoriesMute`, `showStoriesStealthModePopup`,
//     `toggleStoriesHidden`) — бэклог Б-60 плана каркаса; режим `archive` ряда
//     (вкладка архива историй) — вместе со скрытием.
//  5. `wrapPeerTitle` подписи aria — синхронно из зеркала карточек (`peerTitle`).
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, splitProps, type Accessor, type JSX } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import Scrollable from '@components/scrollable2.solid'
import { createStoriesViewer } from '@components/stories/viewer'
import styles from '@components/stories/list.module.scss'
import mediaSizes from '@core/dom/mediaSizes'
import rootScope from '@lib/rootScope'
import { fastSmoothScrollToStart } from '@helpers/fastSmoothScroll'
import cancelEvent from '@helpers/dom/cancelEvent'
import { avatarNew } from '@components/avatar'
import PeerTitle from '@components/chat/peerTitle'
import I18n, { i18n } from '@lib/langPack'
import createContextMenu from '@helpers/dom/createContextMenu'
import findUpClassName from '@helpers/dom/findUpClassName'
import appImManager from '@lib/appImManager'
import { ChatType } from '@components/chat/chatType'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { useCollapsable } from '@helpers/solid/useCollapsable'
import { getMiddleware } from '@helpers/middleware'
import ListenerSetter from '@helpers/listenerSetter'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'
import DashedCircle, { type DashedCircleSection } from '@helpers/canvas/dashedCircle'
import customProperties from '@helpers/dom/customProperties'
import { peerTitle } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'
import { getProxiedManagers } from '@/client/bootstrap'
import type { StoryItem } from '@core/stories/story'
import { getStoriesSegments, useStoriesStore, type StoriesSegments } from '@stores/storiesStore'

const TEST_COUNT = 0
const ITEM_MARGIN = 0
const ITEM_WIDTH = 74 + ITEM_MARGIN * 2
const ITEM_AVATAR_SIZE = 54
const STACKED_LENGTH = 3
const SMALL_SIDEBAR_WIDTH = 348

/** tweb `StoriesContextPeerState` (`store.tsx:24-31`) в нужном ряду объёме. */
type PeerStories = { peerId: PeerId, stories: StoryItem[], maxReadId: number }

/** tweb `calculateSegmentsDimensions` (`avatarNew.tsx:208-221`). */
const calculateSegmentsDimensions = (s: number) => {
  const willBeSize = Math.round(s * (1 - 6 / 54))
  const totalSvgSize = s * (1 + 2 / 54)
  const multiplier = s / 54
  const strokeWidth = 2 * multiplier
  return { size: s, willBeSize, totalSvgSize, multiplier, strokeWidth }
}

/** tweb `createUnreadGradient`/`createCloseGradient` (`avatarNew.tsx:157-179`). */
const createUnreadGradient = (context: CanvasRenderingContext2D, size: number, dpr: number) => {
  const gradient = context.createLinearGradient(size * 0.9156 * dpr, size * -0.05695821429 * dpr, size * 0.1342364286 * dpr, size * 1.02370714286 * dpr)
  gradient.addColorStop(0, customProperties.getProperty('--avatar-color-story-unread-from'))
  gradient.addColorStop(1, customProperties.getProperty('--avatar-color-story-unread-to'))
  return gradient
}

const createCloseGradient = (context: CanvasRenderingContext2D, size: number, dpr: number) => {
  const gradient = context.createLinearGradient(size * 0.5 * dpr, 0, size * 0.5 * dpr, size * 1 * dpr)
  gradient.addColorStop(0, customProperties.getProperty('--avatar-color-story-close-from'))
  gradient.addColorStop(1, customProperties.getProperty('--avatar-color-story-close-to'))
  return gradient
}

/** Срез `StoriesSegments` с `isStoryFolded` (`avatarNew.tsx:291-410`) — расхождение 2. */
function StoriesSegmentsCircle(props: { segments: Accessor<StoriesSegments | undefined> }) {
  const dimensions = calculateSegmentsDimensions(ITEM_AVATAR_SIZE)
  const status = createMemo(() => {
    const segments = props.segments() ?? []
    const segment = segments.find((segment) => segment.type === 'close') ||
      segments.find((segment) => segment.type === 'unread') ||
      segments[0]
    return segment?.type ?? 'read'
  })

  const segmentToSection = (segment: StoriesSegments[0], unreadAsClose?: boolean): DashedCircleSection => {
    if(segment.type === 'read') {
      return {
        color: customProperties.getProperty('--avatar-color-story-read'),
        length: segment.length,
        lineWidth: dimensions.strokeWidth / 2,
      }
    }

    if(segment.type === 'close' || unreadAsClose) {
      return { color: closeGradient ??= createCloseGradient(context, canvas.width, dpr), length: segment.length, lineWidth: dimensions.strokeWidth }
    }

    return { color: unreadGradient ??= createUnreadGradient(context, canvas.width, dpr), length: segment.length, lineWidth: dimensions.strokeWidth }
  }

  const dashedCircle = new DashedCircle()
  const { canvas, context, dpr } = dashedCircle
  dashedCircle.prepare({
    radius: dimensions.size / 2,
    gap: 4 * dimensions.multiplier,
    width: dimensions.totalSvgSize,
    height: dimensions.totalSvgSize,
  })

  let unreadGradient: CanvasGradient | undefined, closeGradient: CanvasGradient | undefined
  canvas.style.setProperty('--offset', `${(dimensions.totalSvgSize - dimensions.size) / -2}px`)
  canvas.classList.add('avatar-stories-svg')

  const render = () => {
    const segments = props.segments() ?? []
    const firstCloseSegment = segments.find((segment) => segment.type === 'close')
    let sections = segments.map((segment) => segmentToSection(segment, !!firstCloseSegment))
    const totalLength = sections.reduce((sum, section) => sum + section.length, 0)
    if(totalLength > 30) {
      sections = sections.map((section) => ({
        ...section,
        length: Math.floor(section.length / totalLength * 30),
      })).filter((section) => section.length > 0)
    }

    dashedCircle.render(sections)
  }

  // tweb `useIsNightTheme()` + `storiesSegments` (:394-401): градиенты читают тему
  const [themeVersion, setThemeVersion] = createSignal(0)
  subscribeOn(rootScope)('theme_changed', () => setThemeVersion((v) => v + 1))
  createEffect(on([themeVersion, props.segments], () => {
    unreadGradient = closeGradient = undefined
    render()
  }))

  return (
    <>
      {canvas}
      <div class="avatar-stories-simple" classList={{ ['is-' + status()]: true }} />
    </>
  )
}

function _StoriesList(props: {
  foldInto: HTMLElement,
  setScrolledOn: HTMLElement,
  getScrollable: () => HTMLElement,
  listenWheelOn: HTMLElement,
  offsetX?: number,
  resizeCallback?: (callback: () => void) => void,
  onExpand?: () => void
}) {
  // Расхождение 1: мост чтения зеркала ленты.
  const feed = subscribeExternal(useStoriesStore.subscribe, useStoriesStore.getState)
  const [stories, setStories] = createStore<{ peers: PeerStories[] }>({ peers: [] })
  createEffect(() => {
    setStories('peers', reconcile(feed().groups.map((group) => ({
      peerId: group.author.id,
      stories: group.stories,
      maxReadId: group.maxReadId,
    })), { key: 'peerId', merge: true }))
  })
  const ready = () => feed().loaded

  const [viewerPeer, setViewerPeer] = createSignal<PeerStories>()
  const [containerRect, setContainerRect] = createSignal<DOMRect>()
  const [hasTransition, setHasTransition] = createSignal(true) // to make it smooth when resizing the left sidebar

  const maxStackedItems = createMemo(() =>
    (containerRect()?.width ?? 0) > SMALL_SIDEBAR_WIDTH ? STACKED_LENGTH : 1,
  )

  const peers = createMemo(() => {
    const peers = stories.peers
    if(TEST_COUNT) {
      return peers.slice(0, TEST_COUNT)
    }
    return peers
  })

  let toRect: DOMRect, fromRect: DOMRect
  const myIndex = createMemo(() => peers().findIndex((peer) => peer.peerId === rootScope.myId))
  const spaceEvenly = createMemo(() => {
    const rect = containerRect()
    if(rect && rect.width > (peers().length * ITEM_WIDTH)) {
      return (rect.width - (peers().length * ITEM_WIDTH)) / (peers().length + 1)
    }

    return 0
  })
  const items = new Map<PeerId, HTMLDivElement>()
  const itemsTarget = new WeakMap<HTMLDivElement, PeerStories>()

  const onContainerClick = (e: MouseEvent) => {
    unfold(e)
    props.onExpand?.()
  }

  createEffect(() => {
    const peer = viewerPeer()
    if(!peer) {
      return
    }

    const onExit = () => {
      setViewerPeer(undefined)
    }

    // tweb :80-83 — аватарка того пира, на котором стоит вьювер (расхождение 3)
    const dispose = createStoriesViewer({
      peerId: peer.peerId,
      target: (peerId) => items.get(peerId)?.querySelector('.avatar'),
      onExit,
    })
    onCleanup(dispose)
  })

  const onItemClick = (peer: PeerStories, e?: MouseEvent) => {
    if(progress() !== STATE_UNFOLDED && e) {
      return onContainerClick(e)
    }

    setViewerPeer(peer)
  }

  const foldedLength = createMemo(() => Math.min(maxStackedItems(), peers().length - (myIndex() !== -1 ? 1 : 0)))
  const indexes = createMemo(() => {
    return {
      min: myIndex() === 0 && peers().length > 1 ? 1 : 0,
      max: myIndex() === 0 ? foldedLength() : foldedLength() - 1,
    }
  })

  const isItemOut = (index: number, _indexes: ReturnType<typeof indexes> = indexes()) => {
    const { min: minIndex, max: maxIndex } = _indexes
    return index < minIndex || index > maxIndex
  }

  const Item = (peer: PeerStories, idx: Accessor<number>) => {
    const onClick = onItemClick.bind(null, peer)

    const calculateMovement = createMemo(() => {
      const rect = containerRect()
      if(!rect) {
        return
      }

      const value = progress()
      const index = idx()
      const marginEvenly = spaceEvenly()
      const containerPadding = marginEvenly ? 0 : CONTAINER_PADDING

      const _indexes = indexes()
      const isOut = isItemOut(index, _indexes)
      const fromLeft = fromRect.left + containerPadding
      const left = fromLeft + index * ITEM_WIDTH + marginEvenly * (index + 1)
      const realLeft = rect.left + containerPadding + index * ITEM_WIDTH + marginEvenly * (index + 1)
      if(realLeft > rect.right) {
        return
      }

      const cssProperties: JSX.CSSProperties = {}
      if(isOut) {
        cssProperties['z-index'] = 100 - index
      } else {
        cssProperties['z-index'] = 100 + foldedLength() + 1 - index
      }

      const desiredX = toRect.right + (props.offsetX || 0)
      const indexOffsetX = isOut ? 0 : (_indexes.max - index) * 16
      let distanceX = desiredX - left + 5 - indexOffsetX

      let _scale: number
      if(isOut) {
        cssProperties['transform-origin'] = 'center 43.75%'
        distanceX += 8 * (index < _indexes.min ? 1 : -1)
        _scale = 0.2
      } else {
        _scale = 26.67 / 48
      }

      const translateX = distanceX * value
      const translate = `translateX(calc(var(--stories-additional-offset, 0px) * ${value} + ${translateX * (I18n.getIsRTL() ? -1 : 1)}px))`
      const scaleValue = 1 - (value * (1 - _scale))
      const scale = `scale(${scaleValue})`
      cssProperties.transform = `${translate} ${scale}`
      return {
        isOut,
        isLastIn: !isOut && index === _indexes.max,
        cssProperties,
      }
    })

    // Расхождение 2: срез `AvatarNew({withStories, isStoryFolded})`.
    const managers = getProxiedManagers()
    const middlewareHelper = getMiddleware()
    onCleanup(() => middlewareHelper.destroy())
    const dimensions = calculateSegmentsDimensions(ITEM_AVATAR_SIZE)
    const segments = createMemo(() => getStoriesSegments(peer))
    const avatar = (
      <div
        class={`avatar avatar-like avatar-${ITEM_AVATAR_SIZE} avatar-gradient`}
        classList={{ 'has-stories': !!segments() }}
        data-peer-id={peer.peerId}
        style={{ padding: (dimensions.size - dimensions.willBeSize) / 2 + 'px' }}
      >
        <div>
          <StoriesSegmentsCircle segments={segments} />
          <div class="avatar-background" />
          {avatarNew({
            peerId: peer.peerId,
            size: dimensions.willBeSize,
            middleware: middlewareHelper.get(),
            managers,
          }).node}
        </div>
      </div>
    )

    const isMyStory = peer.peerId === rootScope.myId

    const [ariaLabel, setAriaLabel] = createSignal(I18n.format('OpenStory', true))
    if(isMyStory) {
      setAriaLabel(`${I18n.format('OpenStory', true)}, ${I18n.format('MyStory', true)}`)
    } else {
      setAriaLabel(`${I18n.format('OpenStory', true)}, ${peerTitle(peer.peerId, { onlyFirstName: true })}`)
    }

    const ret = (
      <div
        ref={(el) => (items.set(peer.peerId, el), itemsTarget.set(el, peer))}
        class={styles.ListItem}
        classList={{
          [styles.isRead]: !isMyStory && !!peer.maxReadId && peer.maxReadId >= (peer.stories[peer.stories.length - 1]?.id ?? 0),
          [styles.isMasked]: (() => {
            const movement = calculateMovement()
            return !!movement && !movement.isOut && !movement.isLastIn
          })(),
        }}
        role="button"
        tabindex={0}
        aria-label={ariaLabel()}
        onKeyDown={buttonKeyDown}
        onClick={onClick}
        style={{
          ...calculateMovement()?.cssProperties,
          transition: hasTransition() ? undefined : 'none',
        }}
      >
        {avatar}
        <div class={styles.ListItemName}>
          {isMyStory ? i18n('MyStory') : new PeerTitle({ peerId: peer.peerId, onlyFirstName: true, middleware: middlewareHelper.get(), managers }).element}
        </div>
      </div>
    )

    onCleanup(() => {
      if(items.get(peer.peerId) === ret) items.delete(peer.peerId)
    })

    return (
      <Show when={/* isTransition() ||  */calculateMovement() || !folded()}>
        {ret}
      </Show>
    )
  }

  const MOVE_Y = -69, CONTAINER_PADDING = 6, CONTAINER_HEIGHT = 92
  let scrolling = false
  const calculateMovement = (): JSX.CSSProperties => {
    const value = progress()

    const scrollableX = !scrolling && getMenuScrollable()
    if(scrollableX && scrollableX.scrollLeft) {
      scrolling = true
      void fastSmoothScrollToStart(scrollableX, 'x').then(() => {
        scrolling = false
      })
    }

    const translateY = value * MOVE_Y
    const translate = `translateY(${translateY}px)`
    props.setScrolledOn.style.setProperty('--stories-scrolled', (value * CONTAINER_HEIGHT) + 'px')

    return {
      'transform': translate,
      '--progress': value,
    }
  }

  // * fold when stories disappear
  createEffect(
    on(
      () => peers().length,
      (length) => {
        if(!length) {
          fold()
        }
      },
      { defer: true },
    ),
  )

  const getMenuScrollable = () => container?.firstElementChild as HTMLElement | null

  // * lock horizontal scroll when folded
  createEffect(() => {
    if(folded() || isTransition()) {
      const onWheel = cancelEvent
      const scrollableX = getMenuScrollable()
      if(scrollableX) subscribeOn(scrollableX)('wheel', onWheel, { capture: true })
    }
  })

  createEffect(() => {
    if(isTransition()) {
      return
    }

    useStoriesStore.getState().toggleSorting('list', !folded())
  })
  onCleanup(() => useStoriesStore.getState().toggleSorting('list', false))

  const onResize = () => {
    toRect = props.foldInto.getBoundingClientRect()
    fromRect = props.foldInto.parentElement!.getBoundingClientRect()
    setContainerRect(props.foldInto.parentElement!.parentElement!.getBoundingClientRect())
  }
  subscribeOn(mediaSizes)('resize', onResize)
  onResize()
  props.resizeCallback?.(onResize)

  let container: HTMLDivElement | undefined

  onMount(() => {
    const listenerSetter = new ListenerSetter()
    let timeoutId: number
    listenerSetter.add(rootScope)('resizing_left_sidebar', () => {
      onResize()
      window.clearTimeout(timeoutId)
      setHasTransition(false)
      timeoutId = self.setTimeout(() => {
        setHasTransition(true)
      }, 100)
    })
    onCleanup(() => {
      listenerSetter.removeAll()
    })
  })

  const { folded, unfold, fold, isTransition, progress, STATE_UNFOLDED } = useCollapsable({
    scrollable: props.getScrollable,
    container: () => container!,
    listenWheelOn: props.listenWheelOn,
    shouldIgnore: () => !peers().length,
    disableHoverWhenFolded: true,
  })

  const r = (
    <div
      ref={(el) => container = el}
      class={styles.ListContainer}
      style={calculateMovement()}
    >
      <Scrollable axis="x">
        <div
          class={styles.List}
          classList={{
            [styles['space-evenly']]: !!spaceEvenly(),
          }}
        >
          <For each={peers()}>{Item}</For>
        </div>
      </Scrollable>
    </div>
  )

  onMount(() => {
    // Расхождение 4: из меню tweb (:363-439) — только «Отправить сообщение».
    let peer: PeerStories | undefined, isSelf = false
    const middlewareHelper = getMiddleware()
    onCleanup(() => middlewareHelper.destroy())
    createContextMenu({
      buttons: [{
        icon: 'message',
        text: 'SendMessage',
        onClick: () => {
          void appImManager.setInnerPeer({
            peerId: peer!.peerId,
            type: ChatType.Chat,
          })
        },
        verify: () => !isSelf && isUser(peer!.peerId),
      }],
      listenTo: container!,
      middleware: middlewareHelper.get(),
      findElement: (e) => {
        return (!folded() && findUpClassName(e.target as HTMLElement, styles.ListItem)) || null
      },
      onOpen: (_e, target) => {
        peer = itemsTarget.get(target as HTMLDivElement)
        isSelf = peer?.peerId === rootScope.myId
      },
      onClose: () => {
        peer = undefined
      },
    })
  })

  return (
    <>
      {ready() && r}
    </>
  )
}

export default function StoriesList(props: Parameters<typeof _StoriesList>[0]) {
  // tweb оборачивает ряд в `StoriesProvider` (расхождение 1) — провайдера нет
  const [local] = splitProps(props, ['foldInto', 'getScrollable', 'listenWheelOn', 'setScrolledOn', 'offsetX', 'resizeCallback', 'onExpand'])
  return <_StoriesList {...local} />
}
