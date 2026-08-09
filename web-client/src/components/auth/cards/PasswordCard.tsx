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
// emailRecover). Ветки «сброс аккаунта» при `PASSWORD_RECOVERY_NA` у нас нет —
// сервер такую операцию не умеет, поэтому отказ показывается надписью кнопки.
import { useState } from 'react'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import PasswordMonkey from '../../PasswordMonkey'
import MediaHeader from '../MediaHeader'
import { PrimaryButton } from '../AuthButton'
import superFormatter from '../superFormatter'
import s from '../AuthFlow.module.scss'

export interface PasswordCardProps {
  /** одноразовый токен из sign_in (SESSION_PASSWORD_NEEDED) */
  token: string
  /** подсказка к паролю с сервера (может быть пустой) */
  hint: string
  /** «Forgot Password?» — хост шлёт код на почту и уводит на emailRecover;
   *  возвращает ключ ошибки для надписи кнопки ('' — ушли на восстановление) */
  onForgot: () => Promise<string>
  /** вход завершён */
  onComplete: () => void
}

// tweb mediaSizes.isMobile ? 100 : 130
const MONKEY_SIZE = 130

export default function PasswordCard({ token, hint, onForgot, onComplete }: PasswordCardProps) {
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

  const forgot = async () => {
    if (busy) return
    setForgotError('')
    setBusy(true)
    setForgotError(await onForgot())
    setBusy(false)
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

        {/* отступление от tweb: в оригинале на время отправки внутрь кнопки
            добавляется `svg.preloader-circular` СОСЕДОМ к `span.i18n`; наш
            AuthButton заворачивает всё содержимое в `span.i18n`, слота под
            соседний узел у него нет — кружок не рисуем (см. отчёт волны). */}
        <PrimaryButton disabled={busy} onClick={() => void submitPassword()}>
          {nextLabel}
        </PrimaryButton>
      </div>
    </div>
  )
}
