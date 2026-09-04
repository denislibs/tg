/** @jsxImportSource solid-js */
// SignUpCard — регистрация нового номера. Solid-порт нашей React
// `cards/SignUpCard.tsx` (которая сама — порт tweb `pages/cards/SignUpCard.tsx`,
// 181 строка). Сюда ведёт ветка `signup_required` из `POST /auth/sign_in`:
// номер подтверждён кодом, аккаунта под ним ещё нет.
//
// Дерево близко к живому tweb/React-версии (dom-референс §2.5 React-версии):
//
//   div.card.pageSignUp
//     div                                   ← MediaHeader
//       div.sticker[style="--sticker-size: 120px"]
//         div.avatar-edit
//           canvas.avatar-edit-canvas#canvas-avatar
//           span.avatar-edit-icon.tgico
//       div.title.text-center.text-overflow-wrap             ← живой предпросмотр ФИО
//       div.subtitle.text-center                              ← БЕЗ .secondary
//     div.input-wrapper
//       div.input-field × 2
//       button.btn-primary.btn-color-primary.rp
//
// Ошибку tweb не выносит отдельной строкой: текст уезжает в надпись кнопки
// (`setSignUpKey(err.type)`) — здесь так же.
//
// ── Аватар: выбор ДО сабмита, заливка УЖЕ ПОД СЕССИЕЙ ────────────────────────
// Ровно как в tweb, где `sendAvatar()` живёт в ветке `auth.authorization`:
// файл выбирается сразу, но грузится ручками профиля (`media.upload` →
// `profile.addPhoto`) только ПОСЛЕ успешного `signUp` — до него грузить
// решительно некуда (ручки профиля под Bearer текущей сессии, а её ещё нет).
// Отказ заливки — НЕ повод не пустить в мессенджер (tweb: `.finally(() =>
// toIm())`) — здесь тот же `try {…} catch {}` вокруг `sendAvatar()`.
//
// ── Интерактивный кроппер — ВНЕ периметра задачи 5 (сознательное сужение) ───
// У tweb выбор аватара — целый `PopupAvatar` (кадрирование/зум/поворот,
// vanilla DOM, framework-agnostic попап). Наша React-версия его тоже не
// портирует 1:1, а использует СВОЙ упрощённый `AvatarCropper` (React-хуки,
// drag-to-pan + zoom) — компонент из другого рантайма, подключить его отсюда
// нельзя (граница `*.solid.tsx` не пускает React), а порт urlaub-кроппера на
// Solid — самостоятельная задача, которой нет ни в брифе, ни в списке файлов
// задачи 5. Здесь выбранный файл грузится КАК ЕСТЬ (без клиентского
// кропа/масштабирования — `UploadArgs.width/height` опциональны, схема это
// разрешает), а `<canvas id="canvas-avatar">` рисует ЛУЧШЕЕ ИЗ ВОЗМОЖНОГО
// live-превью (best-effort через `Image.onload`, декодирование не гарантировано
// во всех окружениях и не участвует в данных отправки — если предпросмотр не
// нарисовался, аватар всё равно загрузится).
import { createSignal, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import { i18n, type LangPackKey } from '@lib/langPack'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import InputField from '../InputField.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'signUp' }>

// tweb MediaHeader.Sticker size={120} на этой карточке (не 130).
const AVATAR_SIZE = 120

// tweb InputField maxLength: FirstName 70, LastName 64.
const FIRST_MAX = 70
const LAST_MAX = 64

export default function SignUpCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const token = () => props.spec.payload.token

  const [first, setFirst] = createSignal('')
  const [last, setLast] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [errorKey, setErrorKey] = createSignal<LangPackKey | ''>('')

  let canvasEl: HTMLCanvasElement | undefined
  let fileEl: HTMLInputElement | undefined
  // Выбранный аватар ждёт сессии — грузить некуда, пока её нет (см. докблок).
  let pickedFile: File | undefined

  // tweb: тайтл карточки — живой предпросмотр ФИО, пусто → «Your Name».
  const fullName = () => `${first()} ${last()}`.trim()
  const tooLong = () => [...first()].length > FIRST_MAX || [...last()].length > LAST_MAX
  const nextLabel = () => {
    if (busy()) return i18n('PleaseWait')
    const key = errorKey()
    return key ? i18n(key) : i18n('StartMessaging')
  }

  const onFileChosen = (file: File) => {
    pickedFile = file
    const canvas = canvasEl
    if (!canvas) return
    // Live-превью — best-effort, см. докблок файла: декодирование картинки
    // не гарантировано во всех окружениях и не участвует в данных отправки.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = AVATAR_SIZE * dpr
      canvas.height = AVATAR_SIZE * dpr
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  // Ручки — те же, что у экрана «Изменить профиль»: фото попадает в галерею
  // и становится аватаром. Отказ НЕ блокирует вход (tweb: `.finally`).
  const sendAvatar = async () => {
    const file = pickedFile
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: file.type || 'image/jpeg', size: bytes.byteLength })
      await managers.profile.addPhoto(mediaId)
    } catch {
      // аватар — не повод не пустить в мессенджер
    }
  }

  const submit = async () => {
    if (busy() || tooLong()) return
    if (!first().trim()) {
      setErrorKey('Login.Register.NameRequired')
      return
    }
    setBusy(true)
    setErrorKey('')
    const res = await managers.auth.signUp(token(), first().trim(), last().trim(), 'web', 'browser')
    if ('user' in res) {
      await sendAvatar()
      void toIm()
      return
    }
    setBusy(false)
    // Токена больше нет — единственный путь дальше это заново подтвердить номер.
    if (res.error === 'signup_token_expired' || res.error === 'phone_number_occupied') {
      navigate({ name: 'signIn' })
      return
    }
    setErrorKey(
      res.error === 'first_name_required'
        ? 'Login.Register.NameRequired'
        : res.error === 'name_too_long'
          ? 'Login.Register.NameTooLong'
          : res.error === 'too_many_requests'
            ? 'Login.Error.FloodWait'
            : 'Login.Error.Generic',
    )
  }

  return (
    <AuthCard
      class={styles.pageSignUp}
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={AVATAR_SIZE}>
            {/* Размер `.avatar-edit` завязан на `--sticker-size` родителя — как
                и у React-версии (в самом tweb правило живёт под `.page-chats` и
                на auth не действует, отчего аватар там схлопнут по высоте). */}
            <div class="avatar-edit" onClick={() => fileEl?.click()}>
              <canvas ref={canvasEl} id="canvas-avatar" class="avatar-edit-canvas" />
              <IconTsx icon="cameraadd" class="avatar-edit-icon" style={{ 'font-size': '3rem' }} />
            </div>
          </MediaHeader.Sticker>
          <MediaHeader.Title>{fullName() || i18n('YourName')}</MediaHeader.Title>
          {/* без .secondary — как у tweb на этой карточке */}
          <MediaHeader.Subtitle>{i18n('Login.Register.Subtitle')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <InputField
        autoFocus
        value={first()}
        maxLength={FIRST_MAX}
        label={i18n('FirstName')}
        onInput={(v) => {
          setErrorKey('')
          setFirst(v)
        }}
        onEnter={() => void submit()}
      />
      <InputField
        value={last()}
        maxLength={LAST_MAX}
        label={i18n('LastName')}
        onInput={(v) => {
          setErrorKey('')
          setLast(v)
        }}
        onEnter={() => void submit()}
      />
      <Button
        class="btn-primary btn-color-primary"
        disabled={busy() || tooLong()}
        onClick={() => void submit()}
      >
        {nextLabel()}
        {busy() && (
          <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
            <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10" />
          </svg>
        )}
      </Button>

      {/* Выбор файла — скрытый инпут ВНЕ .avatar-edit, чтобы клик по иконке не
          дублировался кликом по самому input. */}
      <input
        ref={fileEl}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (f) onFileChosen(f)
        }}
      />
    </AuthCard>
  )
}
