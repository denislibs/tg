/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/index.tsx:1-92 (812502980) —
 * главная вкладка мастера 2FA (`AppTwoStepVerificationTab`, `solidJsTabs/tabs.ts`):
 * заставка 🔐, подпись внутри карточки (`captionOld`, дамп
 * `14-left-34-two-step-verification`); без пароля — одна кнопка «Set Password»,
 * с паролем — три `Button btn-primary btn-transparent` (сменить пароль,
 * выключить, почта восстановления).
 *
 * Расхождения с оригиналом:
 *  1. Состояние — наш `PasswordState` (`enabled`/`hint`/маска `email`) вместо
 *     `AccountPassword`: `pFlags.has_password` → `enabled`, `pFlags.has_recovery`
 *     → непустая маска `email`.
 *  2. Выключение: `passwordManager.updateSettings({currentPassword})` (SRP,
 *     пустой новый хеш = снять пароль) → `managers.auth.removePassword(current)`
 *     (`DELETE /me/password`: у нашего сервера пустой новый пароль значит «не
 *     менять», снятие — отдельной ручкой). SRP у нас нет: пароль едет телом
 *     запроса внутри TLS (и канала DNP при его включении), как у всех ручек
 *     `/me/password`.
 *  3. Заставка: `wrapStickerEmoji` получает зону актуальности вкладки
 *     (`getMiddleware` гасится на уборке острова), а отказ «нет стикера»
 *     поглощается — у tweb промис брошен без обработчика; контейнер в этом
 *     случае остаётся `media-sticker-wrapper`, как у оригинала.
 *  4. Отказ сервера при выключении не молчит, а даёт тост `Error.AnError` —
 *     у tweb `.then` без обработчика отказа (SRP не отказывает на верном
 *     пароле, пароль проверен шагом раньше); у нас сессия могла протухнуть.
 */
import { onCleanup, onMount, Show, type Component } from 'solid-js'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import Button from '@components/buttonTsx.solid'
import Section from '@components/section.solid'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import { toastNew } from '@components/toast'
import wrapStickerEmoji from '@components/wrappers/stickerEmoji'
import type SidebarSlider from '@components/slider'
import {
  AppSettingsTab,
  AppTwoStepVerificationEmailTab,
  AppTwoStepVerificationEnterPasswordTab,
  type AppTwoStepVerificationTab,
} from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const TwoStepVerification: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationTab>()
  const { state, plainPassword } = tab.payload
  const slider = tab.slider as SidebarSlider

  const stickerMiddleware = getMiddleware()
  onCleanup(() => stickerMiddleware.destroy())
  const stickerContainer = document.createElement('div')
  wrapStickerEmoji({
    div: stickerContainer,
    width: 168,
    height: 168,
    emoji: '🔐',
    middleware: stickerMiddleware.get(),
  }).catch(noop)

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-main')
  })

  const onDisablePassword = () => {
    PopupElement.createPopup(PopupPeer, 'popup-disable-password', {
      buttons: [{
        langKey: 'Disable',
        callback: () => {
          tab.managers!.auth.removePassword(plainPassword ?? '').then(() => {
            (tab.slider as SidebarSlider).sliceTabsUntilTab(AppSettingsTab, tab)
            tab.close()
          }, () => {
            toastNew({ langPackKey: 'Error.AnError' })
          })
        },
        isDanger: true,
      }],
      titleLangKey: 'TurnPasswordOffQuestionTitle',
      descriptionLangKey: 'TurnPasswordOffQuestion',
    }).show()
  }

  return (
    <Section
      caption={state.enabled ? 'TwoStepAuth.GenericHelp' : 'TwoStepAuth.SetPasswordHelp'}
      captionOld
      noDelimiter
    >
      {stickerContainer}
      <Show
        when={state.enabled}
        fallback={
          <div class="input-wrapper">
            <Button
              primaryFilled
              text="TwoStepVerificationSetPassword"
              onClick={() => slider.createTab(AppTwoStepVerificationEnterPasswordTab).open({ state })}
            />
          </div>
        }
      >
        <Button
          class="btn-primary btn-transparent"
          icon="edit"
          text="TwoStepAuth.ChangePassword"
          onClick={() => slider.createTab(AppTwoStepVerificationEnterPasswordTab).open({ state, plainPassword })}
        />
        <Button
          class="btn-primary btn-transparent"
          icon="passwordoff"
          text="TwoStepAuth.RemovePassword"
          onClick={onDisablePassword}
        />
        <Button
          class="btn-primary btn-transparent"
          icon="email"
          text={state.email ? 'TwoStepAuth.ChangeEmail' : 'TwoStepAuth.SetupEmail'}
          onClick={() => slider.createTab(AppTwoStepVerificationEmailTab).open({
            state,
            hint: state.hint,
            plainPassword,
            newPassword: plainPassword,
            isFirst: true,
          })}
        />
      </Show>
    </Section>
  )
}

export default TwoStepVerification
