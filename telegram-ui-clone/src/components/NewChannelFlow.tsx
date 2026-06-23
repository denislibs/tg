import { useState } from 'react'
import { Box, IconButton, TextField, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import AddAPhotoRounded from '@mui/icons-material/AddAPhotoRounded'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

export default function NewChannelFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const cardBg = theme.palette.mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const canNext = name.trim().length > 0

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '14px',
      color: tg.textPrimary,
      fontSize: 16,
      '& fieldset': { borderColor: tg.divider },
      '&:hover fieldset': { borderColor: tg.textFaint },
      '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '1.5px' },
    },
    '& .MuiOutlinedInput-input': { padding: '15px 16px' },
    '& .MuiInputLabel-root': { color: tg.textSecondary, fontSize: 16 },
    '& .MuiInputLabel-root.Mui-focused': { color: tg.accent },
  }

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onClose} sx={{ color: tg.textSecondary }}>
          <ArrowBackRounded />
        </IconButton>
        <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t('New Channel')}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Box sx={{ m: 1.5, px: 3, py: 4, borderRadius: '18px', background: cardBg }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
            <Box
              component={motion.div}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              sx={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                background: tg.accentGradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <AddAPhotoRounded sx={{ fontSize: 44 }} />
            </Box>
          </Box>
          <TextField
            autoFocus
            fullWidth
            label={t('Channel name')}
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ ...fieldSx, mb: 2 }}
          />
          <TextField
            fullWidth
            label={t('Description (optional)')}
            variant="outlined"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            sx={fieldSx}
          />
        </Box>
        <Typography sx={{ fontSize: 14.5, color: tg.textSecondary, px: 3 }}>
          {t('You can provide an optional description for your channel.')}
        </Typography>
      </Box>

      <Box
        component={motion.div}
        onClick={() => canNext && onCreate(name.trim(), desc.trim())}
        whileHover={{ scale: canNext ? 1.06 : 1 }}
        whileTap={{ scale: canNext ? 0.92 : 1 }}
        sx={{
          position: 'absolute',
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: tg.accentGradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          cursor: canNext ? 'pointer' : 'default',
          opacity: canNext ? 1 : 0.45,
          transition: 'opacity .2s ease',
        }}
      >
        <ArrowForwardRounded />
      </Box>
    </motion.div>
  )
}
