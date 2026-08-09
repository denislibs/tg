// TelInput — поле номера телефона на экране входа. Порт tweb
// `components/telInputField.ts` поверх `components/inputField.ts`; дерево 1:1 с
// живым оригиналом (dom-референс §4.3):
//
//   div.input-field.input-field-phone
//     div.input-field-input[contenteditable][inputmode="decimal"][data-left-pattern]
//     div.input-field-border
//     label > span.i18n
//
// Ключевое отличие от прежней нашей схемы: код страны — ЧАСТЬ значения поля, а не
// отдельный текст слева. Остаток недобранной маски рисует CSS-правило
// `.input-field-phone .input-field-input::after{content: attr(data-left-pattern)}`
// (`styles/tweb/_input.scss`), поэтому значение атрибута считает карточка.
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import classNames from '../../shared/lib/classNames'
import { placeCaretAtEnd } from '../../shared/lib/caret'
import { IS_ANDROID, IS_APPLE } from '@environment/userAgent'

export default function TelInput({
  value,
  leftPattern,
  error,
  label,
  autoFocus,
  elementRef,
  onInput,
  onEnter,
}: {
  /** полное значение поля — «+7 701 234 56 78» (код страны внутри) */
  value: string
  /** остаток маски для подсказки `::after` */
  leftPattern: string
  error?: boolean
  label: ReactNode
  autoFocus?: boolean
  /** доступ к полю снаружи: tweb возвращает в него фокус после выбора страны */
  elementRef?: RefObject<HTMLDivElement | null>
  /** сырой текст поля — форматирование и детект страны делает владелец состояния */
  onInput: (raw: string) => void
  onEnter: () => void
}) {
  const localRef = useRef<HTMLDivElement>(null)
  const inputRef = elementRef ?? localRef
  // Значение, посчитанное в обработчике `paste`: в contenteditable
  // `preventDefault()` вставку НЕ отменяет, поэтому tweb считает правильное
  // значение на paste и подменяет им содержимое в следующем `input`.
  const pastedRef = useRef<string | undefined>(undefined)
  // Слушатели keypress/paste вешаются один раз, поэтому актуальный колбэк —
  // через ref, а не через список зависимостей.
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter

  // tweb: на retina-Apple полю ставится отрицательный трекинг, на Android — 0,
  // при dpr = 1 свойство не выставляется вовсе.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    const pixelRatio = window.devicePixelRatio
    if (pixelRatio <= 1) return
    if (IS_APPLE) el.style.setProperty('--letter-spacing', `${pixelRatio * -0.16}px`)
    else if (IS_ANDROID) el.style.setProperty('--letter-spacing', '0px')
  }, [inputRef])

  // Отражение значения из состояния в contenteditable (tweb `setValueSilently`
  // + `placeCaretAtEnd`): React детей поля не держит, их мутирует браузер.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || el.textContent === value) return
    el.textContent = value
    if (document.activeElement === el) placeCaretAtEnd(el)
  })

  // tweb `focusWhenConnected(telEl)`; каретка — в конец, иначе первая цифра
  // уйдёт перед кодом страны (в поле уже лежит «+7»).
  useEffect(() => {
    const el = inputRef.current
    if (autoFocus && el) placeCaretAtEnd(el)
  }, [autoFocus, inputRef])

  // keypress/paste — нативными слушателями: React их либо не даёт (paste в
  // contenteditable нужен до `input`), либо помечает устаревшими (keypress).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return

    const onKeyPress = (e: KeyboardEvent) => {
      // InputField: перевода строки в поле быть не должно.
      if (e.key === 'Enter') {
        e.preventDefault()
        onEnterRef.current()
        return
      }
      // TelInputField: всё, кроме цифр (и «+» с Shift), не пропускается.
      if (/\D/.test(e.key) && !(e.metaKey || e.ctrlKey) && e.key !== 'Backspace' && !(e.key === '+' && e.shiftKey)) {
        e.preventDefault()
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      const clipboard = e.clipboardData?.getData('text/plain')
      const pastedDigits = clipboard?.replace(/\D/g, '')
      if (!clipboard || !pastedDigits) return

      // В поле уже лежит код страны, поэтому наивная вставка либо удвоила бы его,
      // либо оставила национальный «0» (tweb telInputField, обработчик `paste`).
      if (clipboard.trimStart().startsWith('+') || pastedDigits.startsWith('00')) {
        // Полный международный номер несёт свой код страны — он ЗАМЕЩАЕТ поле.
        pastedRef.current = '+' + (pastedDigits.startsWith('00') ? pastedDigits.slice(2) : pastedDigits)
      } else {
        // Национальный номер — код страны в поле остаётся, ведущий «0» отбрасывается.
        const currentDigits = (el.textContent ?? '').replace(/\D/g, '')
        pastedRef.current =
          '+' + currentDigits + (currentDigits ? pastedDigits.replace(/^0/, '') : pastedDigits)
      }
    }

    el.addEventListener('keypress', onKeyPress)
    el.addEventListener('paste', onPaste)
    return () => {
      el.removeEventListener('keypress', onKeyPress)
      el.removeEventListener('paste', onPaste)
    }
  }, [inputRef])

  return (
    <div className="input-field input-field-phone">
      <div
        ref={inputRef}
        className={classNames('input-field-input', error ? 'error' : '')}
        contentEditable
        suppressContentEditableWarning
        inputMode="decimal"
        data-no-linebreaks="1"
        data-left-pattern={leftPattern}
        onInput={() => {
          const el = inputRef.current
          if (!el) return
          if (pastedRef.current !== undefined) {
            el.textContent = pastedRef.current
            pastedRef.current = undefined
            placeCaretAtEnd(el)
          }
          onInput(el.textContent ?? '')
        }}
      />
      <div className="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span className="i18n">{label}</span>
      </label>
    </div>
  )
}
