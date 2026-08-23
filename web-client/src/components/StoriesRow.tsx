// Ряд историй — порт tweb `src/components/stories/list.tsx`.
//
// Дерево (tweb appDialogsManager.ts:606,825 + index.html):
//   .item-main > .sidebar-header + .stories-list + .sidebar-content
//   .stories-list  — height: 0, z-index: 1, pointer-events: none (_storiesList.scss)
//     .ListContainer — height: 92px, pointer-events: all, translateY(progress * -69px)
//       .scrollable.scrollable-x
//         .List > .ListItem × n
// Ряд НЕ занимает места в потоке (нулевая высота) и выпадает поверх .sidebar-content.
// Место под него освобождает `.connection-status-bottom` внутри #chatlist-container:
// `transform: translateY(calc(92px - var(--stories-scrolled)))` (_leftSidebar.scss:483-497),
// где `--stories-scrolled` пишет сюда же этот компонент (list.tsx:235).
//
// Сворачивание (useCollapsable, прогресс ДВОИЧНЫЙ 0/1 — дробная ветка в tweb
// закорочена `if(isWheel || true)`, плавность даёт CSS-переход
// `transform var(--transition-standard-in)` = .3s cubic-bezier(.4,0,.2,1)):
//   • свёрнуто (progress=1): контейнер уехал на -69px, --stories-scrolled=92px
//     (список стоит вплотную к шапке), аватарки улетели к правому краю поля
//     поиска и сжались, подписи погашены (opacity 1 - progress*1.25);
//   • развёрнуто (progress=0): контейнер на месте, --stories-scrolled=0px —
//     список уехал вниз ровно на высоту ряда (92px).
// Формулы `calculateMovement` перенесены из tweb дословно.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import classNames from '../shared/lib/classNames'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import { getUserTitle } from '../core/peers/getPeerTitle'
import useCollapsable, { STATE_UNFOLDED, type CollapsableOptions } from '../core/hooks/useCollapsable'
import { isStoryViewed } from '../core/stories/story'
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

// tweb avatarNew.tsx:191-203 `calculateSegmentsDimensions(54)`: у аватарки с
// историями внешний узел остаётся 54px и получает padding (54-48)/2 = 3px, а
// внутренняя аватарка — 48px. Кольцо (`.avatar-stories-simple`) — абсолютный
// оверлей с inset -.25rem, в раскладку не входит.
const ITEM_AVATAR_INNER_SIZE = Math.round(ITEM_AVATAR_SIZE * (1 - 6 / 54))
const ITEM_AVATAR_PADDING = (ITEM_AVATAR_SIZE - ITEM_AVATAR_INNER_SIZE) / 2

// Заливка аватарки-плейсхолдера «завести историю» — тот же градиент, что у
// непрочитанного кольца (tweb _avatar.scss `.avatar-stories-simple.is-unread`).
const STORY_UNREAD_GRADIENT =
  'linear-gradient(215.87deg, var(--avatar-color-story-unread-from) -1.61%, var(--avatar-color-story-unread-to) 97.44%)'

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

const hasUnseen = (g: StoryGroup) => g.stories.some((s) => !isStoryViewed(s))

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
      text: (getUserTitle(g.author).charAt(0) || '+').toUpperCase(),
      hasUnseen: hasUnseen(g),
      isMe: true,
      groupIndex: selfIndex,
    })
  } else {
    items.push({
      key: 'self-add',
      name: 'Моя история',
      bg: STORY_UNREAD_GRADIENT,
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
      name: getUserTitle(g.author),
      bg: gradientFor(g.author.id),
      text: (getUserTitle(g.author).charAt(0) || '?').toUpperCase(),
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

interface Movement {
  isOut: boolean
  isLastIn: boolean
  style: CSSProperties
}

/** tweb `calculateMovement` внутри Item — дословно. */
function itemMovement(
  index: number,
  value: number,
  rects: Rects,
  peersLength: number,
  myIndex: number,
  offsetX: number,
): Movement | undefined {
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
  return { isOut, isLastIn: !isOut && index === maxIndex, style }
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
  const scrollableXRef = useRef<HTMLDivElement>(null)
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

  // tweb onResize (list.tsx:277-284): три прямоугольника вокруг поля поиска.
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

  // tweb меряет синхронно (onResize() прямо в теле компонента) и переснимает на
  // mediaSizes 'resize' + rootScope 'resizing_left_sidebar'. У нас это layout-эффект
  // (до отрисовки — иначе первый кадр ряд рисуется без трансформов) плюс
  // ResizeObserver на шапке: он ловит и ресайз окна, и смену ширины колонки.
  useLayoutEffect(() => {
    measure()
    const header = foldInto()?.parentElement?.parentElement
    if (!header) return
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [measure, foldInto])

  // Геттеры узлов приходят инлайн-стрелками (Sidebar.tsx:258-262) и меняют
  // идентичность на КАЖДОМ рендере родителя, поэтому в deps эффектов ниже им
  // делать нечего: они не описывают ни одного состояния ряда. Держим их рефом.
  const setScrolledOnRef = useRef(setScrolledOn)
  setScrolledOnRef.current = setScrolledOn

  // tweb list.tsx:235 — `--stories-scrolled` пишется прямо в calculateMovement,
  // то есть в том же кадре, что и transform контейнера.
  useLayoutEffect(() => {
    setScrolledOnRef.current()?.style.setProperty('--stories-scrolled', `${progress * CONTAINER_HEIGHT}px`)
  }, [progress])

  // отступление от tweb: там ряд из дерева не исчезает, у нас — исчезает (форум).
  // Без сброса на свёрнутое значение список остался бы опущенным на 92px под
  // рядом, которого уже нет.
  //
  // Эффект обязан быть ЧИСТО размонтировочным (deps пустые). С `setScrolledOn` в
  // deps его «сброс» отрабатывал на каждом рендере Sidebar — и под развёрнутым
  // рядом отступ схлопывался: layout-эффект выше ставил 0px, а следом чистка
  // этого эффекта возвращала 92px, ряд же оставался развёрнутым.
  useEffect(() => () => {
    setScrolledOnRef.current()?.style.setProperty('--stories-scrolled', `${CONTAINER_HEIGHT}px`)
  }, [])

  // tweb list.tsx:246-256: «свернуть, когда истории пропали»
  useEffect(() => {
    if (items.length === 0) fold()
  }, [items.length, fold])

  // tweb list.tsx:222-231: свёрнутый ряд возвращает горизонтальную прокрутку к началу.
  useEffect(() => {
    const el = scrollableXRef.current
    if (el?.scrollLeft) el.scrollTo({ left: 0, behavior: 'smooth' })
  }, [progress])

  // tweb list.tsx:260-267 — «* lock horizontal scroll when folded».
  useEffect(() => {
    if (!folded && !isTransition) return
    const el = scrollableXRef.current
    if (!el) return
    const cancel = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation() }
    el.addEventListener('wheel', cancel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', cancel, { capture: true })
  }, [folded, isTransition])

  const myIndex = items.findIndex((it) => it.isMe)
  const spaceEvenly = rects != null && rects.container.width > items.length * ITEM_WIDTH

  const containerStyle: CSSProperties = {
    transform: `translateY(${progress * MOVE_Y}px)`,
    ['--progress' as string]: String(progress),
  }

  return (
    <div
      ref={containerRef}
      // tweb useCollapsable.ts:194 вешает на контейнер ГЛОБАЛЬНЫЙ `disable-hover`
      // (_global.scss: pointer-events: none !important) — свёрнутый ряд лежит
      // поверх шапки и верха списка и не должен перехватывать клики.
      className={classNames(s.container, folded || isTransition ? 'disable-hover' : '')}
      style={containerStyle}
    >
      <div ref={scrollableXRef} className="scrollable scrollable-x">
        <div className={classNames(s.list, spaceEvenly ? s.spaceEvenly : '')}>
          {items.map((item, index) => {
            const movement = rects ? itemMovement(index, progress, rects, items.length, myIndex, offsetX) : undefined
            // tweb <Show when={calculateMovement() || !folded()}> — элемент,
            // который в свёрнутом виде уехал бы за правый край, просто не рисуем.
            if (!movement && folded) return null

            const isAdd = item.isMe && item.groupIndex === null
            const seen = !item.hasUnseen
            // tweb onItemClick (list.tsx:98-106)
            const onClick = (e: MouseEvent) => {
              if (progress !== STATE_UNFOLDED) {
                unfold(e)
                onExpand?.()
                return
              }
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
                className={classNames(
                  s.item,
                  seen && !isAdd ? s.isRead : '',
                  movement && !movement.isOut && !movement.isLastIn ? s.isMasked : '',
                )}
                style={movement?.style}
                onClick={onClick}
              >
                {/* tweb avatarNew.tsx:1054-1064: внешний .avatar.has-stories (54px,
                    padding 3px) → кольцо .avatar-stories-simple + подложка
                    .avatar-background + внутренняя .avatar 48px. */}
                <div
                  className={classNames('avatar', 'avatar-like', `avatar-${ITEM_AVATAR_SIZE}`, 'has-stories')}
                  style={{ padding: `${ITEM_AVATAR_PADDING}px` }}
                >
                  <div>
                    <div className={classNames('avatar-stories-simple', seen && !isAdd ? 'is-read' : 'is-unread')} />
                    <div className="avatar-background" />
                    <Avatar
                      background={item.bg}
                      text={item.text}
                      emoji={isAdd ? '➕' : undefined}
                      size={ITEM_AVATAR_INNER_SIZE}
                    />
                    {/* «+» на своей аватарке — завести историю */}
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
