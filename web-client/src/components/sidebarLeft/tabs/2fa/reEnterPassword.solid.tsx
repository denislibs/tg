/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/reEnterPassword.tsx:1-79 (812502980) —
 * повтор нового пароля мастера 2FA (`AppTwoStepVerificationReEnterPasswordTab`):
 * несовпадение — `setError()` поля, совпадение — вкладка подсказки. Обезьянка —
 * «следящая» (`TrackingMonkey`): кадр идёт за длиной ввода.
 *
 * Расхождения с оригиналом:
 *  1. Загрузка обезьянки отдаётся коллектору с поглощённым отказом (как в
 *     `enterPassword.solid.tsx`, п. 5), а сама обезьянка снимается на уборке
 *     вкладки — у tweb её никто не снимает.
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import cancelEvent from '@helpers/dom/cancelEvent'
import noop from '@helpers/noop'
import Button from '@components/buttonTsx.solid'
import { InputState } from '@components/inputField'
import PasswordInputField from '@components/passwordInputField'
import TrackingMonkey from '@components/monkeys/tracking'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import {
  AppTwoStepVerificationHintTab,
  type AppTwoStepVerificationReEnterPasswordTab,
  type TwoStepVerificationTabHooks,
} from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'

const TwoStepVerificationReEnterPassword: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationReEnterPasswordTab>()
  const promiseCollector = usePromiseCollector()
  const slider = tab.slider as SidebarSlider
  const { state, plainPassword, newPassword } = tab.payload

  const passwordInputField = new PasswordInputField({
    name: 're-enter-password',
    label: 'PleaseReEnterPassword',
  })

  const monkey = new TrackingMonkey(passwordInputField, 157)
  onCleanup(() => monkey.remove())

  const verifyInput = () => {
    if(newPassword !== passwordInputField.value) {
      passwordInputField.setError()
      return false
    }

    return true
  }

  const onContinueClick = (e?: Event) => {
    if(e) {
      cancelEvent(e)
    }

    if(!verifyInput()) return

    void slider.createTab(AppTwoStepVerificationHintTab).open({
      state,
      plainPassword,
      newPassword,
    })
  }

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-enter-password', 'two-step-verification-re-enter-password')

    passwordInputField.input.addEventListener('keypress', (e) => {
      if(passwordInputField.input.classList.contains('error')) {
        passwordInputField.setState(InputState.Neutral)
      }

      if(e.key === 'Enter') {
        return onContinueClick()
      }
    })
  })

  ;(tab as typeof tab & TwoStepVerificationTabHooks)._onOpenAfterTimeout = () => {
    passwordInputField.input.focus()
  }

  promiseCollector.collect(monkey.load().catch(noop))

  return (
    <Section noDelimiter>
      {monkey.container}
      <div class="input-wrapper">
        {passwordInputField.container}
        <Button primaryFilled text="Continue" onClick={onContinueClick} />
      </div>
    </Section>
  )
}

export default TwoStepVerificationReEnterPassword
