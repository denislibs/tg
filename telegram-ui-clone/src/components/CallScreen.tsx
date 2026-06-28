import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, IconButton, Typography } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { EASE } from '../motion'
import { useT } from '../i18n'
import Avatar from './Avatar'
import type { Chat } from '../data'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function CallScreen({
  chat,
  video = false,
  onClose,
}: {
  chat: Chat
  video?: boolean
  onClose: () => void
}) {
  const t = useT()
  const [connecting, setConnecting] = useState(true)
  const [secs, setSecs] = useState(0)
  const [muted, setMuted] = useState(false)
  const [cam, setCam] = useState(video)
  const timer = useRef<number | undefined>(undefined)

  // connect after ~2s, then count the duration up
  useEffect(() => {
    const c = window.setTimeout(() => setConnecting(false), 2000)
    return () => window.clearTimeout(c)
  }, [])
  useEffect(() => {
    if (connecting) return
    timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000)
    return () => window.clearInterval(timer.current)
  }, [connecting])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const status = connecting ? t('Ringing…') : fmt(secs)
  const gradient = connecting
    ? 'linear-gradient(135deg, #6d5bd0, #3f7fd6, #8a5bff, #4f86e8)'
    : 'linear-gradient(135deg, #2faf86, #3bb2b8, #43cea2, #2a8f7a)'

  const ctrlSx = {
    width: 54,
    height: 54,
    borderRadius: '50%',
    color: '#fff',
    background: 'rgba(255,255,255,0.15)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    '&:hover': { background: 'rgba(255,255,255,0.25)' },
    '& svg': { fontSize: 26 },
  }

  return createPortal(
    <Box
      component={motion.div}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.3, ease: EASE }}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        color: '#fff',
      }}
    >
      {/* Animated gradient background */}
      <Box
        component={motion.div}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
        sx={{
          position: 'absolute',
          inset: 0,
          background: gradient,
          backgroundSize: '300% 300%',
          transition: 'background 0.6s ease',
        }}
      />
      <Box sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)' }} />

      {/* Peer */}
      <Box
        sx={{
          position: 'relative',
          mt: '18vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} size={136} />
        <Typography sx={{ fontSize: 28, fontWeight: 600 }}>{chat.name}</Typography>
        <Typography sx={{ fontSize: 16, opacity: 0.85 }}>
          {video ? `${t('Video Call')} · ${status}` : status}
        </Typography>
      </Box>

      {/* Controls */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '12vh',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <IconButton onClick={() => setMuted((v) => !v)} sx={ctrlSx}>
          {muted ? (
            <TgIcon name="microphone_crossed" size={26} color="#fff" />
          ) : (
            <TgIcon name="microphone_filled" size={26} color="#fff" />
          )}
        </IconButton>
        <IconButton onClick={() => setCam((v) => !v)} sx={ctrlSx}>
          {cam ? (
            <TgIcon name="videocamera" size={26} color="#fff" />
          ) : (
            <TgIcon name="videocamera_crossed_filled" size={26} color="#fff" />
          )}
        </IconButton>
        <IconButton sx={ctrlSx}>
          <TgIcon name="volume_up" size={26} color="#fff" />
        </IconButton>
        <IconButton
          onClick={onClose}
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: '#ff595a',
            color: '#fff',
            '&:hover': { background: '#e84a4b' },
            '& svg': { fontSize: 30 },
          }}
        >
          <TgIcon name="endcall_filled" size={30} color="#fff" />
        </IconButton>
      </Box>
    </Box>,
    document.body,
  )
}
