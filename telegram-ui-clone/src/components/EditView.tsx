import { useState } from 'react'
import type { ReactNode } from 'react'
import { Box, TextField, useTheme } from '@mui/material'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { motion } from 'framer-motion'
import { slideInRight } from '../motion'
import TgIcon from './TgIcon'
import type { Chat } from '../data'
import type { TgTokens } from '../theme'
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
    { icon: <TgIcon name="lock" size={24} />, label: t(isChannel ? 'Channel Type' : 'Group Type'), value: t('Private') },
    { icon: <TgIcon name="link" size={24} />, label: t('Invite Links'), value: '1' },
    { icon: <TgIcon name="reactions" size={24} />, label: t('Reactions'), value: t('All') },
    { icon: <TgIcon name="message" size={24} />, label: t('Direct Messages'), value: t('Off') },
    { icon: <TgIcon name="comments" size={24} />, label: t('Discussion'), value: t('Add') },
    { icon: <TgIcon name="list" size={24} />, label: t('Recent Actions'), value: '' },
  ]
  const bottom: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <TgIcon name="admin" size={24} />, label: t('Administrators'), value: '1' },
    { icon: <TgIcon name="group" size={24} />, label: t(isChannel ? 'Subscribers' : 'Members'), value: '1' },
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
        <IconButton onClick={onBack} color={tg.textSecondary}>
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color={tg.textPrimary}>{t('Edit')}</Text>
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
              <TgIcon name="cameraadd" size={36} />
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
        <Text size={14} color={tg.textSecondary} style={{ paddingLeft: '20px', paddingRight: '20px', marginBottom: '8px' }}>
          {t('You can provide an optional description for your')} {t(isChannel ? 'channel' : 'group')}.
        </Text>

        {/* Settings list */}
        <Box sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {rows.map((r) => (
            <EditRow key={r.label} icon={r.icon} label={r.label} value={r.value} tg={tg} />
          ))}
        </Box>

        <Text size={14} color={tg.textSecondary} style={{ paddingLeft: '20px', paddingRight: '20px', marginBottom: '8px' }}>
          {t('Add a group chat for comments')}
        </Text>

        <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {bottom.map((r) => (
            <EditRow key={r.label} icon={r.icon} label={r.label} value={r.value} tg={tg} />
          ))}
        </Box>
      </Box>
    </motion.div>
  )
}

function EditRow({ icon, label, value, tg }: { icon: ReactNode; label: string; value: string; tg: TgTokens }) {
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
        <Text size={16} color={tg.textPrimary}>{label}</Text>
        {value && <Text size={13.5} color={tg.textSecondary}>{value}</Text>}
      </Box>
    </Box>
  )
}
