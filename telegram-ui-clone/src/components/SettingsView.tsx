import { useState } from 'react'
import type { ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import { slideInRight } from '../motion'
import TgSwitch from './TgSwitch'
import SettingsSubScreen, { hasSubScreen } from './SettingsSubScreen'
import EditProfile from './settings/EditProfile'
import PremiumModal from './PremiumModal'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useT, useLang, LANGS } from '../i18n'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import { useAvatarSrc } from './useAvatarSrc'

// Pretty-print a Russian +7XXXXXXXXXX number as "+7 925 481 7290"; any other
// shape is shown as-is.
function formatPhone(phone?: string): string {
  if (!phone) return ''
  const m = phone.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/)
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone
}

const settingsItems: { icon: ReactNode; label: string; value?: string }[] = [
  { icon: <TgIcon name="unmute" size={24} />, label: 'Notifications and Sounds' },
  { icon: <TgIcon name="data" size={24} />, label: 'Data and Storage' },
  { icon: <TgIcon name="lock" size={24} />, label: 'Privacy and Security' },
  { icon: <TgIcon name="settings" size={24} />, label: 'General Settings' },
  { icon: <TgIcon name="folder" size={24} />, label: 'Chat Folders' },
  { icon: <TgIcon name="smile" size={24} />, label: 'Stickers and Emoji' },
  { icon: <TgIcon name="videocamera" size={24} />, label: 'Speakers and Camera' },
  { icon: <TgIcon name="devices" size={24} />, label: 'Devices', value: '3' },
  { icon: <TgIcon name="language" size={24} />, label: 'Language', value: 'English' },
  { icon: <TgIcon name="keyboard" size={24} />, label: 'Keyboard Shortcuts' },
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
  const me = useChatsStore((s) => s.me)
  const name = me?.displayName || formatPhone(me?.phone) || ''
  const avatarText = (me?.displayName || me?.phone || '?').trim().charAt(0).toUpperCase()
  const avatarBg = me ? gradientFor(me.id) : 'linear-gradient(135deg,#ff8a5b,#ff6a3d)'
  const avatarSrc = useAvatarSrc(me?.avatarUrl)

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
        <IconButton onClick={onBack} color={tg.textSecondary}>
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color={tg.textPrimary} style={{ flex: 1 }}>
          {t('Settings')}
        </Text>
        <IconButton color={tg.textSecondary}>
          <TgIcon name="qr" />
        </IconButton>
        <IconButton onClick={() => setEditProfile(true)} color={tg.textSecondary}>
          <TgIcon name="edit" />
        </IconButton>
        <IconButton color={tg.textSecondary}>
          <TgIcon name="more" />
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
          <Avatar background={avatarBg} src={avatarSrc} text={avatarText} size={130} />
          <Text size={21} weight={600} color={tg.textPrimary} style={{ marginTop: '8px' }}>
            {name}
          </Text>
          <Text size={14} color={tg.textSecondary}>{t('online')}</Text>
        </Box>

        {/* Contact card */}
        <Box
          onClick={() => setEditProfile(true)}
          sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5, cursor: 'pointer' }}
        >
          <InfoRow icon={<TgIcon name="phone" size={24} />} title={formatPhone(me?.phone) || '—'} subtitle={t('Phone')} />
          {me?.username && (
            <InfoRow icon={<TgIcon name="mention" size={24} />} title={me.username} subtitle={t('Username')} />
          )}
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
            <TgIcon name="darkmode" size={24} color={tg.textSecondary} />
            <Text size={16} color={tg.textPrimary} style={{ flex: 1 }}>{t('Night Mode')}</Text>
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
                <Text size={16} color={tg.textPrimary} style={{ flex: 1 }}>
                  {t(it.label)}
                </Text>
                {it.value && (
                  <Text size={15} color={tg.textFaint}>
                    {it.label === 'Language' ? currentLangName : t(it.value)}
                  </Text>
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
            <TgIcon name="star_filled" size={24} color={tg.accent} />
            <Text size={16} color={tg.textPrimary} style={{ flex: 1 }}>
              {t('Telegram Premium')}
            </Text>
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
            <TgIcon name="gift" size={24} color={tg.textSecondary} />
            <Text size={16} color={tg.textPrimary} style={{ flex: 1 }}>{t('Send a Gift')}</Text>
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
        <Text size={16} color={tg.textPrimary}>{title}</Text>
        <Text size={13.5} color={tg.textSecondary}>{subtitle}</Text>
      </Box>
    </Box>
  )
}
