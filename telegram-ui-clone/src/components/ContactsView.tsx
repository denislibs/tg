import { useMemo, useState } from 'react'
import { Box, IconButton, InputBase, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import Avatar from './Avatar'
import { useT } from '../i18n'
import type { Chat } from '../data'

export default function ContactsView({
  chats,
  onSelect,
  onBack,
}: {
  chats: Chat[]
  onSelect: (id: string) => void
  onBack: () => void
}) {
  const tg = useTheme().tg
  const t = useT()
  const [query, setQuery] = useState('')

  const contacts = useMemo(
    () =>
      chats
        .filter((c) => c.type === 'private')
        .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chats, query],
  )

  // group by first letter
  const groups = useMemo(() => {
    const map = new Map<string, Chat[]>()
    for (const c of contacts) {
      const k = c.name[0]?.toUpperCase() ?? '#'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()]
  }, [contacts])

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} sx={{ color: tg.textSecondary }}>
          <TgIcon name="back" />
        </IconButton>
        <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t('Contacts')}
        </Typography>
        <IconButton sx={{ color: tg.textSecondary }}>
          <TgIcon name="adduser" />
        </IconButton>
      </Box>

      {/* Search */}
      <Box sx={{ px: 1.5, pb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            background: tg.bubble,
            borderRadius: '9999px',
            height: 40,
            px: 1.75,
          }}
        >
          <TgIcon name="search" size={20} color={tg.textFaint} />
          <InputBase
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search')}
            sx={{ flex: 1, fontSize: 15, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
          />
        </Box>
      </Box>

      {/* List */}
      <Box sx={{ flex: 1, overflowY: 'auto', pb: 2 }}>
        {groups.length === 0 && (
          <Typography sx={{ px: 3, py: 2, fontSize: 14, color: tg.textSecondary }}>
            {t('No contacts found.')}
          </Typography>
        )}
        {groups.map(([letter, list]) => (
          <Box key={letter}>
            <Typography sx={{ px: 2.5, pt: 1.5, pb: 0.5, fontSize: 13, fontWeight: 600, color: tg.accent }}>
              {letter}
            </Typography>
            {list.map((c) => (
              <Box
                key={c.id}
                onClick={() => onSelect(c.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 0.85,
                  mx: 0.75,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  '&:hover': { background: tg.hover },
                }}
              >
                <Avatar
                  background={c.avatar}
                  text={c.avatarText}
                  emoji={c.avatarEmoji}
                  size={46}
                  online={c.online}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>
                    {c.name}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 13.5, color: c.online ? tg.accent : tg.textSecondary }}>
                    {c.online ? t('online') : c.status || t('last seen recently')}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </motion.div>
  )
}
