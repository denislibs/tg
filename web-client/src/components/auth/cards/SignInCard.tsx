// SignInCard — ввод номера телефона (порт карточки tweb `pages/cards/SignInCard.tsx`).
// Хост владеет номером и страной (карточка размонтируется на каждый переход,
// а номер нужен карточке кода) — здесь только ввод, отправка кода и переходы.
import { useRef, useState } from 'react'
import { placeCaretAtEnd } from '../../../shared/lib/caret'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { isWebAuthnSupported, getPasskeyAssertion } from '../../../core/webauthnBrowser'
import MediaHeader from '../MediaHeader'
import { PrimaryButton, SecondaryButton } from '../AuthButton'
import CountryInput from '../CountryInput'
import TelInput from '../TelInput'
import GrowHeightReveal from '../../../shared/ui/GrowHeightReveal'
import { leftPattern, type Country } from '../countries'
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
  // Ошибка — не отдельная строка, а состояние поля: `.error` на инпуте плюс
  // подменённый текст `label` (tweb `telInputField.setError()` + `replaceContent`).
  const [phoneError, setPhoneError] = useState(false)
  const [busy, setBusy] = useState(false)
  const telRef = useRef<HTMLDivElement>(null)

  const phoneDigits = phone.replace(/\D/g, '')
  const canSubmit = phoneDigits.length >= 7 && !busy
  // Как в tweb: код страны — часть значения поля, отдельного текста слева нет.
  const telValue = phone ? `${country.code} ${phone}` : country.code

  const sendCode = async () => {
    if (!canSubmit) return
    setPhoneError(false)
    setBusy(true)
    try {
      await managers.auth.requestCode(fullPhone)
      onCodeSent()
    } catch {
      setPhoneError(true)
    } finally {
      setBusy(false)
    }
  }

  // tweb `countryInputField.onCountryChange`: после выбора страны фокус
  // возвращается в поле телефона, каретка — в конец (без этого `focus()` на
  // contenteditable ставит её в НАЧАЛО и следующая цифра уходит перед кодом).
  const pickCountry = (c: Country) => {
    onCountryChange(c)
    setTimeout(() => {
      const el = telRef.current
      if (el) placeCaretAtEnd(el)
    }, 0)
  }

  // Вход по ключу доступа (WebAuthn discoverable credential): без телефона.
  const passkeyLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      onComplete()
    } catch {
      // tweb PasskeyLoginButton показывает тост и остаётся на карточке; поле
      // телефона к этой ошибке отношения не имеет и в error не уходит.
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
          {/* В tweb строка `Login.StartText` несёт перевод строки, и i18n рисует
              его как `<br>` внутри `span.i18n` — отсюда две строки подзаголовка. */}
          <span className="i18n">
            {t('Please confirm your country code')}
            <br />
            {t('and enter your phone number.')}
          </span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      {/* tweb: SignInCard сам рисует `.input-wrapper`, чтобы кнопки «QR» и
          «passkey» остались СНАРУЖИ грида полей. */}
      <div className="input-wrapper">
        {/* селектор страны — полный список tweb countryInputField */}
        <CountryInput value={country} onChange={pickCountry} />

        <TelInput
          autoFocus
          elementRef={telRef}
          value={telValue}
          leftPattern={leftPattern(country, telValue)}
          error={phoneError}
          label={phoneError ? t('Phone Number Invalid') : t('Phone Number')}
          onInput={(raw) => {
            setPhoneError(false)
            onPhoneInput(raw)
          }}
          onEnter={() => void sendCode()}
        />

        <PrimaryButton disabled={!canSubmit} onClick={() => void sendCode()}>
          {t('Next')}
        </PrimaryButton>
        {/* tweb: следом здесь идёт `GrowHeightReveal` с LanguageChangeButton
            («Продолжить на русском»). Не заводим — у нас нет его данных
            (suggested lang code от сервера), это был бы мёртвый узел. */}
      </div>

      <SecondaryButton arrow onClick={onSignQR}>
        {t('Log in by QR Code')}
      </SecondaryButton>
      <GrowHeightReveal when={isWebAuthnSupported()}>
        <SecondaryButton arrow disabled={busy} onClick={() => void passkeyLogin()}>
          {t('Log in with a Passkey')}
        </SecondaryButton>
      </GrowHeightReveal>
    </div>
  )
}
