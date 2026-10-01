/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/autoDeleteMessages/index.tsx:1-125`
 * (812502980) — вкладка «Автоудаление сообщений» (`AppMessagesAutoDeleteTab`,
 * `solidJsTabs/tabs.ts`). Задача 20 плана 2D. Открывает её строка
 * `AutoDeleteMessages` хаба «Конфиденциальность» (tweb `privacyAndSecurity.tsx:238-247`)
 * с текущим периодом и `onSaved`.
 *
 * Выбор НЕ пишется сразу: галочка «Сохранить» в шапке (`SaveButton`, только
 * при изменении) пишет период и закрывает вкладку; закрытие с изменениями
 * спрашивает «Save / Discard» (`useIsConfirmationNeededOnClose`). Свой срок
 * вне списка встаёт радио-строкой по порядку сроков.
 *
 * Расхождения с оригиналом:
 *  1. `useHotReloadGuard()` (`:19`) не нужен: `Row` — `@components/rowTsx.solid`,
 *     менеджеры — `tab.managers` (наш `privacy.setAutoDelete`, `PUT
 *     /me/auto_delete`, вместо `appPrivacyManager.setDefaultAutoDeletePeriod`).
 *  2. `offLabel` (`:25-27`) — `i18n('Off')` вместо `resolveFirst(<I18nTsx/>)`:
 *     тот же узел `IntlElement`.
 */
import { createMemo, createSignal, For } from 'solid-js'
import { Portal } from 'solid-js/web'
import { i18n } from '@lib/langPack'
import { wrapAsyncClickHandler } from '@helpers/wrapAsyncClickHandler'
import useIsConfirmationNeededOnClose from '@helpers/solid/useIsConfirmationNeededOnClose'
import SaveButton from '@components/saveButton.solid'
import Section from '@components/section.solid'
import SettingsTabLottieAnimation from '@components/settingsTabLottieAnimation.solid'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppMessagesAutoDeleteTab } from '@components/solidJsTabs/tabs'
import Space from '@components/space.solid'
import { findExistingOrCreateCustomOption, findMatchingCustomOption, getDefaultOptions, type Option } from '@components/sidebarLeft/tabs/autoDeleteMessages/options'
import showAutoDeleteMessagesCustomTimePopup from '@components/sidebarLeft/tabs/autoDeleteMessages/customTimePopup/index.solid'

const AutoDeleteMessages = () => {
  const [tab] = useSuperTab<typeof AppMessagesAutoDeleteTab>()

  const initialPeriod = findMatchingCustomOption(tab.payload.period)?.value || tab.payload.period

  const defaultOptions: Option[] = getDefaultOptions({
    offLabel: () => i18n('Off'),
  })

  const [period, setPeriod] = createSignal(initialPeriod)

  const hasChanges = createMemo(() => period() !== initialPeriod)

  const options = createMemo(() => {
    const result = [...defaultOptions]
    const localPeriod = period()

    for(let i = defaultOptions.length - 1; i >= 0; i--) {
      const value = defaultOptions[i].value

      if(localPeriod === value) break

      if(localPeriod > value) {
        result.splice(
          i + 1, 0,
          findExistingOrCreateCustomOption(localPeriod),
        )
        break
      }
    }

    return result
  })

  const saveSettings = wrapAsyncClickHandler(async() => {
    if(!hasChanges()) return

    try {
      await tab.managers!.privacy.setAutoDelete(period())
      tab.payload.onSaved(period())
    } finally {
      tab.close()
    }
  })

  tab.isConfirmationNeededOnClose = useIsConfirmationNeededOnClose({
    descriptionLangKey: 'UnsavedChangesDescription.Privacy',
    hasChanges,
    saveAllSettings: saveSettings,
  })

  const onOptionClick = (option: Option) => {
    setPeriod(option.value)
  }

  const onCustomOptionClick = () => {
    showAutoDeleteMessagesCustomTimePopup({
      descriptionLangKey: 'AutoDeleteMessages.InfoDefault',
      onFinish: (value) => {
        setPeriod(value)
      },
      period: period(),
    })
  }

  return (
    <>
      <Portal mount={tab.header}>
        <SaveButton hasChanges={hasChanges()} onClick={() => void saveSettings()} />
      </Portal>

      <Space amount="1rem" />
      <SettingsTabLottieAnimation name="UtyanDisappear" />
      <Space amount="2rem" />

      <Section name="AutoDeleteMessages.SectionTitle" caption="AutoDeleteMessages.SectionCaption">
        <For each={options()}>
          {(option) => (
            <Row>
              <Row.RadioField>
                <RadioFieldTsx
                  checked={period() === option.value}
                  name="auto-delete-period"
                  value={String(option.value)}
                  onChange={(checked) => checked && onOptionClick(option)}
                />
              </Row.RadioField>
              <Row.Title>{option.label()}</Row.Title>
            </Row>
          )}
        </For>
        <Row clickable={onCustomOptionClick}>
          <Row.Icon icon="tools" />
          <Row.Title>
            {i18n('AutoDeleteMessages.SetOtherTime')}
          </Row.Title>
        </Row>
      </Section>
    </>
  )
}

export default AutoDeleteMessages
