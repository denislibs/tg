/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/passcodeLockScreen.tsx` (812502980) — экран
 * блокировки код-паролем: фон чата, карточка с обезьянкой, поле пароля,
 * «Proceed» и подпись «забыли код → выйти» с попапом подтверждения. Ввод сдвигает
 * градиент фона; неверный код — ошибка поля; после шести неудач — «слишком много
 * попыток» и срок следующей попытки в настройках (60 с). Клавиша, нажатая вне поля,
 * переводит в него фокус; фокус заперт в экране.
 *
 * Расхождения с tweb:
 *  1. Без анимации замка из шапки (`fromLockIcon`/`onAnimationEnd`) — см. шапку
 *     `passcodeLockScreenController.solid.tsx`; обезьянка видна сразу.
 *  2. Зависимости — импортом, а не `useLockScreenHotReloadGuard()` (HMR-подмена
 *     модулей tweb); `usePasscodeActions()` → функции `lib/passcode/actions.ts`;
 *     `forceLogout` — через канал код-пароля (`invokePasscode`), а не
 *     `apiManagerProxy.invokeVoid`.
 *  3. Настройки: tweb читает `settings` из `commonStateStorage` без кэша
 *     (`get('settings', false)`), у нас — стор `settings.tsx` (его соседние вкладки
 *     держат в синхроне событием `storage`); поле — `passcodeCanAttemptAgainOn`.
 *  4. Число аккаунтов — `getUnencryptedTotalAccounts` (`core/auth/numberOfAccounts.ts`),
 *     порт одноимённого метода `AccountController`.
 *  5. `keepMe(ripple)` → `void ripple`.
 */
import { type Component, createEffect, createResource, on, onCleanup, onMount } from 'solid-js'
import { createMutable } from 'solid-js/store'
import { animateValue } from '@helpers/animateValue'
import focusInput from '@helpers/dom/focusInput'
import createFocusTrap from '@helpers/dom/focusTrap'
import throttle from '@helpers/schedulers/throttle'
import I18n, { i18n } from '@lib/langPack'
import { isMyPasscode, unlockWithPasscode } from '@lib/passcode/actions'
import { MAX_PASSCODE_LENGTH } from '@lib/passcode/constants'
import { getUnencryptedTotalAccounts } from '@core/auth/numberOfAccounts'
import type ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'
import { invokePasscode } from '@/client/passcodeClient'
import { useSettingsStore } from '@/settings'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import PasswordInputField from '@components/passwordInputField'
import ripple from '@components/ripple'
import Space from '@components/space.solid'
import Background from './background.solid'
import PasswordMonkeyTsx from './passwordMonkeyTsx.solid'
import SimplePopup from './simplePopup.solid'
import styles from './passcodeLockScreen.module.scss'

void ripple

type StateStore = {
  isMonkeyHidden: boolean
  isError: boolean
  tooManyAttempts: boolean
  passcode: string
  isLogoutPopupOpen: boolean
  gradientRenderer?: ChatBackgroundGradientRenderer
}

const MAX_ATTEMPTS = 5
const MAX_ATTEMPTS_TIMEOUT_SEC = 60

const PasscodeLockScreen: Component<{
  onUnlock: () => void
}> = (props) => {
  let container!: HTMLDivElement
  let passwordInputField!: PasswordInputField

  let attempts = 0

  const store = createMutable<StateStore>({
    isMonkeyHidden: false,
    isError: false,
    tooManyAttempts: false,
    passcode: '',
    isLogoutPopupOpen: false,
  })

  const [totalAccounts] = createResource(() => getUnencryptedTotalAccounts())

  onMount(() => {
    attempts = 0
    const doc = container.ownerDocument
    const trap = createFocusTrap(container)
    trap.activate()
    onCleanup(() => trap.deactivate())

    const listener = (e: KeyboardEvent) => {
      if(e.defaultPrevented || store.isLogoutPopupOpen ||
        e.target !== doc.body && e.target !== container) return
      focusInput(passwordInputField.input, e)
    }
    doc.addEventListener('keydown', listener)
    onCleanup(() => {
      doc.removeEventListener('keydown', listener)
    })
  })

  let cancelAnimation: (() => void) | undefined

  function rotateBackgroundGradient() {
    cancelAnimation?.()

    if(store.gradientRenderer) {
      let progress = 0
      cancelAnimation = animateValue(0, 1, 200, (p) => progress = p)
      store.gradientRenderer.toNextPosition(() => progress)
    }
  }

  const rotateBackgroundGradientThrottled = throttle(rotateBackgroundGradient, 100, true)

  createEffect(on(() => store.passcode, () => {
    rotateBackgroundGradientThrottled()

    store.isError = false
    store.tooManyAttempts = false
  }))

  onCleanup(() => {
    store.passcode = ''
    ;(passwordInputField.input as HTMLInputElement).value = ''
  })

  const canSubmit = () => !!store.passcode && store.passcode.length <= MAX_PASSCODE_LENGTH

  const canAttempt = () => {
    const canAttemptAgainOn = useSettingsStore.getState().passcodeCanAttemptAgainOn
    if(!canAttemptAgainOn) return true

    if(canAttemptAgainOn > Date.now()) return false

    store.tooManyAttempts = false
    attempts = 0
    useSettingsStore.getState().update({ passcodeCanAttemptAgainOn: null })
    return true
  }

  let isSubmiting = false
  const onSubmit = async(e?: Event) => {
    e?.preventDefault()
    if(isSubmiting) return

    isSubmiting = true

    try {
      if(!canAttempt()) {
        store.tooManyAttempts = true
      } else if(canSubmit() && await isMyPasscode(store.passcode)) {
        await unlockWithPasscode(store.passcode)
        props.onUnlock()
      } else {
        attempts++
        store.isError = true
        if(attempts > MAX_ATTEMPTS) {
          store.tooManyAttempts = true
          useSettingsStore.getState().update({
            passcodeCanAttemptAgainOn: Date.now() + MAX_ATTEMPTS_TIMEOUT_SEC * 1000,
          })
        }
      }
    } catch{
      store.isError = true
    } finally {
      isSubmiting = false
    }
  }

  const input = (
    <InputFieldTsx
      InputFieldClass={PasswordInputField}
      instanceRef={(value) => void (passwordInputField = value)}
      class={styles.Input}
      value={store.passcode}
      onRawInput={(value) => void (store.passcode = value)}
      label="PasscodeLock.EnterYourPasscode"
      errorLabel={
        store.tooManyAttempts ?
          'PasscodeLock.TooManyAttempts' :
          store.isError ?
            'PasscodeLock.WrongPasscode' :
            undefined
      }
      maxLength={MAX_PASSCODE_LENGTH}
    />
  )

  return (
    <div ref={container} class={styles.Container}>
      <Background gradientRendererRef={(value) => void (store.gradientRenderer = value)} />
      <div class={styles.Card}>
        <PasswordMonkeyTsx
          hidden={store.isMonkeyHidden}
          passwordInputField={passwordInputField}
        />
        <Space amount="1.125rem" />
        <form action="" onSubmit={onSubmit}>
          {input}
          <Space amount="1rem" />
          <button
            type="submit"
            class={`btn-primary btn-color-primary btn-large ${styles.SubmitButton}`}
            disabled={!store.passcode}
          >
            {i18n('PasscodeLock.Proceed')}
          </button>
        </form>
        <Space amount="1.625rem" />
        <div class={styles.Description}>
          {
            i18n(
              (totalAccounts() ?? 0) > 1 ? // Gonna be `false` when undefined
                'PasscodeLock.ForgotPasscode.MultipleAccounts' :
                'PasscodeLock.ForgotPasscode.OneAccount',
              [
                <button
                  class={styles.LogoutButton}
                  aria-label={I18n.format('LogOut', true)}
                  onClick={() => {
                    store.isLogoutPopupOpen = true
                  }}
                /> as HTMLButtonElement,
              ],
            )
          }
        </div>
      </div>

      <SimplePopup
        visible={store.isLogoutPopupOpen}
        title={i18n('LogOut')}
        description={i18n('PasscodeLock.LogoutPopup.Description')}
        confirmButtonContent={i18n('LogOut')}
        onConfirm={() => {
          // воркер стирает хранилища и сам рассылает `reload` (client/passcodeClient.ts)
          invokePasscode({ method: 'forceLogout' }).catch(() => {})
        }}
        onClose={() => void (store.isLogoutPopupOpen = false)}
      />
    </div>
  )
}

export default PasscodeLockScreen
