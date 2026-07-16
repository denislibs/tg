import { useState } from 'react'
import type { ReactNode } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import { slideInRight } from '../motion'
import SettingsSubScreen, { hasSubScreen } from './SettingsSubScreen'
import EditProfile from './settings/EditProfile'
import PremiumModal from './PremiumModal'
import QrModal from './QrModal'
import TgIcon from './TgIcon'
import TgSwitch from './TgSwitch'
import Avatar from '../shared/ui/Avatar'
import { Section, Row } from './settings/kit'
import classNames from '../shared/lib/classNames'
import { useT, useLang, LANGS } from '../i18n'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import { useAvatarSrc } from './useAvatarSrc'
import { useSettings } from '../settings'
import { resolvePreset, PRESET_MODE } from '../theme'
import s from './SettingsView.module.scss'

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
  { icon: <TgIcon name="devices" size={24} />, label: 'Devices' },
  { icon: <TgIcon name="language" size={24} />, label: 'Language', value: 'English' },
  { icon: <TgIcon name="keyboard" size={24} />, label: 'Keyboard Shortcuts' },
]

export default function SettingsView({
  onBack,
  onToggleMode,
  chats,
  initialSub,
}: {
  onBack: () => void
  onToggleMode: (coords?: { x: number; y: number }) => void
  /** список чатов — нужен экранам папок (счётчики, выбор чатов) */
  chats?: import('../data').Chat[]
  /** сразу открыть под-экран (deep-open из контекстного меню папок) */
  initialSub?: string
}) {
  const t = useT()
  const [lang] = useLang()
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? 'English'
  const { themeChoice } = useSettings()
  const isDark = PRESET_MODE[resolvePreset(themeChoice)] === 'dark'
  const [active, setActive] = useState(initialSub ?? 'Notifications and Sounds')
  const [sub, setSub] = useState<string | null>(initialSub ?? null)
  const [editProfile, setEditProfile] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const me = useChatsStore((s) => s.me)
  const name = me?.displayName || formatPhone(me?.phone) || ''
  const avatarText = (me?.displayName || me?.phone || '?').trim().charAt(0).toUpperCase()
  const avatarBg = me ? gradientFor(me.id) : 'linear-gradient(135deg,#ff8a5b,#ff6a3d)'
  const avatarSrc = useAvatarSrc(me?.avatarUrl)

  return (
    <motion.div
      className={s.screen}
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.headerTitle}>
          {t('Settings')}
        </Text>
        <IconButton onClick={() => setQrOpen(true)} color="var(--tg-textSecondary)">
          <TgIcon name="qr" />
        </IconButton>
        <IconButton onClick={() => setEditProfile(true)} color="var(--tg-textSecondary)">
          <TgIcon name="edit" />
        </IconButton>
        <IconButton color="var(--tg-textSecondary)">
          <TgIcon name="more" />
        </IconButton>
      </div>

      {/* Scrollable body */}
      <div className={s.body}>
        {/* Avatar + name */}
        <div className={s.profile}>
          <Avatar background={avatarBg} src={avatarSrc} text={avatarText} size={130} />
          <Text size={21} weight={600} color="var(--tg-textPrimary)" className={s.profileName}>
            {name}
          </Text>
          <Text size={14} color="var(--tg-textSecondary)">{t('online')}</Text>
        </div>

        {/* Contact card */}
        <Section>
          <Row
            icon={<TgIcon name="phone" size={24} />}
            label={formatPhone(me?.phone) || '—'}
            sublabel={t('Phone')}
            translate={false}
            onClick={() => setEditProfile(true)}
          />
          {me?.username && (
            <Row
              icon={<TgIcon name="mention" size={24} />}
              label={me.username}
              sublabel={t('Username')}
              translate={false}
              onClick={() => setEditProfile(true)}
            />
          )}
        </Section>

        {/* Appearance — theme toggle */}
        <Section>
          <div className={s.rowClickable} onClick={(e) => onToggleMode({ x: e.clientX, y: e.clientY })}>
            <div className={s.rowIcon}>
              <TgIcon name="darkmode" size={24} color="var(--tg-textSecondary)" />
            </div>
            <Text size={16} color="var(--tg-textPrimary)" className={s.rowBody}>{t('Night Mode')}</Text>
            <TgSwitch checked={isDark} />
          </div>
        </Section>

        {/* Settings list — своя строка ради подсветки активного пункта */}
        <Section>
          {settingsItems.map((it) => (
            <div
              key={it.label}
              className={classNames(s.rowClickable, it.label === active ? s.rowActive : '')}
              onClick={() => {
                setActive(it.label)
                if (hasSubScreen(it.label)) setSub(it.label)
              }}
            >
              <div className={s.rowIcon}>{it.icon}</div>
              <Text size={16} color="var(--tg-textPrimary)" className={s.rowBody}>{t(it.label)}</Text>
              {it.value && (
                <Text size={15} color="var(--tg-textFaint)">
                  {it.label === 'Language' ? currentLangName : t(it.value)}
                </Text>
              )}
            </div>
          ))}
        </Section>

        {/* Premium / Gift */}
        <Section>
          <Row
            icon={<TgIcon name="star_filled" size={24} color="var(--tg-accent)" />}
            label="Telegram Premium"
            onClick={() => setPremiumOpen(true)}
          />
          <Row
            icon={<TgIcon name="gift" size={24} color="var(--tg-textSecondary)" />}
            label="Send a Gift"
            onClick={() => {}}
          />
        </Section>
      </div>

      {/* Sub-screen overlay */}
      <AnimatePresence>
        {sub && <SettingsSubScreen title={sub} onBack={() => setSub(null)} chats={chats} />}
      </AnimatePresence>

      {/* Edit profile overlay */}
      <AnimatePresence>
        {editProfile && <EditProfile onBack={() => setEditProfile(false)} />}
      </AnimatePresence>

      {/* Telegram Premium modal */}
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />

      {/* «QR-код» профиля (tweb myQrCode: t.me/username или t.me/+phone) */}
      <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        url={me?.username ? `https://t.me/${me.username}` : `https://t.me/+${(me?.phone ?? '').replace(/\D/g, '')}`}
        label={me?.username ? `@${me.username}` : name}
        avatar={{ src: avatarSrc, background: avatarBg, text: avatarText }}
      />
    </motion.div>
  )
}
