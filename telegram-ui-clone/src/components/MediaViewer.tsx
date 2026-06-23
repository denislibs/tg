import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, IconButton } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import DownloadRounded from '@mui/icons-material/DownloadRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { EASE } from '../motion'
import Avatar from './Avatar'

export default function MediaViewer({
  media,
  onClose,
}: {
  media: { gradient: string; emoji?: string; title?: string; time?: string }
  onClose: () => void
}) {
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
        key="media-viewer-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 4000,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top bar */}
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{ height: 56, px: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}
        >
          <Avatar background="linear-gradient(135deg,#7d8b9a,#4b5563)" size={32} text={media.title?.charAt(0)} />
          <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <Typography sx={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>kyzdar.ai</Typography>
            {media.time && (
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{media.time}</Typography>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
          <IconButton sx={{ color: '#fff' }}>
            <DownloadRounded />
          </IconButton>
          <IconButton onClick={onClose} sx={{ color: '#fff' }}>
            <CloseRounded />
          </IconButton>
        </Box>

        {/* Center image */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          <Box
            component={motion.div}
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            transition={{ duration: 0.2, ease: EASE }}
            sx={{
              maxWidth: 'min(900px, 92vw)',
              maxHeight: '80vh',
              width: '100%',
              aspectRatio: '4 / 3',
              borderRadius: '8px',
              background: media.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              overflow: 'hidden',
            }}
          >
            {media.emoji && <Box sx={{ fontSize: 120, lineHeight: 1 }}>{media.emoji}</Box>}
          </Box>
        </Box>
      </Box>
    </AnimatePresence>,
    document.body
  )
}
