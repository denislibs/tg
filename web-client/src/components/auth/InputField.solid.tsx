/** @jsxImportSource solid-js */
// InputField — текстовое поле экрана входа. Solid-порт нашего React
// `auth/InputField.tsx`, который сам — урезанный порт tweb
// `components/inputField.ts` (843 строки) до объёма, которым пользуются
// карточки: `label`/`maxLength`/`autoFocus`/`onInput`/`onEnter` на
// contenteditable-`div` (у tweb `plainText` по умолчанию выключен, весь CSS
// `.input-field-input` написан под div, не под `<input>`). Дерево 1:1:
//
//   div.input-field
//     div.input-field-input.is-empty[contenteditable="true"]
//     div.input-field-border
//     label[style="visibility: visible;"] > span
//
// Ни одна из трёх карточек задачи 4 не инстанцирует этот компонент напрямую
// (в tweb SignInCard/AuthCodeCard/PasswordCard тоже не берут голый
// `InputField` — им пользуются подклассы `CountryInputField`/`TelInputField`,
// а `PasswordCard` строит своё поле руками). Это базовый примитив про запас
// для будущих карточек (SignUp/EmailRecover, задача 5) — как и у React-версии.
//
// Как и у CountryInput/TelInput: содержимое contenteditable мутирует браузер,
// поэтому Solid не держит текст value как детей — он отражается императивно
// в эффекте (аналог React `useLayoutEffect` + `setValueSilently`).
import { createEffect, on, onMount, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { placeCaretAtEnd } from '@shared/lib/caret'

export type InputFieldSolidProps = {
  value: string
  label: JSX.Element
  /** лимит длины: сверх него на поле `.error`, у подписи — счётчик остатка (tweb) */
  maxLength?: number
  autoFocus?: boolean
  onInput: (value: string) => void
  onEnter?: () => void
}

export default function InputField(props: InputFieldSolidProps): JSX.Element {
  let el!: HTMLDivElement

  // Отражение значения из пропа в contenteditable (tweb `setValueSilently`).
  // `on(() => props.value, ...)` — эффект перечитывается ТОЛЬКО по смене
  // значения. `createEffect`, а не `createRenderEffect` — см. тот же
  // комментарий в `TelInput.solid.tsx`: вызов стоит выше JSX по тексту
  // функции, `ref={el}` назначается позже, `createRenderEffect` увидел бы
  // `el === undefined` на первом прогоне.
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!el || el.textContent === value) return
        el.textContent = value
        if (document.activeElement === el) placeCaretAtEnd(el)
      },
    ),
  )

  onMount(() => {
    if (props.autoFocus) {
      el.focus()
      placeCaretAtEnd(el)
    }

    // Enter — нативным keypress (как в tweb InputField), не Solid-пропом:
    // перевода строки в поле быть не должно, а keypress уже не даёт JSX.
    const onKeyPress = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      props.onEnter?.()
    }
    el.addEventListener('keypress', onKeyPress)
  })

  // tweb: счётчик остатка показывается, когда до лимита осталось не больше
  // `showLengthOn = min(40, round(maxLength / 3))`; сверх лимита — плюс `.error`.
  const length = () => [...props.value].length
  const diff = () => (props.maxLength === undefined ? Infinity : props.maxLength - length())
  const showLengthOn = () => (props.maxLength === undefined ? 0 : Math.min(40, Math.round(props.maxLength / 3)))
  const error = () => diff() < 0

  return (
    <div class="input-field">
      <div
        ref={el}
        class={classNames('input-field-input', props.value ? '' : 'is-empty', error() ? 'error' : '')}
        contentEditable
        data-no-linebreaks="1"
        onInput={() => props.onInput(el.textContent ?? '')}
      />
      <div class="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span>{props.label}</span>
        {/* tweb дописывает остаток текстовым узлом прямо в label, за span */}
        {diff() <= showLengthOn() ? ` (${diff()})` : ''}
      </label>
    </div>
  )
}
