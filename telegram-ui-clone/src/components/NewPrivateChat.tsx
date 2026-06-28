import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, InputBase, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from './Avatar'
import type { Chat } from '../data'
import { useT } from '../i18n'

interface Props {
  chats: Chat[]
  onClose: () => void
  onSelect: (id: string) => void
}

export default function NewPrivateChat({ chats, onClose, onSelect }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const cardBg = theme.palette.mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // focus only after the slide-in finishes (autofocus would interrupt the animation)
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 220)
    return () => window.clearTimeout(id)
  }, [])

  const people = chats.filter(
    (c) =>
      (c.type === 'private' || c.type === 'bot') &&
      c.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 41,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onClose} sx={{ color: tg.textSecondary }}>
          <TgIcon name="back" />
        </IconButton>
        <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t('New Message')}
        </Typography>
      </Box>

      {/* Search */}
      <Box
        sx={{
          mx: 1.25,
          mb: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          background: cardBg,
          borderRadius: '9999px',
          height: 44,
          px: 1.75,
        }}
      >
        <TgIcon name="search" size={22} color={tg.textFaint} />
        <InputBase
          inputRef={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search')}
          sx={{
            flex: 1,
            fontSize: 16,
            color: tg.textPrimary,
            '& input::placeholder': { color: tg.textFaint, opacity: 1 },
          }}
        />
      </Box>

      {/* Contact list */}
      <Box sx={{ flex: 1, overflowY: 'auto', pb: 2 }}>
        {people.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              pt: 8,
            }}
          >
            <Box sx={{ fontSize: 80, lineHeight: 1 }}>🐤</Box>
            <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
              {t('No Results')}
            </Typography>
            <Typography sx={{ fontSize: 15, color: tg.textSecondary }}>{t('Try searching.')}</Typography>
          </Box>
        ) : (
          people.map((c) => (
            <Box
              key={c.id}
              onClick={() => {
                onSelect(c.id)
                onClose()
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 0.85,
                mx: 0.75,
                borderRadius: '12px',
                cursor: 'pointer',
                '&:hover': { background: tg.hover },
              }}
            >
              <Avatar background={c.avatar} text={c.avatarText} emoji={c.avatarEmoji} size={48} />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 16, fontWeight: 500, color: tg.textPrimary }}>
                  {c.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: 14, color: tg.textSecondary }}>
                  {c.status}
                </Typography>
              </Box>
            </Box>
          ))
        )}
      </Box>
    </motion.div>
  )
}
