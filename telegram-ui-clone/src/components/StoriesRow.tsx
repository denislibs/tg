import { Box, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import Avatar from './Avatar'

export interface Story {
  id: string
  name: string
  bg: string
  emoji?: string
  seen?: boolean
}

export const STORIES: Story[] = [
  { id: 's1', name: 'My Story', bg: 'linear-gradient(215deg, #34c76f -1.61%, #3da1fd 97.44%)', emoji: '➕' },
  { id: 's2', name: 'Alice', bg: 'linear-gradient(135deg, #ff6a88 0%, #ff99ac 100%)', emoji: '🌸' },
  { id: 's3', name: 'Bob Anderson', bg: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', emoji: 'B' },
  { id: 's4', name: 'Catherine', bg: 'linear-gradient(135deg, #43cea2 0%, #185a9d 100%)', emoji: '🌊' },
  { id: 's5', name: 'Daniel', bg: 'linear-gradient(135deg, #654ea3 0%, #eaafc8 100%)', emoji: 'D', seen: true },
  { id: 's6', name: 'Emma', bg: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)', emoji: '🎨' },
  { id: 's7', name: 'Frank', bg: 'linear-gradient(135deg, #2980b9 0%, #6dd5fa 100%)', emoji: 'F', seen: true },
  { id: 's8', name: 'Grace', bg: 'linear-gradient(135deg, #c471f5 0%, #fa71cd 100%)', emoji: '✨' },
]

export const FULL_H = 92
const ITEM_W = 74
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The full stories row. `progress` (0..1) collapses it as the chat list scrolls;
 * at 1 it's fully folded away (height 0) — the compact stack lives in the search
 * bar (see StoriesStack), matching tweb's foldInto: the search input.
 */
export default function StoriesRow({
  onOpen,
  progress = 0,
  animated = false,
}: {
  onOpen: (index: number) => void
  progress?: number
  // when true, height/opacity transition (desktop reveal); when false the row
  // tracks the scroll position 1:1 (mobile fold)
  animated?: boolean
}) {
  const tg = useTheme().tg
  const p = progress
  const contentOpacity = Math.max(0, 1 - p * 1.4)

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        height: lerp(FULL_H, 0, p),
        padding: p < 0.02 ? '6px 8px 0' : '0 8px',
        overflowX: p < 0.02 ? 'auto' : 'hidden',
        overflowY: 'hidden',
        opacity: contentOpacity,
        transform: `translateY(${-p * 12}px)`,
        transition: animated
          ? 'height .26s cubic-bezier(.4,0,.2,1), opacity .26s ease, transform .26s cubic-bezier(.4,0,.2,1)'
          : 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {STORIES.map((story, index) => {
        const ringBg = story.seen
          ? tg.textFaint
          : 'linear-gradient(215deg, #34c76f -1.61%, #3da1fd 97.44%)'
        return (
          <Box
            key={story.id}
            onClick={() => onOpen(index)}
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
                width: 62,
                height: 62,
                borderRadius: '50%',
                background: ringBg,
                opacity: story.seen ? 0.45 : 1,
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
                <Avatar background={story.bg} emoji={story.emoji} size={54} />
              </Box>
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
              {story.name}
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
  progress,
}: {
  onOpen: (index: number) => void
  progress: number
}) {
  const theme = useTheme()
  const tg = theme.tg
  const searchBg = theme.palette.mode === 'dark' ? '#181818' : '#f0f0f2'
  const show = progress > 0.45 // collapsed enough → show the cluster
  const items = STORIES.slice(0, 3)

  // each avatar grows and flies up into place from below, staggered
  const container = {
    hidden: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.02 } },
  }
  const item = {
    hidden: { opacity: 0, y: 16, scale: 0.2 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 24 } },
  }

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
            onOpen(0)
          }}
          sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', ml: 0.5 }}
        >
          {items.map((story, i) => {
            const ringBg = story.seen
              ? tg.textFaint
              : 'linear-gradient(215deg, #34c76f -1.61%, #3da1fd 97.44%)'
            return (
              <Box
                key={story.id}
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
                <Avatar background={story.bg} emoji={story.emoji} size={20} />
              </Box>
            )
          })}
        </Box>
      )}
    </AnimatePresence>
  )
}
