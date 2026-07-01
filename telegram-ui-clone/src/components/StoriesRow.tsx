import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import type { StoryGroup } from '../core/managers/storiesManager'
import s from './StoriesRow.module.scss'

export const FULL_H = 92

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

/**
 * The full stories row. `progress` (0..1) collapses it as the chat list scrolls;
 * at 1 it's fully folded away (height 0) — the compact stack lives in the search
 * bar (see StoriesStack), matching tweb's foldInto: the search input.
 *
 * The avatar/ring markup + collapse behaviour mirror tweb; only the data source
 * is real now (the stories feed). `onAddStory` opens the add-story flow.
 */
export default function StoriesRow({
  onOpen,
  onAddStory,
  animated = false,
}: {
  onOpen: (index: number) => void
  onAddStory?: () => void
  // when true, the collapse transitions (desktop reveal); when false it tracks the
  // scroll position 1:1 (mobile fold). The progress itself is the --stories-fold
  // CSS var (set imperatively by the Sidebar scroll handler — no re-render).
  animated?: boolean
}) {
  const groups = useStoriesStore((s) => s.groups)
  const meId = useChatsStore((s) => s.meId)
  const items = buildStoryItems(groups, meId)

  // height driven by FULL_H (exported const) + transition toggled by `animated` — runtime
  const rowStyle: CSSProperties = {
    '--stories-full-h': `${FULL_H}px`,
    transition: animated
      ? 'height .26s cubic-bezier(.4,0,.2,1), opacity .26s ease, transform .26s cubic-bezier(.4,0,.2,1)'
      : 'none',
  } as CSSProperties

  return (
    <div className={s.row} style={rowStyle}>
      {items.map((item) => {
        const isAdd = item.isMe && item.groupIndex === null
        const seen = !item.hasUnseen
        const ringBg = isAdd ? 'transparent' : seen ? 'var(--tg-textFaint)' : UNSEEN_RING
        const onClick = () => {
          if (isAdd) onAddStory?.()
          else if (item.groupIndex !== null) onOpen(item.groupIndex)
        }
        return (
          <div key={item.key} onClick={onClick} className={s.item}>
            <div className={s.ring} style={{ background: ringBg, opacity: seen && !isAdd ? 0.45 : 1 }}>
              <div className={s.ringInner}>
                <Avatar background={item.bg} text={item.text} emoji={isAdd ? '➕' : undefined} size="dialog" />
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
            <Text noWrap size={12} color="var(--tg-textSecondary)" className={s.label}>
              {item.name}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Compact stacked avatars shown inside the search bar once the stories row is
 * folded (tweb folds the row into the search input). `progress` fades/scales it in.
 */
export function StoriesStack({
  onOpen,
  show,
}: {
  onOpen: (index: number) => void
  // shown once the row has folded enough (the Sidebar flips this on threshold
  // crossing, not per scroll frame).
  show: boolean
}) {
  const groups = useStoriesStore((s) => s.groups)
  const meId = useChatsStore((s) => s.meId)
  // only the avatars that map to a real group (skip the "+" add affordance)
  const items = buildStoryItems(groups, meId)
    .filter((it) => it.groupIndex !== null)
    .slice(0, 3)

  // each avatar grows and flies up into place from below, staggered
  const container = {
    hidden: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.02 } },
  }
  const item = {
    hidden: { opacity: 0, y: 16, scale: 0.2 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 24 } },
  }

  if (items.length === 0) return null

  // searchBg (обводка стека) зависит от темы — задаётся через CSS var с фолбэком для day
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="stories-stack"
          className={s.stack}
          variants={container}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(items[0].groupIndex!)
          }}
        >
          {items.map((it, i) => {
            const ringBg = !it.hasUnseen ? 'var(--tg-textFaint)' : UNSEEN_RING
            return (
              <motion.div
                key={it.key}
                className={s.stackItem}
                variants={item}
                style={{
                  background: ringBg,
                  marginLeft: i === 0 ? 0 : '-10px',
                  zIndex: 3 - i,
                  boxShadow: '0 0 0 2px var(--tg-inputSearchBg)',
                }}
              >
                <Avatar background={it.bg} text={it.text} size={20} />
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
