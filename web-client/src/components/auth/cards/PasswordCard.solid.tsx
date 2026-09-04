/** @jsxImportSource solid-js */
// PasswordCard — облачный пароль, 2FA. Solid-порт tweb `pages/cards/PasswordCard.tsx`
// (250 строк) + `components/passwordInputField.ts` в объёме нашего REST-бэкенда.
//
// Ошибку tweb не выносит отдельной строкой: на поле вешается `.error`, а текст
// уезжает в НАДПИСЬ КНОПКИ (`setNextKey('PASSWORD_HASH_INVALID')`) — здесь так же.
//
// «Forgot Password?» — `span.i18n.forgotLink > a[href="#"]` между полем и
// кнопкой, ведёт на восстановление по e-mail (`passwordManager.requestRecovery`
// → карточка emailRecover). Почты к аккаунту нет (`PASSWORD_RECOVERY_NA`) — tweb
// предлагает СБРОСИТЬ АККАУНТ: две подтверждающие плашки подряд
// (`SimpleConfirmationPopup` «Reset Password / NoEmailText / Reset Account»,
// затем «Warning / This action can't be undone…»), потом `deleteAccount('Forgot
// password')` и возврат на карточку ввода номера. Отказ сервера — третья
// плашка «Sorry». `SimpleConfirmationPopup`/`PopupPeer` — уже framework-
// agnostic vanilla DOM (`components/popups/popupPeer.ts`, ни строчки React/
// Solid), поэтому используется отсюда напрямую, без порта.
//
// ── Наше расширение против tweb (есть предмет — REST-таксономия ошибок) ─────
// `resend_too_soon` — сервер держит паузу повторной отправки кода
// восстановления; своего таймера клиент не заводит (см. тип `ForgotOutcome` у
// прежней React-версии). Маска почты едет НА ПЕРЕХОДАХ — `authFlow.solid.tsx`
// `CardPayloadMap.password.emailPattern` / `CardPayloadMap.emailRecover.hint`
// — а не в closure/модульном кэше карточки.
//
// РЕВЬЮ ЗАДАЧИ 4 (находка 1): прежняя редакция держала маску closure-
// переменной компонента и была НЕДОСТИЖИМА — карточка размонтируется на
// КАЖДЫЙ `navigate` (хост, `mode="outin"`), значит между «forgot» #1
// (успех → emailRecover) и «forgot» #2 (после Cancel на emailRecover,
// `resend_too_soon`) `PasswordCard` успевает размонтироваться и
// перемонтироваться заново — переменная стартует пустой КАЖДЫЙ раз, условие
// `resend_too_soon && lastEmailPattern` не выполнялось НИКОГДА. ПРАВКА
// ЗАДАЧИ 4 заменила её МОДУЛЬНЫМ `Map` (`recoveryPatternByToken`, ключ —
// `token`) — тот пережил бы перемонтирование, но ревью ЗАДАЧИ 5 признало и
// этот слой неверным: кэш не чистится нигде и живёт до перезагрузки страницы
// целиком, а не до конца попытки входа (в React-версии это состояние умирало
// вместе с хостом). ШТАТНЫЙ путь — `CardPayloadMap`: `forgot()` кладёт маску в
// переход на `emailRecover` (вместе с `hint`, которого там иначе бы не было —
// см. докблок `authFlow.solid.tsx::CardPayloadMap.emailRecover`), а Cancel на
// `emailRecover` везёт её ОБРАТНО сюда тем же способом. Модульного кэша
// (и вообще какого-либо состояния, пережившего `dispose()` карточки) в этом
// файле больше нет.
import { createSignal, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import classNames from '@helpers/string/classNames'
import { confirmationPopup } from '../../popups/popupPeer'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'password' }>

// tweb: `mediaSizes.isMobile ? 100 : 130` — тот же выбор, что и у AuthCodeCard.
const MONKEY_SIZE = 130

export default function PasswordCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const token = () => props.spec.payload.token
  const hint = () => props.spec.payload.hint
  // Маска, привезённая НАЗАД из emailRecover (Cancel) — см. докблок файла.
  // Отсутствует при первом приходе с authCode.
  const cachedPattern = () => props.spec.payload.emailPattern

  const [error, setError] = createSignal(false)
  // tweb PasswordCard.tsx:145-148 (пустая отправка): `passwordInput.classList.
  // add('error'); return` — ТОЛЬКО класс на поле, `nextKey`/надпись кнопки не
  // трогается (сервер вообще не спрашивали, отвечать ему нечем). `error`
  // выше — именно ОТКАЗ СЕРВЕРА (`PASSWORD_HASH_INVALID`) и двигает надпись
  // кнопки; смешивать их в одном сигнале красило бы «Incorrect password» на
  // пустой отправке, которую сервер не видел.
  const [emptyFlash, setEmptyFlash] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [password, setPassword] = createSignal('')
  const [showPw, setShowPw] = createSignal(false)
  // Отказ восстановления по почте — тоже в надпись кнопки, отдельной строки
  // под него в tweb нет (`._forgotLink` несёт только саму ссылку).
  const [forgotError, setForgotError] = createSignal<LangPackKey | ''>('')

  let passwordEl: HTMLInputElement | undefined
  onMount(() => passwordEl?.focus())

  // Надпись кнопки — tweb `nextKey`: Next → Please wait… → текст ошибки.
  const nextLabel = () => {
    if (busy()) return i18n('PleaseWait')
    if (error()) return i18n('PASSWORD_HASH_INVALID')
    const fe = forgotError()
    if (fe) return i18n(fe)
    return i18n('Login.Next')
  }

  // Плашка отказа сервера — tweb «Sorry» (третья плашка сброса), звана и от
  // самого сброса, и от несостоявшегося.
  const sorry = (message: LangPackKey) => {
    void confirmationPopup({
      titleLangKey: 'Login.ResetAccountFail.Title',
      descriptionLangKey: message,
      button: { langKey: 'OK' },
    }).catch(() => {})
  }

  // Второе подтверждение принято — сбрасываем. Успех уводит на карточку
  // номера, отказ показываем плашкой «Sorry».
  const resetAccount = async () => {
    setBusy(true)
    const res = await managers.auth.resetAccount(token())
    setBusy(false)
    if ('ok' in res) {
      navigate({ name: 'signIn' })
      return
    }
    sorry(
      res.error === 'recovery_available'
        ? 'Login.ResetPassword.HasEmail'
        : res.error === 'password_token_expired'
          ? 'Login.SessionExpired'
          : 'Login.Error.Generic',
    )
  }

  const forgot = async () => {
    if (busy()) return
    setForgotError('')
    setBusy(true)
    const res = await managers.auth.requestPasswordRecovery(token())
    setBusy(false)

    if ('emailPattern' in res) {
      navigate({ name: 'emailRecover', payload: { token: token(), emailPattern: res.emailPattern, hint: hint() } })
      return
    }
    // Пауза повторной отправки — код из прошлой отправки ещё жив, маска у нас
    // уже есть (пришла ПАЙЛОАДОМ при возврате Cancel'ом с emailRecover — см.
    // докблок файла): возвращаем на ту же карточку, вводить его.
    const pattern = cachedPattern()
    if (res.error === 'resend_too_soon' && pattern) {
      navigate({ name: 'emailRecover', payload: { token: token(), emailPattern: pattern, hint: hint() } })
      return
    }
    // Почты нет — вместо ошибки предлагаем сбросить аккаунт: две
    // подтверждающие плашки подряд, вторая только если подтвердили первую.
    if (res.error === 'password_recovery_na') {
      try {
        await confirmationPopup({
          titleLangKey: 'Login.ResetPassword.Title',
          descriptionLangKey: 'Login.ResetPassword.NoEmailText',
          button: { langKey: 'Login.ResetPassword.ResetAccount', isDanger: true },
        })
      } catch {
        return // Cancel/оверлей/Esc/Back — тот же исход, что onClose у tweb-попапа
      }
      try {
        await confirmationPopup({
          titleLangKey: 'Login.ResetAccount.Title',
          descriptionLangKey: 'Login.ResetAccount.Text',
          button: { langKey: 'Login.ResetPassword.ResetAccount', isDanger: true },
        })
      } catch {
        return
      }
      void resetAccount()
      return
    }
    if (res.error === 'password_token_expired') {
      setForgotError('Login.SessionExpired')
      return
    }
    setForgotError('Login.Error.Generic')
  }

  const submitPassword = async () => {
    if (busy()) return
    if (!password()) {
      setEmptyFlash(true)
      return
    }
    setBusy(true)
    try {
      await managers.auth.checkPassword(token(), password(), 'web', 'browser')
      void toIm()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      class={styles.pagePassword}
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={MONKEY_SIZE}>
            {/* tweb: `._sticker > monkeyContainer > .media-sticker-wrapper` —
                PasswordMonkey (lottie, подглядывает при показе пароля) —
                ЗАГЛУШКА того же контура, что у AuthCodeCard: Solid-порт
                lottie-обезьянки вне периметра задачи 4, см. её докблок. */}
            <div class="media-sticker-wrapper" />
          </MediaHeader.Sticker>
          <MediaHeader.Title>{i18n('Login.Password.Title')}</MediaHeader.Title>
          {/* без .secondary — в tweb подзаголовок этой карточки белый */}
          <MediaHeader.Subtitle>{i18n('Login.Password.Subtitle')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <div class={classNames('input-field', 'input-field-password')}>
        {/* ловушки автозаполнения — по одной до и после настоящего поля (tweb) */}
        <input class="stealthy" type="password" tabIndex={-1} aria-hidden />
        <input
          ref={passwordEl}
          class={classNames(
            'input-field-input',
            password() ? '' : 'is-empty',
            error() || emptyFlash() ? 'error' : '',
          )}
          type={showPw() ? 'text' : 'password'}
          name="notsearch_password"
          autocomplete="off"
          required
          disabled={busy()}
          value={password()}
          onInput={(e) => {
            setError(false)
            setEmptyFlash(false)
            setForgotError('')
            setPassword(e.currentTarget.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitPassword()
          }}
        />
        <input class="stealthy" type="password" tabIndex={-1} aria-hidden />
        <div class="input-field-border" />
        {/* В tweb в label лежит подсказка к паролю с сервера — как есть; своя
            строка Password подставляется только когда подсказки нет. */}
        <label>
          <Show when={hint()} fallback={<span>{i18n('LoginPassword')}</span>}>
            <span>{hint()}</span>
          </Show>
        </label>
        <span
          class="toggle-visible"
          onClick={() => setShowPw((v) => !v)}
          role="button"
          aria-label={I18n.format('LoginPassword', true)}
        >
          <IconTsx icon={showPw() ? 'eye2' : 'eye1'} style={{ 'font-size': '1.5rem' }} />
        </span>
      </div>

      <span class={styles.forgotLink}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            void forgot()
          }}
        >
          {i18n('Login.ForgotPassword')}
        </a>
      </span>

      <Button class="btn-primary btn-color-primary" disabled={busy()} onClick={() => void submitPassword()}>
        {nextLabel()}
        {busy() && (
          <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
            <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10" />
          </svg>
        )}
      </Button>
    </AuthCard>
  )
}
