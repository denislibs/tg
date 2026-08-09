// PasswordCard — облачный пароль, 2FA (порт карточки tweb
// `pages/cards/PasswordCard.tsx`): обезьянка подглядывает при показе пароля,
// поле с «глазком», кнопка Next.
//
// В tweb с этой карточки назад не уходят: там есть только «Forgot Password?»
// (восстановление по e-mail) — у нашего бэкенда такого эндпоинта нет, поэтому
// ссылку не рендерим (мёртвый узел).
import { useState } from 'react'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import PasswordMonkey from '../../PasswordMonkey'
import MediaHeader from '../MediaHeader'
import { PrimaryButton } from '../AuthButton'
import s from '../AuthFlow.module.scss'

export interface PasswordCardProps {
  /** одноразовый токен из sign_in (SESSION_PASSWORD_NEEDED) */
  token: string
  /** подсказка к паролю с сервера (может быть пустой) */
  hint: string
  /** вход завершён */
  onComplete: () => void
}

export default function PasswordCard({ token, hint, onComplete }: PasswordCardProps) {
  const t = useT()
  const managers = useManagers()

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const submitPassword = async () => {
    if (busy || !password) return
    setError('')
    setBusy(true)
    try {
      await managers.auth.checkPassword(token, password, 'web', 'browser')
      onComplete()
    } catch {
      setError(t('Invalid password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={classNames(s.card, s.pagePassword)}>
      <MediaHeader>
        <MediaHeader.Sticker size={130}>
          <PasswordMonkey peeking={showPw} />
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{t('Enter Your Password')}</span>
        </MediaHeader.Title>
        {/* без `.secondary` — в tweb подзаголовок этой карточки белый */}
        <MediaHeader.Subtitle>
          <span className="i18n">{t('Your account is protected with an additional password.')}</span>
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
            autoComplete="off"
            required
            value={password}
            onChange={(e) => {
              setError('')
              setPassword(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPassword()
            }}
          />
          <input className="stealthy" type="password" tabIndex={-1} aria-hidden />
          <div className="input-field-border" />
          {/* в tweb в label лежит подсказка к паролю (state.hint); ошибку показывает
              класс `.error` на поле — отдельной строки ошибки на этой карточке нет */}
          <label>
            <span className="i18n">{error || hint || t('Password')}</span>
          </label>
          <span
            className="toggle-visible"
            onClick={() => setShowPw((v) => !v)}
            role="button"
            aria-label={t('Password')}
          >
            <TgIcon name={showPw ? 'eye2' : 'eye1'} size="1.5rem" />
          </span>
        </div>

        <PrimaryButton disabled={!password} onClick={() => void submitPassword()}>
          {t('Next')}
        </PrimaryButton>
      </div>
    </div>
  )
}
