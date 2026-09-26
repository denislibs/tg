/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/passcodeLock/enterPasswordTab.tsx:1-106
 * (812502980) — вкладка ввода код-пароля (`AppPasscodeEnterPasswordTab`,
 * `solidJsTabs/tabs.ts`): заставка, поле пароля и кнопка; что делать с кодом,
 * решает открывающая сторона (`payload.onSubmit`, бросок — «коды не совпали»).
 * Открывают её главная вкладка (включение и смена, `mainTab.solid.tsx`) и
 * строка раздела конфиденциальности при включённом коде (проверка текущего).
 *
 * Расхождения с оригиналом:
 *  1. `usePasscodeActions()` → `passcodeActions(tab.managers.persist)`
 *     (`core/passcode.ts`): у нас действиям нужен только writer офлайн-стора.
 *  2. `keepMe(ripple)` → `void ripple` (как у `inlineSelect.solid.tsx`).
 *  3. Строгие типы: `inputField!` (присваивается `instanceRef` при создании
 *     поля), `.input` приводится к `HTMLInputElement` один раз.
 */
import { createEffect, createSignal, onCleanup } from 'solid-js'
import { i18n } from '@lib/langPack'
import { MAX_PASSCODE_LENGTH, passcodeActions } from '@core/passcode'
import SettingsTabLottieAnimation from '@components/settingsTabLottieAnimation.solid'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import PasswordInputField from '@components/passwordInputField'
import ripple from '@components/ripple'
import Section from '@components/section.solid'
import type { AppPasscodeEnterPasswordTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import Space from '@components/space.solid'
import commonStyles from '@components/sidebarLeft/tabs/passcodeLock/common.module.scss'

void ripple

type AppPasscodeEnterPasswordTabClass = typeof AppPasscodeEnterPasswordTab

const EnterPasswordTab = () => {
  const [tab] = useSuperTab<AppPasscodeEnterPasswordTabClass>()
  const actions = passcodeActions(tab.managers!.persist)

  let inputField!: PasswordInputField

  const [value, setValue] = createSignal('')
  const [isError, setIsError] = createSignal(false)

  createEffect(() => {
    value()
    setIsError(false)
  })

  setTimeout(() => {
    inputField.input.focus()
  }, 400) // Smaller timeout will make the tab animation jerky

  onCleanup(() => {
    // Just in case
    setValue('')
    ;(inputField.input as HTMLInputElement).value = ''
  })

  const canSubmit = () => value() && value().length <= MAX_PASSCODE_LENGTH

  let isSubmitting = false
  async function onSubmit(e: Event) {
    e.preventDefault()

    if(!canSubmit() || isSubmitting) return
    isSubmitting = true

    try {
      await tab.payload.onSubmit(value(), tab, actions)
    } catch{
      setIsError(true)
    } finally {
      isSubmitting = false
    }
  }

  return (
    <Section caption="PasscodeLock.Notice">
      <SettingsTabLottieAnimation name="UtyanPasscode" />

      <Space amount="1.125rem" />

      <form
        action=""
        autocomplete="off"
        onSubmit={onSubmit}
      >
        <div class={commonStyles.AdditionalPadding}>
          <InputFieldTsx
            InputFieldClass={PasswordInputField}
            instanceRef={(ref) => void (inputField = ref)}
            maxLength={MAX_PASSCODE_LENGTH}
            autocomplete="off"
            value={value()}
            errorLabel={isError() ? 'PasscodeLock.PasscodesDontMatch' : undefined}
            label={tab.payload.inputLabel}
            onRawInput={setValue}
          />
        </div>

        <Space amount="1rem" />

        <div class={commonStyles.AdditionalPadding}>
          <button
            use:ripple
            type="submit"
            class="btn-primary btn-color-primary btn-large"
            disabled={!canSubmit()}
          >
            {i18n(tab.payload.buttonText)}
          </button>
        </div>
      </form>

      <Space amount="1rem" />
    </Section>
  )
}

export default EnterPasswordTab
