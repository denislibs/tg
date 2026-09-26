/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/enterPassword.tsx:1-178 (812502980) —
 * ввод пароля мастера 2FA (`AppTwoStepVerificationEnterPasswordTab`): новый пароль
 * (пароля нет или он уже проверен — `plainPassword`) → повтор; текущий пароль →
 * проверка сервером → главная вкладка 2FA, а этот шаг снимается из истории.
 * Обезьянка `PasswordMonkey` подглядывает на «глазок» поля; ошибка — `.error`
 * на поле и текст в надписи кнопки (`PASSWORD_HASH_INVALID`), как у оригинала.
 *
 * Расхождения с оригиналом:
 *  1. (О-13) Ссылки «Forgot password?» (`ForgotPasswordLink`, :37-43, :172) нет:
 *     восстановления облачного пароля из настроек у нашего сервера нет (нет
 *     неподтверждённой почты и кода сброса, `authManager.ts` — только
 *     `/auth/password/recover` для входа без сессии). Крючка `onClose` вкладки
 *     (`forgotLink.cleanup()`) поэтому тоже нет.
 *  2. Состояние — наш `PasswordState`: `pFlags.has_password` → `enabled`;
 *     `passwordManager.getState()` → `managers.auth.passwordState()`;
 *     `passwordManager.check(password, state)` (SRP → `auth.checkPassword`) →
 *     `managers.auth.verifyPassword(password)` (`POST /me/password/verify`,
 *     пароль телом внутри TLS — SRP у сервера нет). Пароль нигде не пишется в
 *     журнал: ни здесь, ни в менеджере.
 *  3. Опрос состояния раз в 10 с (`:62-75`, «проверка актуальности сессии»)
 *     гасится и на уборке вкладки, а не только на успехе: у tweb интервал
 *     переживает закрытую вкладку. Так же на уборке снимается обезьянка (у
 *     tweb — только на успехе, `:92`). Отказ опроса поглощается (у tweb —
 *     необработанный промис).
 *  4. Подсказка в подписи поля — `wrapEmojiText(hint)` нашей `lib/richtext`.
 *  5. Загрузка обезьянки отдаётся коллектору с поглощённым отказом (`NO_WASM` —
 *     статичный кадр ставит сам загрузчик), как у `SettingsTabLottieAnimation`:
 *     иначе отказ уронил бы открытие вкладки. У tweb отказа нет.
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import cancelEvent from '@helpers/dom/cancelEvent'
import { canFocus } from '@helpers/dom/canFocus'
import replaceContent from '@helpers/dom/replaceContent'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import noop from '@helpers/noop'
import I18n, { i18n } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import type { PasswordState } from '@core/managers/authManager'
import Button from '@components/buttonTsx.solid'
import { putPreloader } from '@components/putPreloader'
import PasswordMonkey from '@components/monkeys/password'
import PasswordInputField from '@components/passwordInputField'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import {
  AppTwoStepVerificationReEnterPasswordTab,
  AppTwoStepVerificationTab,
  type AppTwoStepVerificationEnterPasswordTab,
  type TwoStepVerificationTabHooks,
} from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'

const TwoStepVerificationEnterPassword: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationEnterPasswordTab>()
  const promiseCollector = usePromiseCollector()
  const slider = tab.slider as SidebarSlider
  let state: PasswordState = tab.payload.state
  const plainPassword = tab.payload.plainPassword
  const isFirst = tab.payload.isFirst ?? true

  const isNew = !state.enabled || plainPassword

  const passwordInputField = new PasswordInputField({
    name: 'enter-password',
    label: isNew ? 'PleaseEnterFirstPassword' : (state.hint ? undefined : 'LoginPassword'),
    labelText: !isNew && state.hint ? wrapEmojiText(state.hint) : undefined,
  })

  const monkey = new PasswordMonkey(passwordInputField, 157)
  onCleanup(() => monkey.remove())

  const textEl = new I18n.IntlElement({ key: 'Continue' })

  const verifyInput = () => {
    if(!passwordInputField.value.length) {
      passwordInputField.input.classList.add('error')
      return false
    }

    return true
  }

  let btnContinue!: HTMLElement

  let onContinueClick: (e?: Event) => void
  if(!isNew) {
    let getStateInterval: number | undefined

    const getState = () => {
      // * just to check session relevance
      if(!getStateInterval) {
        getStateInterval = window.setInterval(getState, 10e3)
      }

      return tab.managers!.auth.passwordState().then((_state) => {
        state = _state

        if(state.hint) {
          setInnerHTML(passwordInputField.label, wrapEmojiText(state.hint))
        } else {
          replaceContent(passwordInputField.label, i18n('LoginPassword'))
        }
      }, noop)
    }

    onCleanup(() => clearInterval(getStateInterval))

    const submit = (e?: Event) => {
      if(!verifyInput()) {
        cancelEvent(e)
        return
      }

      btnContinue.setAttribute('disabled', 'true')
      textEl.key = 'PleaseWait'
      textEl.update()
      const preloader = putPreloader(btnContinue)

      const plainPassword = passwordInputField.value
      tab.managers!.auth.verifyPassword(plainPassword).then(() => {
        clearInterval(getStateInterval)
        monkey.remove()
        void slider.createTab(AppTwoStepVerificationTab).open({
          state,
          plainPassword,
        })
        slider.removeTabFromHistory(tab)
      }, () => {
        btnContinue.removeAttribute('disabled')
        passwordInputField.input.classList.add('error')

        textEl.key = 'PASSWORD_HASH_INVALID'
        textEl.update()
        preloader.remove()
        passwordInputField.select()

        void getState()
      })
    }

    onContinueClick = submit

    void getState()
  } else {
    onContinueClick = (e) => {
      if(e) {
        cancelEvent(e)
      }

      if(!verifyInput()) return

      void slider.createTab(AppTwoStepVerificationReEnterPasswordTab).open({
        state,
        newPassword: passwordInputField.value,
        plainPassword,
      })
    }
  }

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-enter-password')

    passwordInputField.input.addEventListener('keypress', (e) => {
      if(passwordInputField.input.classList.contains('error')) {
        passwordInputField.input.classList.remove('error')
        textEl.key = 'Continue'
        textEl.update()
      }

      if(e.key === 'Enter') {
        return onContinueClick()
      }
    })
  })

  ;(tab as typeof tab & TwoStepVerificationTabHooks)._onOpenAfterTimeout = () => {
    if(!canFocus(isFirst)) return
    passwordInputField.input.focus()
  }

  promiseCollector.collect(monkey.load().catch(noop))

  return (
    <Section noDelimiter>
      {monkey.container}
      <div class="input-wrapper">
        {passwordInputField.container}
        <Button ref={(el) => btnContinue = el} primaryFilled onClick={onContinueClick}>
          {textEl.element}
        </Button>
      </div>
    </Section>
  )
}

export default TwoStepVerificationEnterPassword
