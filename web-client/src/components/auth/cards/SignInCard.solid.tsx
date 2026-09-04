/** @jsxImportSource solid-js */
// SignInCard — ввод номера телефона. Solid-порт tweb `pages/cards/SignInCard.tsx`
// (278 строк): CountryInputField + TelInputField → `auth.sendCode` → карточка
// кода, плюс кнопка QR-входа и кнопка passkey.
//
// ── Карточка владеет страной/телефоном САМА, а не хост ──────────────────────
// У нашей прежней React-реализации (`cards/SignInCard.tsx`) номер/страна жили
// в React-хосте `AuthFlow.tsx` — карточка была «глупой». У ОРИГИНАЛА (и у
// нашего Solid-хоста, см. `authFlow.solid.tsx::CardPayloadMap.signIn = void`)
// каждая карточка самодостаточна: заводит `countryInputField`/`telInputField`
// сама и владеет их состоянием, как здесь.
//
// ── Что НЕ портировано из tweb (нет предмета на REST-бэкенде) ───────────────
// `tryAgain()` — каскад прогрева DC/нетворкеров MTProto (:161-215) — у REST
// нет ни DC, ни нетворкеров; вместо него — тот же приём, что уже был у React-
// хоста: `GET /auth/nearest_country` (`managers.auth.nearestCountry()`)
// подставляет страну по IP, только пока оба поля не тронуты (см. пины ниже).
// `LanguageChangeButton` (:267) — нет предложенного сервером языка на REST.
// `lottieLoader.loadLottieWorkers()` в `onInput` (:75) — прогрев воркера
// lottie нашему упрощённому SVG-логотипу не нужен.
//
// ── Наши расширения (есть предмет, оригинал так не умеет) ───────────────────
// Вход по ключу доступа (`passkeyLogin` ниже) — у tweb это ОТДЕЛЬНЫЙ
// discoverable-flow (`PasskeyLoginButton`: пере-фетч опций на mount, кнопка
// прячется до ответа сервера). У нас MTProto-специфичных `initPasskeyLogin`/
// `finishPasskeyLogin` нет — простой begin/finish поверх REST
// (`managers.auth.passkeyLoginBegin/Finish`, `core/webauthnBrowser.ts`),
// кнопка видна сразу, если браузер поддерживает WebAuthn
// (`isWebAuthnSupported()`). Работает и уже проверено в React-версии — только
// портируем, не изобретаем заново.
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { i18n } from '@lib/langPack'
import { isWebAuthnSupported, getPasskeyAssertion } from '@core/webauthnBrowser'
import { placeCaretAtEnd } from '@shared/lib/caret'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import CountryInput from '../CountryInput.solid'
import TelInput from '../TelInput.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import { COUNTRIES, countryByPhone, leftPattern, phoneMask, type Country } from '../countries'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'signIn' }>

// Страна по умолчанию до ответа сервера — фолбэк, чтобы поле не стартовало
// пустым (см. докблок выше). Ответ `nearestCountry()` перекрывает его, пока
// поля не тронули.
const DEFAULT_COUNTRY = COUNTRIES.find((c) => c.iso2 === 'RU')!

// Порт tweb `helpers/formatPhoneNumber.ts::applyPattern` (ветка national=false)
// в объёме нашего `Country` (один патерн, не список — см. докблок
// `countries.ts::phoneMask`). Дубль того же кода, что уже есть в React
// `AuthFlow.tsx` — намеренно НЕ импортируется оттуда: тот файл снесёт задача 6,
// а Solid-карточке нельзя зависеть от React-хоста (граница рантаймов).
function applyPattern(c: Country, digits: string): string {
  const pattern = phoneMask(c) || c.code.slice(1)
  let str = digits
  pattern.split('').forEach((symbol, idx) => {
    if (symbol === ' ' && str[idx] !== ' ' && str.length > idx) {
      str = str.slice(0, idx) + ' ' + str.slice(idx)
    }
  })
  return str
}

// Порт tweb `formatPhoneNumber`: значение поля целиком МЕЖДУНАРОДНОЕ — из него
// выделяются цифры, по ним определяется страна, остаток группируется её маской.
// Страна не опознана — цифры отдаются как есть (в поле останется «+49…»).
function formatPhoneNumber(raw: string): { formatted: string; country: Country | undefined } {
  const digits = raw.replace(/\D/g, '')
  const country = countryByPhone(digits)
  return { formatted: country ? applyPattern(country, digits) : digits, country }
}

export default function SignInCard(_props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()

  const [country, setCountry] = createSignal<Country | undefined>(DEFAULT_COUNTRY)
  const [phone, setPhone] = createSignal(DEFAULT_COUNTRY.code)
  const [phoneError, setPhoneError] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  // tweb `lastCountrySelected`: явно выбранная из списка страна не должна
  // перебиваться детектом при том же телефонном коде (+7 → RU/KZ).
  let pickedCountry: Country | undefined
  // Поля уже трогали руками — ответ `nearestCountry()` их не перебьёт.
  let touched = false
  let alive = true
  let telEl: HTMLDivElement | undefined

  const fullPhone = () => `+${phone().replace(/\D/g, '')}`
  // tweb `setHasValidInput`: либо код страны опознан, либо в поле уже больше
  // одной цифры.
  const canSubmit = () => (!!country() || phone().replace(/\D/g, '').length > 1) && !busy()

  onMount(() => {
    void managers.auth.nearestCountry().then((iso2) => {
      if (!alive || !iso2 || touched) return
      const detected = COUNTRIES.find((c) => c.iso2 === iso2.toUpperCase())
      if (!detected || detected.iso2 === DEFAULT_COUNTRY.iso2) return
      setCountry(detected)
      setPhone(detected.code)
    })
  })
  onCleanup(() => { alive = false })

  const onPhoneInput = (raw: string) => {
    touched = true
    setPhoneError(false)
    // tweb: одинокий «+» остаётся как есть (иначе поле нельзя очистить до кода).
    if (raw.replace(/\++/, '+') === '+') {
      setPhone('+')
      setCountry(undefined)
      return
    }
    const { formatted, country: detected } = formatPhoneNumber(raw)
    setPhone(formatted ? `+${formatted}` : '')
    setCountry((cur) => {
      // tweb: страна переопределяется, только если реально другая И не спорит
      // с явно выбранной из списка при СОВПАДАЮЩЕМ телефонном коде.
      if (detected?.name === cur?.name) return cur
      if (pickedCountry && detected && pickedCountry.code === detected.code) return cur
      return detected
    })
  }

  // tweb `countryInputField.onCountryChange`: выбор страны СБРАСЫВАЕТ номер в
  // «+код», фокус — обратно в поле телефона, каретка — в конец (без этого
  // `focus()` на contenteditable ставит её в НАЧАЛО, и следующая цифра уходит
  // перед кодом).
  const onCountryChange = (c: Country) => {
    touched = true
    pickedCountry = c
    setCountry(c)
    setPhone(c.code)
    setTimeout(() => {
      if (telEl) placeCaretAtEnd(telEl)
    }, 0)
  }

  const sendCode = async () => {
    if (!canSubmit()) return
    setPhoneError(false)
    setBusy(true)
    try {
      await managers.auth.requestCode(fullPhone())
      navigate({ name: 'authCode', payload: { phone: phone() } })
    } catch {
      setPhoneError(true)
    } finally {
      setBusy(false)
    }
  }

  const passkeyLogin = async () => {
    if (busy()) return
    setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      void toIm()
    } catch {
      // tweb PasskeyLoginButton показывает тост и остаётся на карточке; поле
      // телефона к этой ошибке отношения не имеет и в error не уходит.
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      inputWrapper={false}
      header={
        <MediaHeader>
          {/* Логотип — как в tweb: плоский svg 120×120 из спрайта #logo
              (fill: var(--primary-color)), без круга и без градиента. */}
          <MediaHeader.Sticker size={120} class={styles.logoContainer}>
            <svg class={styles.logo} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
              <use href="#logo" />
            </svg>
          </MediaHeader.Sticker>
          <MediaHeader.Title>
            <span>{i18n('Login.Title')}</span>
          </MediaHeader.Title>
          <MediaHeader.Subtitle secondary>
            {/* Ядро само разворачивает \n словаря в <br> — superFormatter
                (React-версия) здесь не нужен, i18n() уже отдаёт готовый узел. */}
            {i18n('Login.StartText')}
          </MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      {/* tweb: SignInCard сам рисует .input-wrapper, чтобы кнопки «QR» и
          «passkey» остались СНАРУЖИ грида полей. */}
      <div class="input-wrapper">
        <CountryInput value={country() ?? null} onChange={onCountryChange} />

        <TelInput
          autoFocus
          ref={(el) => (telEl = el)}
          value={phone()}
          leftPattern={country() ? leftPattern(country()!, phone()) : ''}
          error={phoneError()}
          label={i18n(phoneError() ? 'Login.PhoneLabelInvalid' : 'Login.PhoneLabel')}
          onInput={onPhoneInput}
          onEnter={() => void sendCode()}
        />

        {/* tweb SignInCard.onSubmit: на отправке содержимое кнопки целиком
            подменяется на PleaseWait + svg.preloader-circular. */}
        <Button class="btn-primary btn-color-primary" disabled={!canSubmit()} onClick={() => void sendCode()}>
          {busy() ? i18n('PleaseWait') : i18n('Login.Next')}
          {busy() && (
            <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
              <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10" />
            </svg>
          )}
        </Button>
      </div>

      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={busy()}
        onClick={() => navigate({ name: 'signQR' })}
        text="Login.QR.Title"
      />
      <Show when={isWebAuthnSupported()}>
        <Button
          class="btn-primary btn-secondary btn-primary-transparent primary"
          disabled={busy()}
          onClick={() => void passkeyLogin()}
          text="Login.Passkey.Action"
        />
      </Show>
    </AuthCard>
  )
}
