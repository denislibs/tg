// SignInCard — ввод номера телефона (порт карточки tweb `pages/cards/SignInCard.tsx`).
// Хост владеет номером и страной (карточка размонтируется на каждый переход,
// а номер нужен карточке кода) — здесь только ввод, отправка кода и переходы.
import { useState } from 'react'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { isWebAuthnSupported, getPasskeyAssertion } from '../../../core/webauthnBrowser'
import MediaHeader from '../MediaHeader'
import { PrimaryButton, SecondaryButton } from '../AuthButton'
import CountryInput from '../CountryInput'
import type { Country } from '../countries'
import s from '../AuthFlow.module.scss'

export interface SignInCardProps {
  /** выбранная страна (источник истины — хост) */
  country: Country
  /** национальная часть номера, уже отформатированная по маске страны */
  phone: string
  /** полный номер (код страны + цифры) для `auth.sendCode` */
  fullPhone: string
  onCountryChange: (country: Country) => void
  /** сырой ввод поля телефона — форматирование и детект страны делает хост */
  onPhoneInput: (raw: string) => void
  /** код успешно отправлен на `fullPhone` → карточка ввода кода */
  onCodeSent: () => void
  /** уйти на карточку входа по QR */
  onSignQR: () => void
  /** вход завершён (успешный passkey) */
  onComplete: () => void
}

export default function SignInCard({
  country,
  phone,
  fullPhone,
  onCountryChange,
  onPhoneInput,
  onCodeSent,
  onSignQR,
  onComplete,
}: SignInCardProps) {
  const t = useT()
  const managers = useManagers()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const phoneDigits = phone.replace(/\D/g, '')
  const canSubmit = phoneDigits.length >= 7 && !busy
  // Как в tweb: код страны — часть значения поля, отдельного текста слева нет.
  const telValue = phone ? `${country.code} ${phone}` : country.code

  const sendCode = async () => {
    if (!canSubmit) return
    setError('')
    setBusy(true)
    try {
      await managers.auth.requestCode(fullPhone)
      onCodeSent()
    } catch {
      setError(t('Could not send the code. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  // Вход по ключу доступа (WebAuthn discoverable credential): без телефона.
  const passkeyLogin = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      onComplete()
    } catch {
      setError(t('Passkey sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.card}>
      <MediaHeader>
        {/* Логотип — как в tweb: плоский svg 120×120 из спрайта `#logo`
            (`fill: var(--primary-color)`), без круга и без градиента. */}
        <MediaHeader.Sticker size={120} className={s.logoContainer}>
          <svg className={s.logo} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
            <use href="#logo" />
          </svg>
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{t('Sign in to Telegram')}</span>
        </MediaHeader.Title>
        <MediaHeader.Subtitle secondary>
          <span className="i18n">
            {t('Please confirm your country code and enter your phone number.')}
          </span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      {/* tweb: SignInCard сам рисует `.input-wrapper`, чтобы кнопки «QR» и
          «passkey» остались СНАРУЖИ грида полей. */}
      <div className="input-wrapper">
        {/* селектор страны — полный список tweb countryInputField */}
        <CountryInput value={country} onChange={onCountryChange} />

        <div className={classNames('input-field', 'input-field-phone')}>
          <input
            autoFocus
            className={classNames('input-field-input', error ? 'error' : '')}
            inputMode="decimal"
            required
            value={telValue}
            onChange={(e) => {
              setError('')
              onPhoneInput(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendCode()
            }}
          />
          <div className="input-field-border" />
          {/* ошибку tweb показывает не отдельной строкой, а `telInputField.setError()`:
              красная рамка (`.error`) + подменённый текст label */}
          <label>
            <span className="i18n">{error || t('Phone Number')}</span>
          </label>
        </div>

        <PrimaryButton disabled={!canSubmit} onClick={() => void sendCode()}>
          {t('Next')}
        </PrimaryButton>
      </div>

      <SecondaryButton arrow onClick={onSignQR}>
        {t('Log in by QR Code')}
      </SecondaryButton>
      {isWebAuthnSupported() && (
        <SecondaryButton arrow onClick={() => void passkeyLogin()}>
          {t('Log in with a Passkey')}
        </SecondaryButton>
      )}
    </div>
  )
}
