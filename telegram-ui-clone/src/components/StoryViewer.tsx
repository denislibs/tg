import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, IconButton } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { EASE, DUR } from '../motion'
import Avatar from './Avatar'
import { STORIES } from './StoriesRow'

export default function StoryViewer({ index, onClose }: { index: number; onClose: () => void }) {
  const [current, setCurrent] = useState(index)

  const story = STORIES[current]

  const next = () => {
    if (current >= STORIES.length - 1) onClose()
    else setCurrent((c) => c + 1)
  }
  const prev = () => setCurrent((c) => Math.max(0, c - 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <AnimatePresence>
      <Box
        component={motion.div}
        key="story-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: DUR.in, ease: EASE } }}
        exit={{ opacity: 0, transition: { duration: DUR.out, ease: EASE } }}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Story card */}
        <Box
          component={motion.div}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: EASE }}
          sx={{
            position: 'relative',
            aspectRatio: '9 / 16',
            height: 'min(92vh, 900px)',
            maxWidth: 'calc(min(92vh, 900px) * 9 / 16)',
            width: '100%',
            borderRadius: '12px',
            overflow: 'hidden',
            background: story.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Media placeholder */}
          <Box sx={{ fontSize: 120, userSelect: 'none', lineHeight: 1 }}>
            {story.emoji ?? story.name.charAt(0)}
          </Box>

          {/* Progress bars */}
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              right: 8,
              display: 'flex',
              gap: '3px',
              zIndex: 2,
            }}
          >
            {STORIES.map((s, i) => (
              <Box
                key={s.id}
                sx={{
                  flex: 1,
                  height: 2,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.3)',
                  overflow: 'hidden',
                }}
              >
                {i < current && <Box sx={{ width: '100%', height: '100%', background: '#fff' }} />}
                {i === current && (
                  <motion.div
                    key={current}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                    onAnimationComplete={next}
                    style={{ height: '100%', background: '#fff' }}
                  />
                )}
              </Box>
            ))}
          </Box>

          {/* Header */}
          <Box
            sx={{
              position: 'absolute',
              top: 18,
              left: 8,
              right: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              zIndex: 2,
            }}
          >
            <Avatar background={story.bg} emoji={story.emoji} text={story.name.charAt(0)} size={32} />
            <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{story.name}</Typography>
            <Typography sx={{ color: '#fff', opacity: 0.5, fontSize: 13 }}>12h</Typography>
            <Box sx={{ flex: 1 }} />
            <IconButton onClick={onClose} sx={{ color: '#fff' }} size="small">
              <CloseRounded />
            </IconButton>
          </Box>

          {/* Tap zones */}
          <Box
            onClick={prev}
            sx={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '33.33%', zIndex: 1, cursor: 'pointer' }}
          />
          <Box
            onClick={next}
            sx={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '66.66%', zIndex: 1, cursor: 'pointer' }}
          />

          {/* Faux reply pill */}
          <Box
            sx={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              px: 2,
              borderRadius: '16px',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              zIndex: 2,
            }}
          >
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Reply...</Typography>
          </Box>
        </Box>
      </Box>
    </AnimatePresence>,
    document.body
  )
}
