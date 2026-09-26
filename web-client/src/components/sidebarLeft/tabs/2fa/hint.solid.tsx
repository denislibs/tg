/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/hint.tsx:1-85 (812502980) —
 * подсказка к паролю мастера 2FA (`AppTwoStepVerificationHintTab`): заставка 💡,
 * поле `InputFieldTsx`, «Continue» (подсказка, совпавшая с паролем, —
 * тост `PasswordAsHintError`) и «Skip»; оба ведут на почту восстановления.
 *
 * Расхождения с оригиналом:
 *  1. Заставка — как на главной вкладке (`index.solid.tsx`, п. 4): зона
 *     актуальности вкладки и поглощённый отказ «нет стикера».
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import cancelEvent from '@helpers/dom/cancelEvent'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import Button from '@components/buttonTsx.solid'
import type InputField from '@components/inputField'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import { toastNew } from '@components/toast'
import wrapStickerEmoji from '@components/wrappers/stickerEmoji'
import {
  AppTwoStepVerificationEmailTab,
  type AppTwoStepVerificationHintTab,
  type TwoStepVerificationTabHooks,
} from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const TwoStepVerificationHint: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationHintTab>()
  const slider = tab.slider as SidebarSlider
  const { state, plainPassword, newPassword } = tab.payload

  let inputField!: InputField

  const stickerMiddleware = getMiddleware()
  onCleanup(() => stickerMiddleware.destroy())
  const stickerContainer = document.createElement('div')
  wrapStickerEmoji({
    div: stickerContainer,
    width: 160,
    height: 160,
    emoji: '💡',
    middleware: stickerMiddleware.get(),
  }).catch(noop)

  const goNext = (e?: Event, saveHint?: boolean) => {
    if(e) {
      cancelEvent(e)
    }

    const hint = saveHint ? inputField.value : undefined
    if(hint && newPassword === hint) {
      toastNew({ langPackKey: 'PasswordAsHintError' })
      return
    }

    void slider.createTab(AppTwoStepVerificationEmailTab).open({
      state,
      plainPassword,
      newPassword,
      hint,
      justSetPasssword: true,
    })
  }

  const onContinueClick = (e?: Event) => goNext(e, true)
  const onSkipClick = (e?: Event) => goNext(e, false)

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-hint')

    inputField.input.addEventListener('keypress', (e) => {
      if(e.key === 'Enter') {
        cancelEvent(e)
        return inputField.value ? onContinueClick() : onSkipClick()
      }
    })
  })

  ;(tab as typeof tab & TwoStepVerificationTabHooks)._onOpenAfterTimeout = () => {
    inputField.input.focus()
  }

  return (
    <Section noDelimiter>
      {stickerContainer}
      <div class="input-wrapper">
        <InputFieldTsx
          name="hint"
          label="TwoStepAuth.SetupHintPlaceholder"
          instanceRef={(ref) => inputField = ref}
        />
        <Button primaryFilled text="Continue" onClick={onContinueClick} />
        <Button
          class="btn-primary btn-secondary btn-primary-transparent primary"
          text="YourEmailSkip"
          onClick={onSkipClick}
        />
      </div>
    </Section>
  )
}

export default TwoStepVerificationHint
