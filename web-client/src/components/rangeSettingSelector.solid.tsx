/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/rangeSettingSelector.tsx` (812502980, 45 строк) —
 * строка-ползунок настроек: `div.range-setting-selector > -details(-name,
 * -value) + RangeSelector` (дерево — дамп `14-left-14`, узел «Sound Volume»;
 * стили — `styles/tweb/_leftSidebar.scss` `.range-setting-selector`).
 * Имя над треком — единственная видимая подпись ползунка, поэтому `input`
 * связан с ним `labelControl` (472e3e76b).
 *
 * Отличий от оригинала нет.
 */
import { createEffect, createSignal, type JSX } from 'solid-js'
import RangeSelector from '@components/rangeSelectorTsx.solid'
import labelControl from '@helpers/dom/labelControl'

export default function RangeSettingSelector(props: {
  textLeft: JSX.Element
  textRight: (value: number) => JSX.Element
  step: number
  value: number
  minValue: number
  maxValue: number
  onChange?: (value: number) => void
  onMouseUp?: () => void
}) {
  const [value, setValue] = createSignal(props.value)

  // The name above the track is the slider's only visible label; tie them
  // together so it is not an anonymous "slider" to assistive technology.
  let nameRef!: HTMLDivElement

  createEffect(() => {
    setValue(props.value)
  })

  return (
    <div class="range-setting-selector">
      <div class="range-setting-selector-details">
        <div class="range-setting-selector-name" ref={nameRef}>{props.textLeft}</div>
        <div class="range-setting-selector-value">{props.textRight(value())}</div>
      </div>
      <RangeSelector
        inputRef={(el) => labelControl(el, nameRef)}
        step={props.step}
        min={props.minValue}
        max={props.maxValue}
        value={props.value}
        onScrub={(value) => {
          props.onChange?.(value)
          setValue(value)
        }}
        onMouseUp={props.onMouseUp}
      />
    </div>
  )
}
