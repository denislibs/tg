// PasswordCard — облачный пароль, 2FA (порт карточки tweb
// `pages/cards/PasswordCard.tsx` + `components/passwordInputField.ts`):
// обезьянка подглядывает при показе пароля, поле с `stealthy`-ловушками
// автозаполнения и «глазком» `span.toggle-visible`, кнопка Next.
//
// Ошибку tweb не выносит отдельной строкой: на поле вешается `.error`, а текст
// уезжает в НАДПИСЬ КНОПКИ (`setNextKey('PASSWORD_HASH_INVALID')`) — здесь так же.
//
// «Forgot Password?» — `span.i18n.forgotLink > a[href="#"]` между полем и кнопкой,
// ведёт на восстановление по e-mail (`passwordManager.requestRecovery` → карточка
// emailRecover). Почты к аккаунту нет (`PASSWORD_RECOVERY_NA`) — tweb предлагает
// СБРОСИТЬ АККАУНТ: две подтверждающие плашки подряд (`SimpleConfirmationPopup`
// «Reset Password / NoEmailText / Reset Account», затем «Warning / This action
// can't be undone…»), потом `deleteAccount('Forgot password')` и возврат на
// карточку ввода номера. Отказ сервера — третья плашка «Sorry».
import { useState } from 'react'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { confirmationPopup } from '../../popups/popupPeer'
import PasswordMonkey from '../../PasswordMonkey'
import MediaHeader from '../MediaHeader'
import { PrimaryButton } from '../AuthButton'
import superFormatter from '../superFormatter'
import s from '../AuthFlow.module.scss'

/** Чем кончился запрос кода восстановления: '' — ушли на карточку emailRecover. */
export type ForgotOutcome =
  | ''
  | 'password_recovery_na'
  | 'password_token_expired'
  | 'resend_too_soon'
  | 'unavailable'
  | 'failed'

/** Чем кончился сброс аккаунта: '' — аккаунт сброшен, хост увёл на signIn. */
export type ResetOutcome = '' | 'password_token_expired' | 'recovery_available' | 'failed'

export interface PasswordCardProps {
  /** одноразовый токен из sign_in (SESSION_PASSWORD_NEEDED) */
  token: string
  /** подсказка к паролю с сервера (может быть пустой) */
  hint: string
  /** «Forgot Password?» — хост шлёт код на почту и уводит на emailRecover */
  onForgot: () => Promise<ForgotOutcome>
  /** сброс аккаунта (почта не привязана): хост дёргает сервер и уводит на signIn */
  onResetAccount: () => Promise<ResetOutcome>
  /** вход завершён */
  onComplete: () => void
}

// tweb mediaSizes.isMobile ? 100 : 130
const MONKEY_SIZE = 130

export default function PasswordCard({
  token,
  hint,
  onForgot,
  onResetAccount,
  onComplete,
}: PasswordCardProps) {
  const t = useT()
  const managers = useManagers()

  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  // Отказ восстановления по почте — тоже в надпись кнопки, отдельной строки под
  // него в tweb нет (`._forgotLink` несёт только саму ссылку).
  const [forgotError, setForgotError] = useState('')

  // Надпись кнопки — как в tweb `nextKey`: Next → Please wait… → текст ошибки.
  const nextLabel = busy
    ? t('Please wait...')
    : error
      ? t('Incorrect password')
      : forgotError
        ? t(forgotError)
        : t('Next')

  // Плашка отказа сервера — tweb «Sorry» (третья плашка сброса), звана и от
  // самого сброса, и от несостоявшегося (см. resetAccount ниже) — общий вызов,
  // а не дублирование JSX, которое было у трёх снесённых `<ConfirmPopup>`.
  const sorry = (message: string) => {
    void confirmationPopup({
      titleLangKey: t('Sorry'),
      descriptionLangKey: message,
      button: { text: t('OK') },
    }).catch(() => {})
  }

  // Второе подтверждение принято — сбрасываем. Успех уводит на карточку номера
  // (это делает хост), отказ показываем плашкой «Sorry».
  const resetAccount = async () => {
    setBusy(true)
    const outcome = await onResetAccount()
    setBusy(false)
    if (!outcome) return
    sorry(
      outcome === 'recovery_available'
        ? t('A recovery email is linked to this account — reset it by email instead.')
        : outcome === 'password_token_expired'
          ? t('Session expired. Please sign in again.')
          : t('Something went wrong. Try again.'),
    )
  }

  const forgot = async () => {
    if (busy) return
    setForgotError('')
    setBusy(true)
    const outcome = await onForgot()
    setBusy(false)
    // Почты нет — tweb вместо ошибки предлагает сбросить аккаунт: две
    // подтверждающие плашки подряд (`confirmationPopup`, порт tweb
    // `SimpleConfirmationPopup`, см. докблок файла) — вторая только если
    // подтвердили первую (`await` цепочкой, а не двумя `resetStep`).
    if (outcome === 'password_recovery_na') {
      try {
        await confirmationPopup({
          titleLangKey: t('Reset Password'),
          descriptionLangKey: t(
            "Since you didn't provide a recovery email when setting up your password, your remaining options are either to remember your password or to reset your account.",
          ),
          button: { text: t('Reset Account'), isDanger: true },
        })
      } catch { return } // Cancel/оверлей/Esc/Back — тот же исход, что onClose у снесённого попапа
      try {
        // `\n\n` в оригинальной строке (styles/tweb) давал абзацный отступ
        // через `superFormatter`/`<br/>` — у `confirmationPopup` описание
        // всегда plain-text (см. докблок `popupPeer.ts`), перевод схлопнет
        // двойной перенос в пробел. Косметическое расхождение на редком
        // экране (сброс аккаунта без привязанной почты), решили не портировать
        // rich-описание ради одной строки.
        await confirmationPopup({
          titleLangKey: t('Warning'),
          descriptionLangKey: t("This action can't be undone.\n\nIf you reset your account, all your messages and chats will be deleted."),
          button: { text: t('Reset Account'), isDanger: true },
        })
      } catch { return }
      void resetAccount()
      return
    }
    if (outcome === 'password_token_expired') {
      setForgotError('Session expired. Please sign in again.')
      return
    }
    if (outcome) setForgotError('Something went wrong. Try again.')
  }

  const submitPassword = async () => {
    if (busy) return
    if (!password) {
      setError(true)
      return
    }
    setBusy(true)
    try {
      await managers.auth.checkPassword(token, password, 'web', 'browser')
      onComplete()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={classNames(s.card, s.pagePassword)}>
      <MediaHeader>
        <MediaHeader.Sticker size={MONKEY_SIZE}>
          {/* tweb: `._sticker > monkeyContainer > .media-sticker-wrapper` */}
          <div>
            <PasswordMonkey peeking={showPw} size={MONKEY_SIZE} />
          </div>
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{t('Enter Your Password')}</span>
        </MediaHeader.Title>
        {/* без `.secondary` — в tweb подзаголовок этой карточки белый */}
        <MediaHeader.Subtitle>
          <span className="i18n">
            {superFormatter(t('Your account is protected with\nan additional password'))}
          </span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <div className="input-wrapper">
        <div className={classNames('input-field', 'input-field-password')}>
          {/* ловушки автозаполнения — по одной до и после настоящего поля (tweb) */}
          <input className="stealthy" type="password" tabIndex={-1} aria-hidden />
          <input
            autoFocus
            className={classNames('input-field-input', password ? '' : 'is-empty', error ? 'error' : '')}
            type={showPw ? 'text' : 'password'}
            name="notsearch_password"
            autoComplete="off"
            required
            disabled={busy}
            value={password}
            onChange={(e) => {
              setError(false)
              setForgotError('')
              setPassword(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPassword()
            }}
          />
          <input className="stealthy" type="password" tabIndex={-1} aria-hidden />
          <div className="input-field-border" />
          {/* В tweb в label лежит подсказка к паролю с сервера — как есть, без
              класса `i18n` (это не строка словаря); своя строка `Password`
              подставляется только когда подсказки нет. */}
          <label>{hint ? <span>{hint}</span> : <span className="i18n">{t('Password')}</span>}</label>
          <span
            className="toggle-visible"
            onClick={() => setShowPw((v) => !v)}
            role="button"
            aria-label={t('Password')}
          >
            <TgIcon name={showPw ? 'eye2' : 'eye1'} size="1.5rem" />
          </span>
        </div>

        <span className={classNames('i18n', s.forgotLink)}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              void forgot()
            }}
          >
            {t('Forgot Password?')}
          </a>
        </span>

        <PrimaryButton loading={busy} disabled={busy} onClick={() => void submitPassword()}>
          {nextLabel}
        </PrimaryButton>
      </div>

    </div>
  )
}
