import { useState } from 'react'
import { Box, IconButton, InputBase, TextField, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import AddAPhotoRounded from '@mui/icons-material/AddAPhotoRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
  onCreate: (name: string) => void
}

export default function NewGroupFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const cardBg = mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')

  const next = () => {
    if (step === 0) {
      if (name.trim()) setStep(1)
    } else {
      onCreate(name.trim())
    }
  }
  const back = () => (step === 0 ? onClose() : setStep(0))
  const canNext = step === 0 ? name.trim().length > 0 : true

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
        <IconButton onClick={back} sx={{ color: tg.textSecondary }}>
          <ArrowBackRounded />
        </IconButton>
        <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {step === 0 ? t('New Group') : t('Add Members')}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, position: 'relative' }}>
        <AnimatePresence mode="wait" initial={false}>
          {step === 0 ? (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
            >
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
                  label={t('Group Name')}
                  variant="outlined"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '14px',
                      color: tg.textPrimary,
                      fontSize: 16,
                      '& fieldset': { borderColor: tg.divider },
                      '&:hover fieldset': { borderColor: tg.textFaint },
                      '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '1.5px' },
                    },
                    '& .MuiOutlinedInput-input': { padding: '16px 16px' },
                    '& .MuiInputLabel-root': { color: tg.textSecondary, fontSize: 16 },
                    '& .MuiInputLabel-root.Mui-focused': { color: tg.accent },
                  }}
                />
              </Box>
            </motion.div>
          ) : (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <Box
                sx={{
                  mx: 1.25,
                  mt: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  background: cardBg,
                  borderRadius: '9999px',
                  px: 1.75,
                  py: 0.95,
                }}
              >
                <SearchRounded sx={{ color: tg.textFaint, fontSize: 22 }} />
                <InputBase
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search')}
                  sx={{ flex: 1, fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
                />
              </Box>

              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  pb: 10,
                }}
              >
                <Box sx={{ fontSize: 90, lineHeight: 1 }}>🐤</Box>
                <Typography sx={{ fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>{t('No Results')}</Typography>
                <Typography sx={{ fontSize: 15, color: tg.textSecondary }}>{t('Try searching.')}</Typography>
              </Box>
            </motion.div>
          )}
        </AnimatePresence>
      </Box>

      {/* Next FAB */}
      <Box
        component={motion.div}
        onClick={next}
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
