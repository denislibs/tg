/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/inputFieldTsx.tsx` (812502980, 95 строк) —
 * Solid-обёртка над императивным `InputField`: узел строит класс, эффекты
 * переносят в него `class`, `errorLabel` (+ `errorLabelOptions`),
 * `errorDescriptionId`, `value`, `label` (+ `labelOptions`), `disabled`.
 * Потребители в плане 2D — профиль, 2FA, редактор папки.
 *
 * Расширение `.solid.tsx` при отсутствии JSX — как у `checkboxFieldTsx.solid.tsx`.
 *
 * Отличия от оригинала:
 *  1. `InstanceOf<T>` (`@types`) → `InstanceType<T>`: у нас такого алиаса нет,
 *     стандартный — то же самое.
 *  2. `label` в эффекте — `props.label!`: у tweb `strict` выключен, а поле без
 *     `label` эффект и не трогает по смыслу (`i18n(undefined)` там — тот же
 *     путь, что у класса); поведение то же.
 *  3. Пропы класса — наш урезанный `InputFieldOptions` (расхождения — в шапке
 *     `inputField.ts`).
 *  4. Под наш strict/oxlint: конструктор — через приведение
 *     `props.InputFieldClass as typeof InputField` (тип `mergeProps` не
 *     сужается до конструктора), `prev && …` → `if` — поведение то же.
 */
import { createEffect, mergeProps, on, splitProps } from 'solid-js'

import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'

import InputField, { type InputFieldOptions, InputState } from '@components/inputField'

export interface InputFieldTsxProps<T extends typeof InputField> extends InputFieldOptions {
  InputFieldClass?: T

  instanceRef?: (value: InstanceType<T>) => void

  class?: string
  value?: string | Node
  onRawInput?: (value: string) => void
  errorLabel?: LangPackKey | null
  errorLabelOptions?: FormatterArguments
  errorDescriptionId?: string
  disabled?: boolean
}

export const InputFieldTsx = <T extends typeof InputField>(inProps: InputFieldTsxProps<T>) => {
  const props = mergeProps({ InputFieldClass: InputField }, inProps)

  const [, options] = splitProps(
    props,
    ['class', 'value', 'InputFieldClass', 'errorLabel', 'errorLabelOptions', 'errorDescriptionId', 'disabled'],
  )

  const obj = new (props.InputFieldClass as typeof InputField)(options)
  props.instanceRef?.(obj as InstanceType<T>)

  createEffect(on(
    () => props.class,
    (value, prev) => {
      if(prev) obj.container.classList.remove(prev)
      if(value) obj.container.classList.add(value)
    },
  ))

  createEffect(on(
    () => [props.errorLabel, props.errorLabelOptions] as const,
    ([error, options], prev) => {
      if(!error && !prev) return // Prevent setting error first render

      const isError = error !== undefined
      if(isError) obj.setError(error ?? undefined, options)
      else obj.setState(InputState.Neutral)
    },
  ))

  createEffect(on(
    () => props.errorDescriptionId,
    (value, prev) => {
      const describedBy = new Set(
        (obj.input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
      )
      if(prev) describedBy.delete(prev)
      if(value) describedBy.add(value)

      if(describedBy.size) {
        obj.input.setAttribute('aria-describedby', [...describedBy].join(' '))
      } else {
        obj.input.removeAttribute('aria-describedby')
      }
    },
  ))

  createEffect(on(
    () => props.value,
    (value) => {
      if(value !== obj.value && value !== undefined) {
        obj.value = value
      }
    },
  ))

  createEffect(on(
    () => [props.label, props.labelOptions] as const,
    ([value, options]) => {
      if(value !== obj.label?.textContent) {
        obj.label.replaceChildren(i18n(value!, options))
      }
    },
  ))

  createEffect(on(
    () => props.disabled,
    (value) => {
      obj.input.toggleAttribute('disabled', !!value)
    },
  ))

  return obj.container
}
