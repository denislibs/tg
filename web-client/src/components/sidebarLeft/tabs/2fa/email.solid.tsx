/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/email.tsx:1-151 (812502980) —
 * почта восстановления мастера 2FA (`AppTwoStepVerificationEmailTab`): лотти
 * `LoveLetter`, поле `RecoveryEmail`, «Continue» (адрес проверяется `matchEmail`,
 * иначе `.error` на поле) и «Skip» с попапом-предупреждением
 * `popup-skip-email`. Запись — пароль, подсказка и почта одним вызовом, после
 * успеха — финальная вкладка (`AppTwoStepVerificationSetTab`).
 *
 * Расхождения с оригиналом:
 *  1. Запись: `passwordManager.updateSettings({hint, currentPassword, newPassword,
 *     email})` (SRP) → `managers.auth.setPassword({currentPassword, newPassword,
 *     hint, email})` (`POST /me/password`, пароли телом внутри TLS — SRP у сервера
 *     нет); `hint ?? ''` — как `params.new_settings.hint ??= ''` менеджера tweb.
 *  2. (О-13) Ветки `EMAIL_UNCONFIRMED_<n>` → `AppTwoStepVerificationEmailConfirmationTab`
 *     (:74-83) нет: наш сервер ставит почту сразу, без кода подтверждения, и
 *     такой ошибки не отдаёт. Отказ сервера только размораживает кнопки;
 *     `console.log('password set error', err)` оригинала не переносится — в
 *     журнал рядом с паролями ничего не пишем.
 *  3. (О-13) «Skip» шлёт `email: ''`. У tweb это снимает почту восстановления;
 *     у нашего сервера пустая почта значит «оставить прежнюю»
 *     (`usecase/auth/password.go::SetPassword`) — снять почту пропуском нельзя.
 *  4. Лотти: `lottieLoader` — синглтон `@lib/lottie/lottieLoader` (HMR-охранника
 *     `useHotReloadGuard` у нас нет), отказ загрузки (`NO_WASM` — статичный кадр
 *     загрузчик ставит сам) поглощается; анимация снимается на уборке вкладки
 *     зоной актуальности (у tweb её никто не снимает).
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import cancelEvent from '@helpers/dom/cancelEvent'
import { canFocus } from '@helpers/dom/canFocus'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import lottieLoader from '@lib/lottie/lottieLoader'
import matchEmail from '@lib/richtext/matchEmail'
import Button from '@components/buttonTsx.solid'
import type InputField from '@components/inputField'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import { putPreloader } from '@components/putPreloader'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import {
  AppTwoStepVerificationSetTab,
  type AppTwoStepVerificationEmailTab,
  type TwoStepVerificationTabHooks,
} from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const TwoStepVerificationEmail: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationEmailTab>()
  const slider = tab.slider as SidebarSlider
  const { plainPassword, newPassword, hint } = tab.payload
  const isFirst = tab.payload.isFirst ?? false
  const justSetPasssword = tab.payload.justSetPasssword ?? false

  let inputField!: InputField
  let btnContinue!: HTMLElement
  let btnSkip!: HTMLElement

  const stickerContainer = document.createElement('div')
  stickerContainer.classList.add('media-sticker-wrapper')

  // Зона актуальности вкладки: загрузчик сам снимает плеер на её уборке
  // (`lottieLoader.loadAnimationWorker` → `middleware.onClean`).
  const lottieMiddleware = getMiddleware()
  onCleanup(() => lottieMiddleware.destroy())
  lottieLoader.loadAnimationAsAsset({
    container: stickerContainer,
    width: 160,
    height: 160,
    loop: false,
    autoplay: true,
    middleware: lottieMiddleware.get(),
  }, 'LoveLetter').catch(noop)

  const toggleButtons = (freeze: boolean) => {
    if(freeze) {
      btnContinue.setAttribute('disabled', 'true')
      btnSkip.setAttribute('disabled', 'true')
    } else {
      btnContinue.removeAttribute('disabled')
      btnSkip.removeAttribute('disabled')
    }
  }

  const goNext = () => {
    void slider.createTab(AppTwoStepVerificationSetTab).open({ messageFor: justSetPasssword ? 'password' : 'email' })
  }

  const save = (email: string) => tab.managers!.auth.setPassword({
    hint: hint ?? '',
    currentPassword: plainPassword,
    newPassword: newPassword ?? '',
    email,
  })

  const onContinueClick = () => {
    const email = inputField.value.trim()
    const match = matchEmail(email)
    if(!match || match[0].length !== email.length) {
      inputField.input.classList.add('error')
      return
    }

    toggleButtons(true)
    const d = putPreloader(btnContinue)

    save(email).then(() => {
      goNext()
    }, () => {
      toggleButtons(false)
      d.remove()
    })
  }

  const onSkipClick = () => {
    PopupElement.createPopup(PopupPeer, 'popup-skip-email', {
      buttons: [{
        langKey: 'Cancel',
        isCancel: true,
      }, {
        langKey: 'YourEmailSkip',
        callback: () => {
          toggleButtons(true)
          putPreloader(btnSkip)
          save('').then(() => {
            goNext()
          }, () => {
            toggleButtons(false)
          })
        },
        isDanger: true,
      }],
      titleLangKey: 'YourEmailSkipWarning',
      descriptionLangKey: 'YourEmailSkipWarningText',
    }).show()
  }

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-email')

    inputField.input.addEventListener('keypress', (e) => {
      if(e.key === 'Enter') {
        cancelEvent(e)
        return onContinueClick()
      }
    })
  })

  ;(tab as typeof tab & TwoStepVerificationTabHooks)._onOpenAfterTimeout = () => {
    if(!canFocus(isFirst)) return
    inputField.input.focus()
  }

  return (
    <Section captionOld noDelimiter>
      {stickerContainer}
      <div class="input-wrapper">
        <InputFieldTsx
          name="recovery-email"
          label="RecoveryEmail"
          plainText
          instanceRef={(ref) => inputField = ref}
          onRawInput={() => inputField.input.classList.remove('error')}
        />
        <Button ref={(el) => btnContinue = el} primaryFilled text="Continue" onClick={onContinueClick} />
        <Button ref={(el) => btnSkip = el} class="btn-primary btn-secondary btn-primary-transparent primary" text="YourEmailSkip" onClick={onSkipClick} />
      </div>
    </Section>
  )
}

export default TwoStepVerificationEmail
