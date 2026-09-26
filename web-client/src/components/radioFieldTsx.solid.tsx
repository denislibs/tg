/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/radioFieldTsx.tsx` (812502980, 49 строк) — только
 * контрол: монтируется через `Row.RadioField`, подпись — в `Row.Title`
 * (tweb `:6`). Узел строит императивный `RadioField` (`span.radio-field`),
 * компонент связывает с ним `checked`/`locked`/`ariaLabel` и отдаёт `change`.
 *
 * Расширение `.solid.tsx` при отсутствии JSX — по той же причине, что у
 * `checkboxFieldTsx.solid.tsx` (маска рантаймов `shared/solid/fileRuntime.ts`).
 *
 * Отличий от оригинала нет: пропы — `ConstructorParameters<typeof RadioField>[0]`,
 * как у tweb; у нашего `RadioField` в них нет `stateKey`/`valueForState`
 * (расхождение объявлено в `radioField.ts`).
 */
import { createEffect, splitProps } from 'solid-js'
import RadioField from '@components/radioField'
import { attachClassName } from '@helpers/solid/classname'
import { subscribeOn } from '@helpers/solid/subscribeOn'

export default function RadioFieldTsx(props: ConstructorParameters<typeof RadioField>[0] & {
  ariaLabel?: string
  checked?: boolean
  class?: string
  locked?: boolean
  onChange?: (checked: boolean, event: Event) => void
}) {
  const [local, radioProps] = splitProps(props, [
    'ariaLabel',
    'checked',
    'class',
    'locked',
    'onChange',
  ])
  const radioField = new RadioField(radioProps)

  createEffect(() => {
    if(local.checked !== undefined) {
      radioField.setValueSilently(local.checked)
    }
  })

  createEffect(() => {
    radioField.locked = !!local.locked
  })

  createEffect(() => {
    const ariaLabel = local.ariaLabel
    if(ariaLabel) {
      radioField.input.setAttribute('aria-label', ariaLabel)
    } else {
      radioField.input.removeAttribute('aria-label')
    }
  })

  subscribeOn(radioField.input)('change', (event) => {
    local.onChange?.(radioField.checked, event)
  })

  attachClassName(radioField.container, () => local.class)

  return radioField.container
}
