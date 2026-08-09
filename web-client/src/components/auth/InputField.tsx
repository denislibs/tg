// InputField — текстовое поле экрана входа. Порт tweb `components/inputField.ts`
// в объёме, который использует карточка регистрации (`new InputField({label, maxLength})`).
// Дерево 1:1 с живым оригиналом (dom-референс §2.5):
//
//   div.input-field
//     div.input-field-input.is-empty[contenteditable="true"]
//     div.input-field-border
//     label[style="visibility: visible;"] > span.i18n
//
// Как и `TelInput`, поле — contenteditable-`div`, а не `<input>`: у tweb
// `plainText` по умолчанию выключен, и весь CSS (`.input-field-input`) написан
// под div. Содержимое мутирует браузер, поэтому React детей поля не держит —
// значение отражается императивно (tweb `setValueSilently`).
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import { placeCaretAtEnd } from '../../shared/lib/caret'

export default function InputField({
  value,
  label,
  maxLength,
  autoFocus,
  onInput,
  onEnter,
}: {
  value: string
  label: ReactNode
  /** лимит длины: сверх него на поле `.error`, у подписи — счётчик остатка (tweb) */
  maxLength?: number
  autoFocus?: boolean
  onInput: (value: string) => void
  onEnter?: () => void
}) {
  const inputRef = useRef<HTMLDivElement>(null)
  // Enter вешается нативным keypress (как в tweb InputField) — актуальный колбэк
  // берём через ref, чтобы не переподписываться на каждый рендер.
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter

  // Отражение значения из состояния в contenteditable.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || el.textContent === value) return
    el.textContent = value
    if (document.activeElement === el) placeCaretAtEnd(el)
  })

  useEffect(() => {
    const el = inputRef.current
    if (autoFocus && el) {
      el.focus()
      placeCaretAtEnd(el)
    }
  }, [autoFocus])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    // InputField: перевода строки в поле быть не должно.
    const onKeyPress = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      onEnterRef.current?.()
    }
    el.addEventListener('keypress', onKeyPress)
    return () => el.removeEventListener('keypress', onKeyPress)
  }, [])

  // tweb: счётчик остатка показывается, когда до лимита осталось не больше
  // `showLengthOn = min(40, round(maxLength / 3))`; сверх лимита — плюс `.error`.
  const length = [...value].length
  const diff = maxLength === undefined ? Infinity : maxLength - length
  const showLengthOn = maxLength === undefined ? 0 : Math.min(40, Math.round(maxLength / 3))
  const error = diff < 0

  return (
    <div className="input-field">
      <div
        ref={inputRef}
        className={classNames('input-field-input', value ? '' : 'is-empty', error ? 'error' : '')}
        contentEditable
        suppressContentEditableWarning
        data-no-linebreaks="1"
        onInput={() => onInput(inputRef.current?.textContent ?? '')}
      />
      <div className="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span className="i18n">{label}</span>
        {/* tweb дописывает остаток текстовым узлом прямо в label, за span.i18n */}
        {diff <= showLengthOn ? ` (${diff})` : ''}
      </label>
    </div>
  )
}
