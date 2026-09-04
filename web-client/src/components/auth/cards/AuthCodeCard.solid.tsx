/** @jsxImportSource solid-js */
// AuthCodeCard — ввод кода подтверждения. Solid-порт tweb
// `pages/cards/AuthCodeCard.tsx` (343 строки) в объёме нашего REST-бэкенда
// (без MTProto `sentCode`-веток: SMS/App/Call/Fragment/Email-варианты кода,
// сброс почты входа `auth.resetLoginEmail` — предмета на бэкенде нет,
// `POST /auth/request_code` всегда шлёт SMS фиксированной длины).
//
// Кнопки «Далее» на этой карточке в tweb НЕТ: код уходит на сервер, как только
// набрана последняя цифра (`onComplete`/`onFill`). «Назад» к вводу номера
// делает НЕ угловая кнопка, а карандаш рядом с номером в шапке карточки
// (`.phoneEdit` → navigate('signIn')) — портирован 1:1.
//
// ── Обезьянка (`TrackingMonkey`) — ЗАГЛУШКА, не входит в периметр задачи 4 ──
// tweb monkeys/tracking.ts — lottie-анимация (idle+tracking канвы, кадр по
// проценту набранного). У нас есть готовый React-порт (`components/
// TrackingMonkey.tsx`), но Solid-версии нет — задача 4 переносит карточки и
// ПОЛЯ ВВОДА (см. task-4-brief.md), сама анимация — отдельный порт вне этого
// среза. Ниже — статический `div.media-sticker-wrapper` того же контура, что
// у оригинала (`stickerHost`), без канв: вёрстка/размер шапки совпадают,
// анимации нет. Долг зафиксирован здесь тем же приёмом, что и остальные в
// web-client/CLAUDE.md — явной пометкой, а не тихой подменой поведения.
import { createSignal, onMount, type JSX } from 'solid-js'
import { IconTsx } from '@components/iconTsx.solid'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import CodeInput from '../CodeInput.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'authCode' }>

// tweb: `mediaSizes.isMobile ? 100 : 130` — тот же выбор, что уже сделан у
// React-порта этой карточки (без реактивного пересчёта на resize).
const STICKER_SIZE = 130

// Длина кода, который шлёт наш бэкенд — фиксированная (нет предмета
// `sentCode.type.length` на REST). Совпадает с DEV_OTP_CODE (см. корневой
// CLAUDE.md): пятизначный код и в проде, и в dev-обходе.
const CODE_LEN = 5

export default function AuthCodeCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const phone = () => props.spec.payload.phone
  const fullPhone = () => '+' + phone().replace(/\D/g, '')

  const [error, setError] = createSignal<LangPackKey | ''>('')
  const [busy, setBusy] = createSignal(false)
  const [value, setValue] = createSignal('')

  let codeInputEl: HTMLInputElement | undefined
  onMount(() => codeInputEl?.focus())

  // Отдельный аксессор, а не `error() ? i18n(error()) : ''` инлайном: TS не
  // сужает `LangPackKey | ''` между двумя РАЗНЫМИ вызовами геттера сигнала —
  // локальная константа читает сигнал один раз, и сужение работает как обычно.
  const errorLabel = () => {
    const key = error()
    return key ? i18n(key) : ''
  }

  const submitCode = async (code: string) => {
    if (busy()) return
    setError('')
    setBusy(true)
    try {
      const res = await managers.auth.signIn(fullPhone(), code, 'web', 'browser')
      if (res.passwordNeeded) {
        navigate({ name: 'password', payload: { token: res.passwordToken, hint: res.hint } })
        return
      }
      if (res.signUpRequired) {
        navigate({ name: 'signUp', payload: { token: res.signUpToken } })
        return
      }
      void toIm()
    } catch {
      setError('PHONE_CODE_INVALID')
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      class={styles.pageAuthCode}
      inputWrapper={false}
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={STICKER_SIZE}>
            {/* tweb: `._sticker > stickerHost > .media-sticker-wrapper` — см.
                докблок файла про заглушку обезьянки. */}
            <div class="media-sticker-wrapper" />
          </MediaHeader.Sticker>
          <MediaHeader.Title>
            <div class={styles.phoneWrapper}>
              <h4 class={styles.phone}>{phone()}</h4>
              {/* tweb .phoneEdit: правка номера — единственный путь назад отсюда */}
              <span
                class={styles.phoneEdit}
                onClick={() => navigate({ name: 'signIn' })}
                role="button"
                aria-label={I18n.format('Edit', true)}
              >
                <IconTsx icon="edit" style={{ 'font-size': '1.5rem' }} />
              </span>
            </div>
          </MediaHeader.Title>
          <MediaHeader.Subtitle secondary>{i18n('Login.Code.SentSms')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <CodeInput
        class={styles.codeInputField}
        ref={(el) => (codeInputEl = el)}
        length={CODE_LEN}
        value={value()}
        onChange={(v) => {
          setError('')
          setValue(v)
        }}
        onComplete={(v) => void submitCode(v)}
        error={!!error()}
        disabled={busy()}
      />

      {/* высота зарезервирована всегда — появление ошибки не двигает раскладку
          (tweb .errorLabel height: 1lh) */}
      <div class={styles.errorLabel}>{errorLabel()}</div>
    </AuthCard>
  )
}
