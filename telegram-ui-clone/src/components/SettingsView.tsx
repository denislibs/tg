import { useState } from 'react'
import type { ReactNode } from 'react'
import { Box, IconButton, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { slideInRight } from '../motion'
import TgSwitch from './TgSwitch'
import SettingsSubScreen, { hasSubScreen } from './SettingsSubScreen'
import EditProfile from './settings/EditProfile'
import PremiumModal from './PremiumModal'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import StarRounded from '@mui/icons-material/StarRounded'
import CardGiftcardRounded from '@mui/icons-material/CardGiftcardRounded'
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded'
import EditRounded from '@mui/icons-material/EditRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import CallOutlined from '@mui/icons-material/CallOutlined'
import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded'
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import LockOutlined from '@mui/icons-material/LockOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import EmojiEmotionsOutlined from '@mui/icons-material/EmojiEmotionsOutlined'
import VideocamOutlined from '@mui/icons-material/VideocamOutlined'
import DevicesOutlined from '@mui/icons-material/DevicesOutlined'
import TranslateRounded from '@mui/icons-material/TranslateRounded'
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined'
import Avatar from './Avatar'
import { useT, useLang, LANGS } from '../i18n'

const settingsItems: { icon: ReactNode; label: string; value?: string }[] = [
  { icon: <NotificationsNoneRounded />, label: 'Notifications and Sounds' },
  { icon: <StorageRounded />, label: 'Data and Storage' },
  { icon: <LockOutlined />, label: 'Privacy and Security' },
  { icon: <SettingsOutlined />, label: 'General Settings' },
  { icon: <FolderOutlined />, label: 'Chat Folders' },
  { icon: <EmojiEmotionsOutlined />, label: 'Stickers and Emoji' },
  { icon: <VideocamOutlined />, label: 'Speakers and Camera' },
  { icon: <DevicesOutlined />, label: 'Devices', value: '3' },
  { icon: <TranslateRounded />, label: 'Language', value: 'English' },
  { icon: <KeyboardOutlined />, label: 'Keyboard Shortcuts' },
]

export default function SettingsView({
  onBack,
  onToggleMode,
}: {
  onBack: () => void
  onToggleMode: (coords?: { x: number; y: number }) => void
}) {
  const t = useT()
  const [lang] = useLang()
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? 'English'
  const theme = useTheme()
  const tg = theme.tg
  const isDark = theme.palette.mode === 'dark'
  const cardBg = isDark ? '#2b2b2b' : '#ffffff'
  const [active, setActive] = useState('Notifications and Sounds')
  const [sub, setSub] = useState<string | null>(null)
  const [editProfile, setEditProfile] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)

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
          <ArrowBackRounded />
        </IconButton>
        <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t('Settings')}
        </Typography>
        <IconButton sx={{ color: tg.textSecondary }}>
          <QrCode2Rounded />
        </IconButton>
        <IconButton onClick={() => setEditProfile(true)} sx={{ color: tg.textSecondary }}>
          <EditRounded />
        </IconButton>
        <IconButton sx={{ color: tg.textSecondary }}>
          <MoreVertRounded />
        </IconButton>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
        {/* Avatar + name */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            pt: 1,
            pb: 3,
          }}
        >
          <Avatar background="linear-gradient(135deg,#ff8a5b,#ff6a3d)" text="Д" size={130} />
          <Typography sx={{ fontSize: 21, fontWeight: 600, color: tg.textPrimary, mt: 1 }}>
            Дн
          </Typography>
          <Typography sx={{ fontSize: 14, color: tg.textSecondary }}>{t('online')}</Typography>
        </Box>

        {/* Contact card */}
        <Box
          onClick={() => setEditProfile(true)}
          sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5, cursor: 'pointer' }}
        >
          <InfoRow icon={<CallOutlined />} title="+7 925 481 7290" subtitle={t('Phone')} />
          <InfoRow icon={<AlternateEmailRounded />} title="denis_m" subtitle={t('Username')} />
        </Box>

        {/* Appearance — theme toggle */}
        <Box sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          <Box
            onClick={(e) => onToggleMode({ x: e.clientX, y: e.clientY })}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 2,
              py: 0.75,
              mx: 0.5,
              borderRadius: '12px',
              cursor: 'pointer',
              '&:hover': { background: tg.hover },
            }}
          >
            <DarkModeOutlined sx={{ color: tg.textSecondary, fontSize: 24 }} />
            <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>{t('Night Mode')}</Typography>
            <TgSwitch checked={isDark} />
          </Box>
        </Box>

        {/* Settings list */}
        <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.75 }}>
          {settingsItems.map((it) => {
            const isActive = it.label === active
            return (
              <Box
                key={it.label}
                onClick={() => {
                  setActive(it.label)
                  if (hasSubScreen(it.label)) setSub(it.label)
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 2,
                  py: 1.25,
                  mx: 0.75,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  background: isActive ? tg.hover : 'transparent',
                  '&:hover': { background: tg.hover },
                }}
              >
                <Box sx={{ color: tg.textSecondary, display: 'flex', '& svg': { fontSize: 24 } }}>
                  {it.icon}
                </Box>
                <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>
                  {t(it.label)}
                </Typography>
                {it.value && (
                  <Typography sx={{ fontSize: 15, color: tg.textFaint }}>
                    {it.label === 'Language' ? currentLangName : t(it.value)}
                  </Typography>
                )}
              </Box>
            )
          })}
        </Box>

        {/* Premium / Gift */}
        <Box sx={{ mx: 1.25, mt: 1.5, borderRadius: '16px', background: cardBg, py: 0.75 }}>
          <Box
            onClick={() => setPremiumOpen(true)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 2,
              py: 1.25,
              mx: 0.75,
              borderRadius: '12px',
              cursor: 'pointer',
              '&:hover': { background: tg.hover },
            }}
          >
            <StarRounded sx={{ color: tg.accent, fontSize: 24 }} />
            <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>
              {t('Telegram Premium')}
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 2,
              py: 1.25,
              mx: 0.75,
              borderRadius: '12px',
              cursor: 'pointer',
              '&:hover': { background: tg.hover },
            }}
          >
            <CardGiftcardRounded sx={{ color: tg.textSecondary, fontSize: 24 }} />
            <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>{t('Send a Gift')}</Typography>
          </Box>
        </Box>
      </Box>

      {/* Sub-screen overlay */}
      <AnimatePresence>
        {sub && <SettingsSubScreen title={sub} onBack={() => setSub(null)} />}
      </AnimatePresence>

      {/* Edit profile overlay */}
      <AnimatePresence>
        {editProfile && <EditProfile onBack={() => setEditProfile(false)} />}
      </AnimatePresence>

      {/* Telegram Premium modal */}
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />
    </motion.div>
  )
}

function InfoRow({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  const tg = useTheme().tg
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1,
        mx: 0.75,
        borderRadius: '12px',
        cursor: 'pointer',
        '&:hover': { background: tg.hover },
      }}
    >
      <Box sx={{ color: tg.textSecondary, display: 'flex', '& svg': { fontSize: 24 } }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{title}</Typography>
        <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{subtitle}</Typography>
      </Box>
    </Box>
  )
}
