import { useState } from 'react'
import { Box, IconButton, TextField, Typography, useTheme } from '@mui/material'
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded'
import DoneRounded from '@mui/icons-material/DoneRounded'
import CardGiftcardRounded from '@mui/icons-material/CardGiftcardRounded'
import Avatar from '../Avatar'
import { useT } from '../../i18n'
import { SettingsScreen, useCardBg, useFieldSx } from './kit'

const BIO_MAX = 70

export default function EditProfile({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  const [first, setFirst] = useState('Дн')
  const [last, setLast] = useState('')
  const [bio, setBio] = useState('')
  const [username, setUsername] = useState('denis_m')
  const fieldSx = useFieldSx()

  const uname = username.trim()
  const usernameValid = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(uname)
  const usernameMsg = !uname
    ? t('Minimum 5 characters.')
    : usernameValid
      ? t('This username is available.')
      : t('Username must be 5–32 chars: letters, digits, underscore.')
  const usernameColor = !uname ? tg.textSecondary : usernameValid ? '#4dcd5e' : '#ff595a'

  return (
    <SettingsScreen
      title="Edit Profile"
      onBack={onBack}
      headerRight={
        <IconButton onClick={onBack} sx={{ color: tg.accent }}>
          <DoneRounded />
        </IconButton>
      }
    >
      {/* avatar with camera overlay */}
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
        <Box sx={{ position: 'relative', cursor: 'pointer' }}>
          <Avatar background="linear-gradient(135deg,#ff8a5b,#ff6a3d)" text={first[0] || 'Д'} size={120} />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhotoCameraRounded sx={{ color: '#fff', fontSize: 40 }} />
          </Box>
        </Box>
      </Box>

      {/* name / last / bio + birthday */}
      <Box sx={{ mx: 1.25, p: 2, borderRadius: '18px', background: cardBg, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        <TextField fullWidth label={t('Name')} variant="outlined" value={first} onChange={(e) => setFirst(e.target.value)} sx={fieldSx} />
        <TextField fullWidth label={t('Last name')} variant="outlined" value={last} onChange={(e) => setLast(e.target.value)} sx={fieldSx} />
        <TextField
          fullWidth
          label={t('Bio (optional)')}
          variant="outlined"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          sx={fieldSx}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 1,
            py: 0.5,
            borderRadius: '12px',
            cursor: 'pointer',
            '&:hover': { background: tg.hover },
          }}
        >
          <CardGiftcardRounded sx={{ color: tg.textSecondary, fontSize: 24 }} />
          <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{t('Add birthday')}</Typography>
        </Box>
      </Box>
      <Typography sx={{ px: 3, pt: 1, fontSize: 14, color: tg.textSecondary, lineHeight: 1.45 }}>
        {t('Any details such as age, occupation or city. Example: 23 y.o. designer from San Francisco.')}
      </Typography>

      {/* username */}
      <Typography sx={{ px: 3, pt: 2.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
        {t('Username')}
      </Typography>
      <Box sx={{ mx: 1.25, p: 2, borderRadius: '18px', background: cardBg }}>
        <TextField
          fullWidth
          label={t('Username (optional)')}
          variant="outlined"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
          sx={fieldSx}
        />
      </Box>
      <Typography sx={{ px: 3, pt: 1, fontSize: 14, color: usernameColor, lineHeight: 1.45 }}>
        {usernameMsg}
      </Typography>
      <Typography sx={{ px: 3, pt: 1, fontSize: 14, color: tg.textSecondary, lineHeight: 1.45 }}>
        {t('You can choose a public username so people can find you and contact you without knowing your phone number.')}
      </Typography>
    </SettingsScreen>
  )
}
