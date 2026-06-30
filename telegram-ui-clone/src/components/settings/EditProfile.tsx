import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, TextField, Typography, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { useAvatarSrc } from '../useAvatarSrc'
import BirthdayModal from './BirthdayModal'
import AvatarCropper from './AvatarCropper'
import { useT, useLang } from '../../i18n'
import { SettingsScreen, Section, Row, useCardBg, useFieldSx } from './kit'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { gradientFor } from '../../core/dialogToChat'
import type { Birthday, PhoneVisibility } from '../../core/managers/authManager'

const BIO_MAX = 70
const USERNAME_RE = /^[a-z0-9_]{5,32}$/

type UnameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'tooShort'

const PHONE_VIS: { key: PhoneVisibility; label: string }[] = [
  { key: 'everybody', label: 'Everybody' },
  { key: 'contacts', label: 'My Contacts' },
  { key: 'nobody', label: 'Nobody' },
]

function formatBirthday(b: Birthday, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = b.year
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' }
  return new Date(b.year ?? 2000, b.month - 1, b.day).toLocaleDateString(lang, opts)
}

export default function EditProfile({ onBack }: { onBack: () => void }) {
  const managers = useManagers()
  const tg = useTheme().tg
  const t = useT()
  const [lang] = useLang()
  const cardBg = useCardBg()
  const fieldSx = useFieldSx()
  const me = useChatsStore((s) => s.me)
  const setMe = useChatsStore((s) => s.setMe)

  const [first, setFirst] = useState(me?.firstName ?? '')
  const [last, setLast] = useState(me?.lastName ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const [username, setUsername] = useState(me?.username ?? '')
  const [birthday, setBirthday] = useState<Birthday | null>(me?.birthday ?? null)
  const [phoneVis, setPhoneVis] = useState<PhoneVisibility>(me?.phoneVisibility ?? 'contacts')
  const [bdayOpen, setBdayOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unameState, setUnameState] = useState<UnameState>('idle')
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const avatarSrc = useAvatarSrc(me?.avatarUrl)
  const avatarBg = me ? gradientFor(me.id) : 'linear-gradient(135deg,#ff8a5b,#ff6a3d)'
  const avatarText = (first || me?.displayName || me?.phone || 'Д').trim().charAt(0).toUpperCase()

  const uname = username.trim().toLowerCase()
  const usernameChanged = uname !== (me?.username ?? '')

  // Debounced availability check for a changed, well-formed username.
  useEffect(() => {
    if (!usernameChanged || uname.length === 0) {
      setUnameState('idle')
      return
    }
    if (!USERNAME_RE.test(uname)) {
      setUnameState(uname.length < 5 ? 'tooShort' : 'invalid')
      return
    }
    setUnameState('checking')
    const id = window.setTimeout(() => {
      void managers.profile.checkUsername(uname).then((r) => {
        setUnameState(r.available ? 'available' : 'taken')
      })
    }, 400)
    return () => window.clearTimeout(id)
  }, [uname, usernameChanged, managers])

  const usernameMsg =
    unameState === 'checking'
      ? t('Checking…')
      : unameState === 'available'
        ? t('This username is available.')
        : unameState === 'taken'
          ? t('This username is already taken.')
          : unameState === 'tooShort'
            ? t('Minimum 5 characters.')
            : unameState === 'invalid'
              ? t('Username must be 5–32 chars: letters, digits, underscore.')
              : ''
  const usernameColor =
    unameState === 'available' ? '#4dcd5e' : unameState === 'taken' || unameState === 'invalid' ? '#ff595a' : tg.textSecondary

  const onCropConfirm = async (blob: Blob, width: number, height: number) => {
    setCropFile(null)
    setUploading(true)
    try {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      const updated = await managers.profile.setAvatar(mediaId)
      setMe(updated)
    } finally {
      setUploading(false)
    }
  }

  const onDone = async () => {
    if (saving || !first.trim()) return
    setSaving(true)
    try {
      if (usernameChanged) {
        const res = await managers.profile.setUsername(uname)
        if ('taken' in res) {
          setUnameState('taken')
          setSaving(false)
          return
        }
        if ('invalid' in res) {
          setUnameState('invalid')
          setSaving(false)
          return
        }
      }
      const updated = await managers.profile.update({
        firstName: first.trim(),
        lastName: last.trim(),
        bio,
        birthday,
        phoneVisibility: phoneVis,
      })
      setMe(updated)
      onBack()
    } catch {
      setSaving(false)
    }
  }

  return (
    <SettingsScreen
      title="Edit Profile"
      onBack={onBack}
      headerRight={
        <IconButton onClick={onDone} disabled={saving} color={tg.accent}>
          {saving ? <CircularProgress size={22} sx={{ color: tg.accent }} /> : <TgIcon name="check" />}
        </IconButton>
      }
    >
      {/* avatar with camera overlay */}
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
        <Box sx={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
          <Avatar background={avatarBg} src={avatarSrc} text={avatarText} size="profile" />
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
            {uploading ? (
              <CircularProgress size={36} sx={{ color: '#fff' }} />
            ) : (
              <TgIcon name="camera" size={40} color="#fff" />
            )}
          </Box>
        </Box>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setCropFile(f)
            e.target.value = '' // allow re-picking the same file
          }}
        />
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
          onClick={() => setBdayOpen(true)}
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
          <TgIcon name="gift" size={24} color={tg.textSecondary} />
          <Typography sx={{ fontSize: 16, color: birthday ? tg.textPrimary : tg.accent }}>
            {birthday ? formatBirthday(birthday, lang) : t('Add birthday')}
          </Typography>
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
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          sx={fieldSx}
        />
      </Box>
      {usernameMsg && (
        <Typography sx={{ px: 3, pt: 1, fontSize: 14, color: usernameColor, lineHeight: 1.45 }}>
          {usernameMsg}
        </Typography>
      )}
      <Typography sx={{ px: 3, pt: 1, fontSize: 14, color: tg.textSecondary, lineHeight: 1.45 }}>
        {t('You can choose a public username so people can find you and contact you without knowing your phone number.')}
      </Typography>

      {/* phone-number visibility (privacy) */}
      <Box sx={{ pt: 2 }}>
        <Section caption="Who can see my phone number">
          {PHONE_VIS.map((o) => (
            <Row
              key={o.key}
              label={o.label}
              onClick={() => setPhoneVis(o.key)}
              selected={phoneVis === o.key}
            />
          ))}
        </Section>
      </Box>

      <BirthdayModal
        open={bdayOpen}
        initial={birthday}
        onClose={() => setBdayOpen(false)}
        onSave={(b) => {
          setBirthday(b)
          setBdayOpen(false)
        }}
      />

      {cropFile && (
        <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={onCropConfirm} />
      )}
    </SettingsScreen>
  )
}
