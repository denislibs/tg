import { useEffect, useRef, useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import Input from '../../shared/ui/Input'
import Spinner from '../../shared/ui/Spinner'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { useAvatarSrc } from '../useAvatarSrc'
import BirthdayModal from './BirthdayModal'
import AvatarCropper from './AvatarCropper'
import { useT, useLang } from '../../i18n'
import { SettingsScreen, Section, Row } from './kit'
import s from './EditProfile.module.scss'
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
  const t = useT()
  const [lang] = useLang()
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
    unameState === 'available' ? '#4dcd5e' : unameState === 'taken' || unameState === 'invalid' ? '#ff595a' : 'var(--tg-textSecondary)'

  const onCropConfirm = async (blob: Blob, width: number, height: number) => {
    setCropFile(null)
    setUploading(true)
    try {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      // Add to the profile-photo gallery; the backend promotes it to the current
      // avatar, so we reflect the new avatar_url in the store optimistically.
      const photo = await managers.profile.addPhoto(mediaId)
      if (me) setMe({ ...me, avatarUrl: photo.url })
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
        <IconButton onClick={onDone} disabled={saving} color="var(--tg-accent)">
          {saving ? <Spinner size={22} color="var(--tg-accent)" /> : <TgIcon name="check" />}
        </IconButton>
      }
    >
      {/* avatar with camera overlay */}
      <div className={s.avatarWrap}>
        <div className={s.avatar} onClick={() => fileInputRef.current?.click()}>
          <Avatar background={avatarBg} src={avatarSrc} text={avatarText} size="profile" />
          <div className={s.avatarOverlay}>
            {uploading ? <Spinner size={36} color="#fff" /> : <TgIcon name="camera" size={40} color="#fff" />}
          </div>
        </div>
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
      </div>

      {/* name / last / bio + birthday */}
      <div className={`${s.card} ${s.form}`}>
        <Input label={t('Name')} value={first} onChange={setFirst} />
        <Input label={t('Last name')} value={last} onChange={setLast} />
        <Input label={t('Bio (optional)')} value={bio} onChange={(v) => setBio(v.slice(0, BIO_MAX))} />
        <div className={s.bday} onClick={() => setBdayOpen(true)}>
          <TgIcon name="gift" size={24} color="var(--tg-textSecondary)" />
          <Text size={16} color={birthday ? 'var(--tg-textPrimary)' : 'var(--tg-accent)'}>
            {birthday ? formatBirthday(birthday, lang) : t('Add birthday')}
          </Text>
        </div>
      </div>
      <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px', lineHeight: 1.45 }}>
        {t('Any details such as age, occupation or city. Example: 23 y.o. designer from San Francisco.')}
      </Text>

      {/* username */}
      <Text size={14} weight={600} color="var(--tg-accent)" className={s.usernameCaption}>
        {t('Username')}
      </Text>
      <div className={s.card}>
        <Input
          label={t('Username (optional)')}
          value={username}
          onChange={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        />
      </div>
      {usernameMsg && (
        <Text size={14} color={usernameColor} style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px', lineHeight: 1.45 }}>
          {usernameMsg}
        </Text>
      )}
      <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px', lineHeight: 1.45 }}>
        {t('You can choose a public username so people can find you and contact you without knowing your phone number.')}
      </Text>

      {/* phone-number visibility (privacy) */}
      <div className={s.phoneWrap}>
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
      </div>

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
