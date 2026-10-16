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
// ── Пауза повторной отправки кода ───────────────────────────────────────────
// Отдельной ветки у карточки нет: пауза восстановления приходит от сервера как
// 420 `FLOOD_WAIT_N` (≤ 30 с), и `restClient` сам ждёт N секунд и повторяет —
// порт tweb `apiManager.ts:759-791`. Менеджер получает уже успешный ответ.
// Маска почты едет на переходе в `emailRecover` вместе с `hint` (Cancel
// `emailRecover` возвращает `token`/`hint` — `authFlow.solid.tsx::CardPayloadMap`).
import { createSignal, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import I18n, { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import formatDuration from '@helpers/formatDuration'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'
import classNames from '@helpers/string/classNames'
import { confirmationPopup } from '../../popups/popupPeer'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '@components/mediaHeader.solid'
import { PreloaderCircular } from '../Preloader.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'password' }>

// tweb: `mediaSizes.isMobile ? 100 : 130` — тот же выбор, что и у AuthCodeCard.
const MONKEY_SIZE = 130

export default function PasswordCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const token = () => props.spec.payload.token
  const hint = () => props.spec.payload.hint

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
  const sorry = (message: LangPackKey, args?: FormatterArguments) => {
    void confirmationPopup({
      titleLangKey: 'Login.ResetAccountFail.Title',
      descriptionLangKey: message,
      descriptionLangArgs: args,
      button: { langKey: 'OK' },
      // Плашка ОДНОКНОПОЧНАЯ: реджект здесь означает лишь «закрыли Esc/Back/
      // мимо», то есть тот же исход, что и «ОК». Гасить его правильно —
      // ошибки в этом промисе нет (у tweb это `onClose` попапа, а не отказ).
    }).catch(() => {})
  }

  // Второе подтверждение принято — сбрасываем. Успех уводит на карточку
  // номера, отказ показываем плашкой «Sorry».
  const resetAccount = async () => {
    setBusy(true)
    // Сетевой сбой менеджер отдаёт исключением — карточка не запирается.
    const res = await managers.auth.resetAccount(token()).catch((err: unknown) => {
      console.error('PasswordCard: resetAccount error:', err)
      return { error: 'failed' as const }
    })
    setBusy(false)
    if ('ok' in res) {
      navigate({ name: 'signIn' })
      return
    }
    // tweb PasswordCard.tsx:88-100: отказы отложенного сброса по имени.
    if (res.error === 'recent_confirm') {
      sorry('Login.ResetAccountFail.TextCancelled')
      return
    }
    if (res.error === 'confirm_wait') {
      sorry('Login.ResetAccountFail.TextWait', [wrapFormattedDuration(formatDuration(res.wait))])
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
        return // то же, что веткой выше: отказ второй плашки — это ОТМЕНА, а не ошибка
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
          <MediaHeader.Sticker size={MONKEY_SIZE} element={() => (<>
            {/* tweb: `._sticker > monkeyContainer > .media-sticker-wrapper` —
                PasswordMonkey (lottie, подглядывает при показе пароля) —
                ЗАГЛУШКА того же контура, что у AuthCodeCard: Solid-порт
                lottie-обезьянки вне периметра задачи 4, см. её докблок. */}
            <div class="media-sticker-wrapper" />
          </>)} />
          <MediaHeader.Title tag="h1">{i18n('Login.Password.Title')}</MediaHeader.Title>
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
          <IconTsx icon={showPw() ? 'eye2_filled' : 'eye1_filled'} style={{ 'font-size': '1.5rem' }} />
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
        {busy() && <PreloaderCircular />}
      </Button>
    </AuthCard>
  )
}
