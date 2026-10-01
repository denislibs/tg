/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/autoDeleteMessages/customTimePopup/content.tsx:1-52`
 * (812502980) — тело попапа своего срока: описание и барабан
 * (`VerticalOptionWheel`) «Never» + сроки `customTimeOptions`.
 *
 * Расхождения с оригиналом:
 *  1. `useHotReloadGuard().i18n` и `import.meta.hot` не перенесены — HMR у нас
 *     нет (`shared/solid/defineSolidElement.solid.tsx`, расхождение 1);
 *     `i18n` — из `@lib/langPack`, `I18nTsx key=…` — `i18n(key)` (узел тот же).
 */
import { createSignal } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import defineSolidElement, { type PassedProps } from '@shared/solid/defineSolidElement.solid'
import { VerticalOptionWheel } from '@components/verticalOptionWheel.solid'
import { customTimeOptions } from '@components/sidebarLeft/tabs/autoDeleteMessages/options'
import styles from '@components/sidebarLeft/tabs/autoDeleteMessages/customTimePopup/styles.module.scss'

type Props = {
  initialPeriod: number
  descriptionLangKey: LangPackKey
  onChange: (period: number) => void
}

export const AutoDeleteMessagesCustomTimePopupContent = defineSolidElement({
  name: 'auto-delete-messages-custom-time-popup-content',
  component: (props: PassedProps<Props>) => {
    const [period, setPeriod] = createSignal(props.initialPeriod)

    const options = [
      {
        value: 0,
        label: () => i18n('Never'),
      },
      ...customTimeOptions,
    ]

    return (
      <div class={styles.Container}>
        {i18n(props.descriptionLangKey)}

        <VerticalOptionWheel
          value={period()}
          onChange={(value) => {
            setPeriod(value)
            props.onChange(value)
          }}
          options={options.map((option) => ({
            label: option.label(),
            value: option.value,
          }))}
        />
      </div>
    )
  },
})
