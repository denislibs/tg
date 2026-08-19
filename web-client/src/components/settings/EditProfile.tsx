import { useEffect, useRef, useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import Input from '../../shared/ui/Input'
import Spinner from '../../shared/ui/Spinner'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import BirthdayModal from './BirthdayModal'
import AvatarCropper from './AvatarCropper'
import { useT, useLang } from '../../i18n'
import { SettingsScreen } from './kit'
import s from './EditProfile.module.scss'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { gradientFor } from '../../core/dialogToChat'
import type { Birthday } from '../../core/peers/peer'
import { getPeerPhotoId, getPeerPhotoStrippedThumb } from '../../core/peers/peer'
import { getUserTitle } from '../../core/peers/getPeerTitle'
import { formatBirthday } from '../../core/format/birthday'

const BIO_MAX = 70
const USERNAME_RE = /^[a-z0-9_]{5,32}$/

type UnameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'tooShort'

export default function EditProfile({ onBack }: { onBack: () => void }) {
  const managers = useManagers()
  const t = useT()
  const [lang] = useLang()
  const me = useChatsStore((s) => s.me)
  const setMe = useChatsStore((s) => s.setMe)

  // Пара конструкторов: имя/фамилия/username живут в кратком `user`, bio и
  // день рождения — в полном `fullUser` (граница схемы, а не наша прежняя).
  const [first, setFirst] = useState(me?.user.first_name ?? '')
  const [last, setLast] = useState(me?.user.last_name ?? '')
  const [bio, setBio] = useState(me?.fullUser.about ?? '')
  const [username, setUsername] = useState(me?.user.username ?? '')
  const [birthday, setBirthday] = useState<Birthday | null>(me?.fullUser.birthday ?? null)
  const [bdayOpen, setBdayOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unameState, setUnameState] = useState<UnameState>('idle')
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const avatarSrc = useMediaUrl(getPeerPhotoId(me?.user.photo) || null)
  const avatarPreview = getPeerPhotoStrippedThumb(me?.user.photo) || undefined
  const avatarBg = me ? gradientFor(me.user.id) : 'linear-gradient(135deg,#ff8a5b,#ff6a3d)'
  const avatarText = (first || (me ? getUserTitle(me.user) : '') || 'Д').trim().charAt(0).toUpperCase()

  const uname = username.trim().toLowerCase()
  const usernameChanged = uname !== (me?.user.username ?? '')

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
    unameState === 'available' ? '#4dcd5e' : unameState === 'taken' || unameState === 'invalid' ? '#ff595a' : 'var(--secondary-text-color)'

  const onCropConfirm = async (blob: Blob, width: number, height: number) => {
    setCropFile(null)
    setUploading(true)
    try {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      // Add to the profile-photo gallery; the backend promotes it to the current
      // avatar, so we reflect the new `user.photo` in the store optimistically.
      const photo = await managers.profile.addPhoto(mediaId)
      // Оптимистичное исключение из «пишет только проектор» (Stage 1C.2, Task 1
      // — см. докблок setMe в chatsStore.ts, stores/noDuplicateMe.test.ts):
      // кроппер закрывается сразу — ждать rt:me из воркера заметно замедлило бы
      // отклик. Воркер (profileManager.addPhoto → onMeChanged, тот же merge
      // {...me, user.photo}) ТОЖЕ разошлёт снимок остальным вкладкам —
      // повторное применение здесь идемпотентно, флика не даёт.
      // Читаем useChatsStore.getState() здесь, а не замыкание рендера, где
      // вызван onCropConfirm — так короче писать, но ЗАЩИТЫ от гонки это
      // почти не даёт (повторное ревью): broadcast профиля уходит внутри
      // менеджера ДО ответа RPC, кадры идут одним портом по порядку — к
      // моменту, когда этот код выполнится, проектор обычно уже успел
      // положить в стор тот же мердж, так что «свежее» здесь и «из замыкания»
      // почти всегда совпадают. Настоящая защита от чужого-устаревшего
      // мерджа — не здесь, а в authManager.ts: fetchMe() публикует свежего
      // пользователя на КАЖДЫЙ успешный /me (не только явные мутации),
      // поэтому кэш ВОРКЕРА (который реально мерджит profileManager.addPhoto)
      // не протухает даже если профиль поменяли с другого устройства между
      // loadChats() и этим addPhoto — см. task-1-report.md.
      const cur = useChatsStore.getState().me
      if (cur) setMe({ ...cur, user: { ...cur.user, photo: { _: 'userProfilePhoto', photo_id: photo.mediaId } } })
    } finally {
      setUploading(false)
    }
  }

  // Видео-аватар (tweb photo_video): захватываем poster-кадр из видео на canvas,
  // грузим оба медиа (poster → media_id, видео → video_media_id) и addPhoto.
  // Заголовок/список чатов остаются на still-постере — playback только в
  // просмотрщике (осознанный лимит MVP).
  const onVideoPick = async (file: File) => {
    setAvatarError(null)
    setUploading(true)
    const objectUrl = URL.createObjectURL(file)
    try {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      video.src = objectUrl
      // Дождаться метаданных, перемотать на кадр (0s часто чёрный) и дождаться seek.
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.currentTime = Math.min(0.1, (video.duration || 0.2) / 2)
        }
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('video load failed'))
      })
      const w = video.videoWidth
      const h = video.videoHeight
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      if (!w || !h) throw new Error('no video dimensions')
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas context')
      ctx.drawImage(video, 0, 0, w, h)
      const posterBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
      if (!posterBlob) throw new Error('poster capture failed')

      const posterBytes = await posterBlob.arrayBuffer()
      const posterId = await managers.media.upload({ bytes: posterBytes, mime: 'image/jpeg', size: posterBlob.size, width: w, height: h })
      const videoBytes = await file.arrayBuffer()
      const videoId = await managers.media.upload({ bytes: videoBytes, mime: file.type, size: file.size, width: w, height: h, duration })
      const photo = await managers.profile.addPhoto(posterId, videoId)
      // Оптимистичное исключение — то же обоснование, что у onCropConfirm выше
      // (включая то, чего чтение стора здесь НЕ гарантирует — см. комментарий там).
      const cur = useChatsStore.getState().me
      if (cur) setMe({ ...cur, user: { ...cur.user, photo: { _: 'userProfilePhoto', photo_id: photo.mediaId } } })
    } catch {
      setAvatarError(t('Could not process this video.'))
    } finally {
      URL.revokeObjectURL(objectUrl)
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
      })
      // Оптимистичное исключение из «пишет только проектор» (Stage 1C.2, Task 1
      // — см. докблок setMe в chatsStore.ts, stores/noDuplicateMe.test.ts):
      // экран сразу закрывается (onBack) — ждать rt:me из воркера заметно
      // замедлило бы отклик. Воркер (profileManager.update → onMeChanged) ТОЖЕ
      // разошлёт тот же снимок остальным вкладкам — повторное применение здесь
      // идемпотентно, флика не даёт.
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
        <IconButton onClick={onDone} disabled={saving} color="var(--primary-color)">
          {saving ? <Spinner size={22} color="var(--primary-color)" /> : <TgIcon name="check" />}
        </IconButton>
      }
    >
      {/* avatar with camera overlay */}
      <div className={s.avatarWrap}>
        <div className={s.avatar} onClick={() => fileInputRef.current?.click()}>
          <Avatar background={avatarBg} src={avatarSrc} preview={avatarPreview} text={avatarText} size="profile" />
          <div className={s.avatarOverlay}>
            {uploading ? <Spinner size={36} color="#fff" /> : <TgIcon name="camera" size={40} color="#fff" />}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Видео → отдельный поток (poster-кадр + двойная загрузка); фото → кроппер.
            if (f) {
              if (f.type.startsWith('video/')) void onVideoPick(f)
              else setCropFile(f)
            }
            e.target.value = '' // allow re-picking the same file
          }}
        />
        {avatarError && (
          <Text size={14} color="#ff595a" style={{ marginTop: '8px', textAlign: 'center' }}>
            {avatarError}
          </Text>
        )}
      </div>

      {/* name / last / bio + birthday */}
      <div className={`${s.card} ${s.form}`}>
        <Input label={t('Name')} value={first} onChange={setFirst} />
        <Input label={t('Last name')} value={last} onChange={setLast} />
        <Input label={t('Bio (optional)')} value={bio} onChange={(v) => setBio(v.slice(0, BIO_MAX))} />
        <div className={s.bday} onClick={() => setBdayOpen(true)}>
          <TgIcon name="gift" size={24} color="var(--secondary-text-color)" />
          <Text size={16} color={birthday ? 'var(--primary-text-color)' : 'var(--primary-color)'}>
            {birthday ? formatBirthday(birthday, lang) : t('Add birthday')}
          </Text>
        </div>
      </div>
      <Text size={14} color="var(--secondary-text-color)" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px', lineHeight: 1.45 }}>
        {t('Any details such as age, occupation or city. Example: 23 y.o. designer from San Francisco.')}
      </Text>

      {/* username */}
      <Text size={14} weight={600} color="var(--primary-color)" className={s.usernameCaption}>
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
      <Text size={14} color="var(--secondary-text-color)" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px', lineHeight: 1.45 }}>
        {t('You can choose a public username so people can find you and contact you without knowing your phone number.')}
      </Text>

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
