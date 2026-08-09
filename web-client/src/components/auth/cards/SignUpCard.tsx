// SignUpCard — регистрация нового номера (порт карточки tweb
// `pages/cards/SignUpCard.tsx`). Сюда ведёт ветка `signup_required` из
// `POST /auth/sign_in`: номер подтверждён кодом, аккаунта под ним ещё нет.
//
// Дерево 1:1 с живым tweb (dom-референс §2.5):
//
//   div.card.pageSignUp
//     div                                   ← MediaHeader
//       div.sticker[style="--sticker-size: 120px"]
//         div.avatar-edit
//           canvas.avatar-edit-canvas#canvas-avatar
//           span.avatar-edit-icon.tgico
//       div.title.text-center.text-overflow-wrap > span.i18n   ← живой предпросмотр ФИО
//       div.subtitle.text-center > span.i18n > br              ← БЕЗ .secondary
//     div.input-wrapper
//       div.input-field × 2
//       button.btn-primary.btn-color-primary.rp
//
// Аватар только ВЫБИРАЕТСЯ до сабмита, а заливается уже под выданной сессией —
// ровно как в tweb, где `sendAvatar()` живёт в ветке `auth.authorization`.
// Ошибку tweb не выносит отдельной строкой: текст уезжает в надпись кнопки
// (`setSignUpKey(err.type)`) — здесь так же.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import AvatarCropper from '../../settings/AvatarCropper'
import MediaHeader from '../MediaHeader'
import InputField from '../InputField'
import { PrimaryButton } from '../AuthButton'
import superFormatter from '../superFormatter'
import s from '../AuthFlow.module.scss'

export interface SignUpCardProps {
  /** одноразовый токен регистрации из sign_in */
  token: string
  /** токен сгорел (истёк / номер заняли) — назад на ввод номера */
  onTokenLost: () => void
  /** вход завершён */
  onComplete: () => void
}

// tweb MediaHeader.Sticker size={120} на этой карточке (не 130).
const AVATAR_SIZE = 120

// tweb InputField maxLength: FirstName 70, LastName 64.
const FIRST_MAX = 70
const LAST_MAX = 64

export default function SignUpCard({ token, onTokenLost, onComplete }: SignUpCardProps) {
  const t = useT()
  const managers = useManagers()

  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  // Выбранный аватар ждёт сессии: до неё грузить некуда (ручки профиля под Bearer).
  const avatarRef = useRef<{ blob: Blob; width: number; height: number } | null>(null)

  // tweb: тайтл карточки — живой предпросмотр ФИО, пусто → «Your Name».
  const fullName = `${first} ${last}`.trim()

  const tooLong = [...first].length > FIRST_MAX || [...last].length > LAST_MAX
  const nextLabel = busy ? t('Please wait...') : errorKey ? t(errorKey) : t('Start Messaging')

  // tweb PopupAvatar: выбранный кадр рисуется в ту самую канву-предпросмотр,
  // что лежит в `.avatar-edit`, а сам файл придерживается до авторизации.
  const onCropConfirm = (blob: Blob, width: number, height: number) => {
    setCropFile(null)
    avatarRef.current = { blob, width, height }
    const canvas = canvasRef.current
    if (!canvas) return
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = AVATAR_SIZE * dpr
      canvas.height = AVATAR_SIZE * dpr
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  // tweb `sendAvatar()` — вызывается ПОСЛЕ `auth.authorization`, отказ не блокирует
  // вход (`.finally(() => toIm())`). Ручки — те же, что у экрана «Изменить профиль»
  // (`media.upload` → `profile.addPhoto`: фото попадает в галерею и становится аватаром).
  const sendAvatar = async () => {
    const picked = avatarRef.current
    if (!picked) return
    try {
      const bytes = await picked.blob.arrayBuffer()
      const mediaId = await managers.media.upload({
        bytes, mime: 'image/jpeg', size: picked.blob.size, width: picked.width, height: picked.height,
      })
      await managers.profile.addPhoto(mediaId)
    } catch {
      // аватар — не повод не пустить в мессенджер (tweb: `.finally`)
    }
  }

  const submit = async () => {
    if (busy || tooLong) return
    if (!first.trim()) {
      setErrorKey('Please enter your name')
      return
    }
    setBusy(true)
    setErrorKey('')
    const res = await managers.auth.signUp(token, first.trim(), last.trim(), 'web', 'browser')
    if ('user' in res) {
      await sendAvatar()
      onComplete()
      return
    }
    setBusy(false)
    // Токена больше нет — единственный путь дальше это заново подтвердить номер.
    if (res.error === 'signup_token_expired' || res.error === 'phone_number_occupied') {
      onTokenLost()
      return
    }
    setErrorKey(
      res.error === 'first_name_required'
        ? 'Please enter your name'
        : res.error === 'name_too_long'
          ? 'Name is too long'
          : res.error === 'too_many_requests'
            ? 'Too many attempts. Please try again later.'
            : 'Something went wrong. Try again.',
    )
  }

  return (
    <div className={classNames(s.card, s.pageSignUp)}>
      <MediaHeader>
        <MediaHeader.Sticker size={AVATAR_SIZE}>
          {/* Размер `.avatar-edit` у нас завязан на `--sticker-size` родителя —
              в самом tweb правило живёт под `.page-chats` и на auth не действует,
              отчего аватар там схлопнут по высоте (см. `styles/tweb/_bridge.scss`). */}
          <div className="avatar-edit" onClick={() => fileRef.current?.click()}>
            <canvas ref={canvasRef} id="canvas-avatar" className="avatar-edit-canvas" />
            <TgIcon name="cameraadd" className="avatar-edit-icon" size="3rem" />
          </div>
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{fullName || t('Your Name')}</span>
        </MediaHeader.Title>
        {/* без `.secondary` — как у tweb на этой карточке */}
        <MediaHeader.Subtitle>
          <span className="i18n">{superFormatter(t('Enter your name and\nadd a profile photo'))}</span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <div className="input-wrapper">
        <InputField
          autoFocus
          value={first}
          maxLength={FIRST_MAX}
          label={t('First name (required)')}
          onInput={(v) => {
            setErrorKey('')
            setFirst(v)
          }}
          onEnter={() => void submit()}
        />
        <InputField
          value={last}
          maxLength={LAST_MAX}
          label={t('Last name (optional)')}
          onInput={(v) => {
            setErrorKey('')
            setLast(v)
          }}
          onEnter={() => void submit()}
        />
        <PrimaryButton loading={busy} disabled={busy || tooLong} onClick={() => void submit()}>
          {nextLabel}
        </PrimaryButton>
      </div>

      {/* Выбор файла и кадрирование — ВНЕ `#auth-pages`: в tweb это `PopupAvatar`,
          попап в конце `body`. Держим порталом, чтобы дерево карточки осталось
          дословным. */}
      {createPortal(
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) setCropFile(f)
            }}
          />
          {cropFile && (
            <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={onCropConfirm} />
          )}
        </>,
        document.body,
      )}
    </div>
  )
}
