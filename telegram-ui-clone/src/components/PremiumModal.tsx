import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import CloseRounded from '@mui/icons-material/CloseRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import AutoAwesomeMotionRounded from '@mui/icons-material/AutoAwesomeMotionRounded'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded'
import KeyboardVoiceRounded from '@mui/icons-material/KeyboardVoiceRounded'
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded'
import BlockRounded from '@mui/icons-material/Block'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import EmojiEmotionsRounded from '@mui/icons-material/EmojiEmotionsRounded'
import ChatRounded from '@mui/icons-material/ChatRounded'
import type { ReactNode } from 'react'
import { useT } from '../i18n'

// tweb's premium feature colour ramp (orange -> green), sampled across the list.
const FEATURES: { icon: ReactNode; title: string; subtitle: string; color: string }[] = [
  { icon: <AutoAwesomeMotionRounded />, title: 'Stories', subtitle: 'Posting without limits, priority order, stealth mode, saved view history and more.', color: '#ef6922' },
  { icon: <DescriptionRounded />, title: 'Unlimited Cloud Storage', subtitle: 'Upload files of any size, with unlimited cloud storage.', color: '#e74e33' },
  { icon: <TrendingUpRounded />, title: 'Doubled Limits', subtitle: 'Up to 1000 channels, 20 folders, 10 pinned chats and 20 public links.', color: '#db374b' },
  { icon: <KeyboardVoiceRounded />, title: 'Voice-to-Text', subtitle: 'Convert voice messages into text.', color: '#bc4395' },
  { icon: <RocketLaunchRounded />, title: 'Faster Downloads', subtitle: 'Download media and files at the maximum speed.', color: '#9b4fed' },
  { icon: <BlockRounded />, title: 'No Ads', subtitle: 'Get rid of ads in public channels.', color: '#676bff' },
  { icon: <FavoriteRounded />, title: 'Unique Reactions', subtitle: 'React with a vastly expanded set of emoji.', color: '#4492ff' },
  { icon: <EmojiEmotionsRounded />, title: 'Premium Stickers', subtitle: 'Unlock exclusive animated stickers.', color: '#41a6a5' },
  { icon: <ChatRounded />, title: 'Chat Management', subtitle: 'Change default chat folder, archive and mute new chats.', color: '#3dbd4a' },
]

const PLANS = [
  { id: '24m', label: '24 Months', discount: '-58%', perMonth: '124,58', total: '2 990,00' },
  { id: '12m', label: 'Annual', discount: '-45%', perMonth: '165,83', total: '1 990,00' },
  { id: '1m', label: 'Monthly', discount: null, perMonth: '299,00', total: '299,00' },
] as const

// Telegram-style gradient premium star.
function PremiumStar() {
  return (
    <Box sx={{ width: 96, height: 96, mx: 'auto', mb: 1 }}>
      <svg viewBox="0 0 100 100" width="96" height="96">
        <defs>
          <linearGradient id="prem-star" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9aa0ff" />
            <stop offset="55%" stopColor="#8d6bff" />
            <stop offset="100%" stopColor="#a45ee6" />
          </linearGradient>
        </defs>
        <path
          fill="url(#prem-star)"
          d="M50 8c2 0 3.8 1.2 4.7 3l9.5 19.2 21.2 3.1c4.4.6 6.2 6 3 9.1L73 54.5l3.6 21.1c.8 4.4-3.8 7.7-7.7 5.6L50 71.3 31.1 81.2c-3.9 2.1-8.5-1.2-7.7-5.6L27 54.5 11.6 42.4c-3.2-3.1-1.4-8.5 3-9.1l21.2-3.1L45.3 11C46.2 9.2 48 8 50 8z"
        />
        {/* sparkles */}
        <circle cx="78" cy="20" r="2.6" fill="#b9a8ff" />
        <circle cx="24" cy="30" r="1.8" fill="#b9a8ff" />
        <circle cx="84" cy="44" r="1.6" fill="#b9a8ff" />
      </svg>
    </Box>
  )
}

export default function PremiumModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const [plan, setPlan] = useState<string>('24m')
  const selected = PLANS.find((p) => p.id === plan) ?? PLANS[0]
  const cardBg = useTheme().palette.mode === 'dark' ? '#2b2b2b' : '#f1f1f4'

  return createPortal(
    <AnimatePresence>
      {open && (
        <Box
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 1.5,
          }}
        >
          <Box
            component={motion.div}
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            sx={{
              width: 'min(440px, 100%)',
              maxHeight: '92vh',
              borderRadius: '16px',
              background: tg.sidebarBg,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* scrollable content */}
            <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, pb: 2 }}>
              {/* header */}
              <Box sx={{ position: 'relative', pt: 2 }}>
                <Box
                  onClick={onClose}
                  sx={{
                    position: 'absolute',
                    left: -6,
                    top: 6,
                    p: 0.75,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    color: tg.textPrimary,
                    '&:hover': { background: tg.hover },
                  }}
                >
                  <CloseRounded />
                </Box>
                <PremiumStar />
                <Typography sx={{ textAlign: 'center', fontSize: 26, fontWeight: 700, color: tg.textPrimary }}>
                  Telegram Premium
                </Typography>
                <Typography
                  sx={{ textAlign: 'center', fontSize: 15.5, color: tg.textSecondary, mt: 1, px: 1, lineHeight: 1.4 }}
                >
                  {t('More freedom and dozens of exclusive features with a Telegram Premium subscription.')}
                </Typography>
              </Box>

              {/* plans */}
              <Box sx={{ mt: 2.5 }}>
                {PLANS.map((p) => {
                  const active = p.id === plan
                  return (
                    <Box
                      key={p.id}
                      onClick={() => setPlan(p.id)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        py: 1,
                        px: 1,
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background: active ? cardBg : 'transparent',
                        '&:hover': { background: active ? cardBg : tg.hover },
                      }}
                    >
                      {/* radio — empty ring with the filled check scaling in (tweb-style) */}
                      <Box
                        sx={{
                          position: 'relative',
                          width: 26,
                          height: 26,
                          flexShrink: 0,
                          borderRadius: '50%',
                          border: `2px solid ${active ? tg.accent : tg.textFaint}`,
                          transition: 'border-color .2s',
                        }}
                      >
                        <Box
                          component={motion.div}
                          initial={false}
                          animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          sx={{
                            position: 'absolute',
                            inset: -2,
                            borderRadius: '50%',
                            background: tg.accent,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <CheckRounded sx={{ fontSize: 17, color: '#fff' }} />
                        </Box>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 17, fontWeight: 500, color: tg.textPrimary }}>
                          {t(p.label)}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                          {p.discount && (
                            <Box
                              sx={{
                                px: 0.75,
                                py: 0.1,
                                borderRadius: '6px',
                                background: tg.accent,
                                color: '#fff',
                                fontSize: 13,
                                fontWeight: 600,
                              }}
                            >
                              {p.discount}
                            </Box>
                          )}
                          {p.discount && (
                            <Typography sx={{ fontSize: 15, color: tg.textSecondary }}>
                              {p.perMonth} ₽ {t('per month')}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <Typography sx={{ fontSize: 16, color: tg.textPrimary, flexShrink: 0 }}>
                        {p.total} ₽
                      </Typography>
                    </Box>
                  )
                })}
              </Box>

              {/* features */}
              <Box sx={{ mt: 2 }}>
                {FEATURES.map((f) => (
                  <Box key={f.title} sx={{ display: 'flex', gap: 2, py: 1.25 }}>
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        flexShrink: 0,
                        borderRadius: '11px',
                        background: f.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        '& svg': { fontSize: 24 },
                      }}
                    >
                      {f.icon}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 16, fontWeight: 500, color: tg.textPrimary }}>
                        {t(f.title)}
                      </Typography>
                      <Typography sx={{ fontSize: 14.5, color: tg.textSecondary, lineHeight: 1.35 }}>
                        {t(f.subtitle)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>

            {/* sticky CTA */}
            <Box sx={{ p: 1.5, flexShrink: 0 }}>
              <Box
                component={motion.div}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={onClose}
                sx={{
                  height: 52,
                  borderRadius: '12px',
                  background: 'linear-gradient(90deg, #6c7cf0 0%, #9c6cf0 50%, #e487c8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
              >
                {t('Subscribe for')} {selected.perMonth} ₽ {t('per month')}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </AnimatePresence>,
    document.body,
  )
}
