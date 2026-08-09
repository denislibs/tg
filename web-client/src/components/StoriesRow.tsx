// Ряд историй — порт tweb `src/components/stories/list.tsx`.
//
// Дерево (живой DOM §2): `.stories-list > .ListContainer > .scrollable.scrollable-x > .List > .ListItem`.
// `.stories-list` высотой 0 (styles/tweb/_storiesList.scss) — место под ряд
// освобождает `.connection-status-bottom`, сдвигаясь на `92px - --stories-scrolled`.
//
// Сворачивание (useCollapsable, прогресс 0..1, на практике 0/1):
//   • контейнер едет вверх на `progress * MOVE_Y`;
//   • на `setScrolledOn` (#chatlist-container) пишется
//     `--stories-scrolled: progress * CONTAINER_HEIGHT` — это опускает/поднимает список;
//   • аватары летят в правый край поля поиска (`foldInto`) и уменьшаются:
//     те, что попадают в стек — до 26.67/48, остальные — до 0.2.
// Формулы `calculateMovement` перенесены из tweb дословно.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import classNames from '../shared/lib/classNames'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import useCollapsable, { STATE_UNFOLDED, type CollapsableOptions } from '../core/hooks/useCollapsable'
import type { StoryGroup } from '../core/managers/storiesManager'
import s from './StoriesRow.module.scss'

// tweb list.tsx: ITEM_WIDTH = 74 + ITEM_MARGIN * 2, ITEM_AVATAR_SIZE = 54,
// STACKED_LENGTH = 3, SMALL_SIDEBAR_WIDTH = 348, MOVE_Y = -69,
// CONTAINER_PADDING = 6, CONTAINER_HEIGHT = 92.
const ITEM_WIDTH = 74
const ITEM_AVATAR_SIZE = 54
const STACKED_LENGTH = 3
const SMALL_SIDEBAR_WIDTH = 348
const MOVE_Y = -69
const CONTAINER_PADDING = 6
const CONTAINER_HEIGHT = 92

const UNSEEN_RING = 'linear-gradient(215deg, #34c76f -1.61%, #3da1fd 97.44%)'

/** A row entry derived from the real stories feed. */
export interface StoryItem {
  /** stable key */
  key: string
  name: string
  bg: string
  text: string
  hasUnseen: boolean
  /** the current user's own story group */
  isMe: boolean
  /** index into the real `groups` array, or null for the "+" add affordance */
  groupIndex: number | null
}

const hasUnseen = (g: StoryGroup) => g.stories.some((s) => !s.viewed)

/**
 * Derive the avatar items from the real stories feed. The first item is always
 * "My Story" (self): the self group when one exists, otherwise a "+" add
 * affordance. Remaining groups follow in feed order. `groupIndex` indexes the
 * real `groups` array (what `onOpen` receives); it is null for the add item.
 */
export function buildStoryItems(groups: StoryGroup[], meId: number | null): StoryItem[] {
  const items: StoryItem[] = []
  const selfIndex = meId == null ? -1 : groups.findIndex((g) => g.author.id === meId)

  if (selfIndex >= 0) {
    const g = groups[selfIndex]
    items.push({
      key: `self-${g.author.id}`,
      name: 'Моя история',
      bg: gradientFor(g.author.id),
      text: (g.author.displayName.charAt(0) || '+').toUpperCase(),
      hasUnseen: hasUnseen(g),
      isMe: true,
      groupIndex: selfIndex,
    })
  } else {
    items.push({
      key: 'self-add',
      name: 'Моя история',
      bg: UNSEEN_RING,
      text: '',
      hasUnseen: false,
      isMe: true,
      groupIndex: null,
    })
  }

  groups.forEach((g, i) => {
    if (i === selfIndex) return
    items.push({
      key: `g-${g.author.id}`,
      name: g.author.displayName,
      bg: gradientFor(g.author.id),
      text: (g.author.displayName.charAt(0) || '?').toUpperCase(),
      hasUnseen: hasUnseen(g),
      isMe: false,
      groupIndex: i,
    })
  })

  return items
}

interface Rects {
  /** foldInto (input) — куда летят аватары */
  to: DOMRect
  /** foldInto.parentElement (.input-search) — от чьего левого края tweb считает путь */
  from: DOMRect
  /** foldInto.parentElement.parentElement (.sidebar-header) — ширина колонки */
  container: DOMRect
}

/** tweb `calculateMovement` внутри Item — дословно. */
function itemMovement(
  index: number,
  value: number,
  rects: Rects,
  peersLength: number,
  myIndex: number,
  offsetX: number,
): { isOut: boolean; style: CSSProperties } | undefined {
  const { to: toRect, from: fromRect, container: rect } = rects

  const marginEvenly = rect.width > peersLength * ITEM_WIDTH
    ? (rect.width - peersLength * ITEM_WIDTH) / (peersLength + 1)
    : 0
  const containerPadding = marginEvenly ? 0 : CONTAINER_PADDING

  const maxStackedItems = rect.width > SMALL_SIDEBAR_WIDTH ? STACKED_LENGTH : 1
  const foldedLength = Math.min(maxStackedItems, peersLength - (myIndex !== -1 ? 1 : 0))
  const minIndex = myIndex === 0 && peersLength > 1 ? 1 : 0
  const maxIndex = myIndex === 0 ? foldedLength : foldedLength - 1

  const isOut = index < minIndex || index > maxIndex
  const fromLeft = fromRect.left + containerPadding
  const left = fromLeft + index * ITEM_WIDTH + marginEvenly * (index + 1)
  const realLeft = rect.left + containerPadding + index * ITEM_WIDTH + marginEvenly * (index + 1)
  if (realLeft > rect.right) {
    return undefined
  }

  const style: CSSProperties = {}
  style.zIndex = isOut ? 100 - index : 100 + foldedLength + 1 - index

  const desiredX = toRect.right + offsetX
  const indexOffsetX = isOut ? 0 : (maxIndex - index) * 16
  let distanceX = desiredX - left + 5 - indexOffsetX

  let scale: number
  if (isOut) {
    style.transformOrigin = 'center 43.75%'
    distanceX += 8 * (index < minIndex ? 1 : -1)
    scale = 0.2
  } else {
    scale = 26.67 / 48
  }

  const translateX = distanceX * value
  const scaleValue = 1 - (value * (1 - scale))
  style.transform = `translateX(calc(var(--stories-additional-offset, 0px) * ${value} + ${translateX}px)) scale(${scaleValue})`
  return { isOut, style }
}

/**
 * Аватарка автора в ряду — источник морфа открытия вьюера.
 * tweb list.tsx:80-83: `target` — мемо `items.get(stories.peer)?.querySelector('.avatar')`,
 * то есть аватарка ТЕКУЩЕГО автора, перечитываемая и на закрытии.
 */
export type StoryTargetGetter = (groupIndex: number) => Element | null

export interface StoriesRowProps {
  onOpen: (index: number, getTarget: StoryTargetGetter) => void
  onAddStory?: () => void
  /** поле поиска — цель, в которую сворачивается ряд (tweb foldInto) */
  foldInto: () => HTMLElement | null
  /** узел, на который пишется --stories-scrolled (tweb setScrolledOn = #chatlist-container) */
  setScrolledOn: () => HTMLElement | null
  /** прокручиваемый список под рядом */
  getScrollable: CollapsableOptions['scrollable']
  /** узел-приёмник колеса (tweb listenWheelOn = .connection-status-bottom) */
  listenWheelOn: CollapsableOptions['listenWheelOn']
  /** tweb передаёт -1 */
  offsetX?: number
  /** развернули ряд кликом — tweb дополнительно прокручивает список к началу */
  onExpand?: () => void
}

export default function StoriesRow({
  onOpen, onAddStory, foldInto, setScrolledOn, getScrollable, listenWheelOn, offsetX = -1, onExpand,
}: StoriesRowProps) {
  const groups = useStoriesStore((st) => st.groups)
  const meId = useChatsStore((st) => st.meId)
  const items = useMemo(() => buildStoryItems(groups, meId), [groups, meId])

  const containerRef = useRef<HTMLDivElement>(null)
  const [rects, setRects] = useState<Rects | null>(null)

  // Узлы элементов ряда по groupIndex — из них морф вьюера берёт аватарку-источник
  // (tweb list.tsx:72 `items = new WeakMap<PeerStories, HTMLDivElement>()`).
  const itemNodes = useRef(new Map<number, HTMLDivElement>())
  const getTarget = useCallback<StoryTargetGetter>(
    (groupIndex) => itemNodes.current.get(groupIndex)?.querySelector('.avatar') ?? null,
    [],
  )

  const { progress, folded, isTransition, unfold, fold } = useCollapsable({
    scrollable: getScrollable,
    listenWheelOn,
    container: () => containerRef.current,
    shouldIgnore: () => items.length === 0,
  })

  // tweb onResize: три прямоугольника вокруг поля поиска.
  const measure = useCallback(() => {
    const input = foldInto()
    const from = input?.parentElement
    const container = from?.parentElement
    if (!input || !from || !container) return
    setRects({
      to: input.getBoundingClientRect(),
      from: from.getBoundingClientRect(),
      container: container.getBoundingClientRect(),
    })
  }, [foldInto])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  // tweb: `props.setScrolledOn.style.setProperty('--stories-scrolled', value * CONTAINER_HEIGHT + 'px')`
  // — прямо в calculateMovement, то есть на каждый пересчёт прогресса.
  useEffect(() => {
    setScrolledOn()?.style.setProperty('--stories-scrolled', `${progress * CONTAINER_HEIGHT}px`)
  }, [progress, setScrolledOn])

  // tweb: «свернуть, когда истории пропали»
  useEffect(() => {
    if (items.length === 0) fold()
  }, [items.length, fold])

  const myIndex = items.findIndex((it) => it.isMe)
  const spaceEvenly = rects != null && rects.container.width > items.length * ITEM_WIDTH

  const containerStyle: CSSProperties = {
    transform: `translateY(${progress * MOVE_Y}px)`,
    ['--progress' as string]: String(progress),
  }

  return (
    <div
      ref={containerRef}
      className={classNames(s.container, folded || isTransition ? s.disableHover : '')}
      style={containerStyle}
      onClick={(e) => {
        if (progress === STATE_UNFOLDED) return
        unfold(e)
        onExpand?.()
      }}
    >
      <div className="scrollable scrollable-x">
        <div className={classNames(s.list, spaceEvenly ? s.spaceEvenly : '')}>
          {items.map((item, index) => {
            const movement = rects ? itemMovement(index, progress, rects, items.length, myIndex, offsetX) : undefined
            // tweb <Show when={calculateMovement() || !folded()}> — элемент,
            // который в свёрнутом виде уехал бы за правый край, просто не рисуем.
            if (!movement && folded) return null

            const isAdd = item.isMe && item.groupIndex === null
            const seen = !item.hasUnseen
            const ringBg = isAdd ? 'transparent' : seen ? 'var(--secondary-text-color)' : UNSEEN_RING
            const onClick = () => {
              // tweb onItemClick: в свёрнутом виде клик по элементу = клик по контейнеру.
              if (progress !== STATE_UNFOLDED) return
              if (isAdd) onAddStory?.()
              else if (item.groupIndex !== null) onOpen(item.groupIndex, getTarget)
            }
            return (
              <div
                key={item.key}
                ref={(node) => {
                  const gi = item.groupIndex
                  if (gi === null) return
                  if (node) itemNodes.current.set(gi, node)
                  else itemNodes.current.delete(gi)
                }}
                className={classNames(s.item, seen && !isAdd ? s.isRead : '')}
                style={movement?.style}
                onClick={onClick}
              >
                <div className={s.ring} style={{ background: ringBg, opacity: seen && !isAdd ? 0.45 : 1 }}>
                  <div className={s.ringInner}>
                    <Avatar background={item.bg} text={item.text} emoji={isAdd ? '➕' : undefined} size={ITEM_AVATAR_SIZE} />
                  </div>
                  {/* "+" add badge on the self avatar (always available to post a story) */}
                  {item.isMe && !isAdd && onAddStory && (
                    <div
                      className={s.addBadge}
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddStory()
                      }}
                      aria-label="Добавить историю"
                    >
                      <TgIcon name="add" size={13} />
                    </div>
                  )}
                </div>
                <div className={s.name}>{item.name}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
