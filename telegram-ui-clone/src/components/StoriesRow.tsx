import { Box, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import type { StoryGroup } from '../core/managers/storiesManager'

export const FULL_H = 92
const ITEM_W = 74

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
  const tg = useTheme().tg
  const groups = useStoriesStore((s) => s.groups)
  const meId = useChatsStore((s) => s.meId)
  const items = buildStoryItems(groups, meId)

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        boxSizing: 'border-box',
        // Continuous collapse driven entirely by the --stories-fold CSS var
        // (0 = shown, 1 = folded). border-box clips the padding to nothing as the
        // height reaches 0, so scrolling the chat list never re-renders React.
        height: `calc(${FULL_H}px * (1 - var(--stories-fold, 0)))`,
        padding: '6px 8px 0',
        overflowX: 'auto',
        overflowY: 'hidden',
        opacity: 'max(0, 1 - var(--stories-fold, 0) * 1.4)',
        transform: 'translateY(calc(var(--stories-fold, 0) * -12px))',
        transition: animated
          ? 'height .26s cubic-bezier(.4,0,.2,1), opacity .26s ease, transform .26s cubic-bezier(.4,0,.2,1)'
          : 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {items.map((item) => {
        const isAdd = item.isMe && item.groupIndex === null
        const seen = !item.hasUnseen
        const ringBg = isAdd ? 'transparent' : seen ? tg.textFaint : UNSEEN_RING
        const onClick = () => {
          if (isAdd) onAddStory?.()
          else if (item.groupIndex !== null) onOpen(item.groupIndex)
        }
        return (
          <Box
            key={item.key}
            onClick={onClick}
            sx={{
              flexShrink: 0,
              width: ITEM_W,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <Box
              sx={{
                position: 'relative',
                width: 62,
                height: 62,
                borderRadius: '50%',
                background: ringBg,
                opacity: seen && !isAdd ? 0.45 : 1,
                padding: '2px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: tg.sidebarBg,
                  padding: '2px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Avatar background={item.bg} text={item.text} emoji={isAdd ? '➕' : undefined} size="dialog" />
              </Box>
              {/* "+" add badge on the self avatar (always available to post a story) */}
              {item.isMe && !isAdd && onAddStory && (
                <Box
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddStory()
                  }}
                  aria-label="Добавить историю"
                  sx={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: UNSEEN_RING,
                    border: `2px solid ${tg.sidebarBg}`,
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <TgIcon name="add" size={13} />
                </Box>
              )}
            </Box>
            <Typography
              noWrap
              sx={{
                mt: 0.625,
                width: '100%',
                px: '2px',
                fontSize: 12,
                lineHeight: '15px',
                color: tg.textSecondary,
                textAlign: 'center',
              }}
            >
              {item.name}
            </Typography>
          </Box>
        )
      })}
    </Box>
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
  const theme = useTheme()
  const tg = theme.tg
  const searchBg = theme.palette.mode === 'dark' ? '#181818' : '#f0f0f2'
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

  return (
    <AnimatePresence>
      {show && (
        <Box
          key="stories-stack"
          component={motion.div}
          variants={container}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(items[0].groupIndex!)
          }}
          sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', ml: 0.5 }}
        >
          {items.map((it, i) => {
            const ringBg = !it.hasUnseen ? tg.textFaint : UNSEEN_RING
            return (
              <Box
                key={it.key}
                component={motion.div}
                variants={item}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: ringBg,
                  padding: '2px',
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  ml: i === 0 ? 0 : '-10px',
                  zIndex: 3 - i,
                  boxShadow: `0 0 0 2px ${searchBg}`,
                }}
              >
                <Avatar background={it.bg} text={it.text} size={20} />
              </Box>
            )
          })}
        </Box>
      )}
    </AnimatePresence>
  )
}
