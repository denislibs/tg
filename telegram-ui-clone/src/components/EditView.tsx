import { useState } from 'react'
import type { ReactNode } from 'react'
import { Box, IconButton, TextField, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import { slideInRight } from '../motion'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import AddAPhotoRounded from '@mui/icons-material/AddAPhotoRounded'
import LockOutlined from '@mui/icons-material/LockOutlined'
import LinkRounded from '@mui/icons-material/LinkRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import ShieldOutlined from '@mui/icons-material/ShieldOutlined'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import type { Chat } from '../data'
import { useT } from '../i18n'

export default function EditView({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const cardBg = theme.palette.mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const isChannel = chat.type === 'channel'
  const [name, setName] = useState(chat.name)
  const [desc, setDesc] = useState(chat.description ?? '')

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '12px',
      color: tg.textPrimary,
      fontSize: 16,
      '& fieldset': { borderColor: tg.divider },
      '&:hover fieldset': { borderColor: tg.textFaint },
      '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '1.5px' },
    },
    '& .MuiOutlinedInput-input': { padding: '14px 14px' },
    '& .MuiInputLabel-root': { color: tg.textSecondary },
    '& .MuiInputLabel-root.Mui-focused': { color: tg.accent },
  }

  const rows: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <LockOutlined />, label: t(isChannel ? 'Channel Type' : 'Group Type'), value: t('Private') },
    { icon: <LinkRounded />, label: t('Invite Links'), value: '1' },
    { icon: <FavoriteBorderRounded />, label: t('Reactions'), value: t('All') },
    { icon: <ChatBubbleOutlineRounded />, label: t('Direct Messages'), value: t('Off') },
    { icon: <ForumOutlined />, label: t('Discussion'), value: t('Add') },
    { icon: <ReceiptLongOutlined />, label: t('Recent Actions'), value: '' },
  ]
  const bottom: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <ShieldOutlined />, label: t('Administrators'), value: '1' },
    { icon: <GroupOutlined />, label: t(isChannel ? 'Subscribers' : 'Members'), value: '1' },
  ]

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 6,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} sx={{ color: tg.textSecondary }}>
          <ArrowBackRounded />
        </IconButton>
        <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>{t('Edit')}</Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
        {/* Avatar + name/desc */}
        <Box sx={{ mx: 1.25, mb: 1.5, p: 2, borderRadius: '16px', background: cardBg }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
            <Box
              component={motion.div}
              whileTap={{ scale: 0.96 }}
              sx={{
                width: 96,
                height: 96,
                borderRadius: '50%',
                background: chat.avatar,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <AddAPhotoRounded sx={{ fontSize: 36 }} />
            </Box>
          </Box>
          <TextField
            fullWidth
            label={t(isChannel ? 'Channel name' : 'Group name')}
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ ...fieldSx, mb: 2 }}
          />
          <TextField
            fullWidth
            label={t('Description')}
            variant="outlined"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            sx={fieldSx}
          />
        </Box>
        <Typography sx={{ fontSize: 14, color: tg.textSecondary, px: 2.5, mb: 1 }}>
          {t('You can provide an optional description for your')} {t(isChannel ? 'channel' : 'group')}.
        </Typography>

        {/* Settings list */}
        <Box sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {rows.map((r) => (
            <EditRow key={r.label} icon={r.icon} label={r.label} value={r.value} tg={tg} />
          ))}
        </Box>

        <Typography sx={{ fontSize: 14, color: tg.textSecondary, px: 2.5, mb: 1 }}>
          {t('Add a group chat for comments')}
        </Typography>

        <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {bottom.map((r) => (
            <EditRow key={r.label} icon={r.icon} label={r.label} value={r.value} tg={tg} />
          ))}
        </Box>
      </Box>
    </motion.div>
  )
}

function EditRow({ icon, label, value, tg }: { icon: ReactNode; label: string; value: string; tg: any }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 0.85,
        mx: 0.5,
        borderRadius: '12px',
        cursor: 'pointer',
        '&:hover': { background: tg.hover },
      }}
    >
      <Box sx={{ color: tg.textSecondary, display: 'flex', '& svg': { fontSize: 24 } }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{label}</Typography>
        {value && <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{value}</Typography>}
      </Box>
    </Box>
  )
}
