/** @jsxImportSource solid-js */
// TelInput — поле номера телефона на экране входа. Solid-порт нашего React
// `auth/TelInput.tsx`, который сам — порт tweb `components/telInputField.ts`
// (137 строк) поверх `components/inputField.ts`; дерево 1:1 с живым оригиналом
// (dom-референс §4.3):
//
//   div.input-field.input-field-phone
//     div.input-field-input[contenteditable][inputmode="decimal"][data-left-pattern]
//     div.input-field-border
//     label > span
//
// Код страны — ЧАСТЬ значения поля, не отдельный текст слева. Остаток
// недобранной маски рисует CSS-правило `.input-field-phone .input-field-input
// ::after{content: attr(data-left-pattern)}` (styles/tweb/_input.scss),
// поэтому значение атрибута считает карточка (см. `countries.ts::leftPattern`).
import { createEffect, on, onMount, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { placeCaretAtEnd } from '@shared/lib/caret'
import { IS_ANDROID, IS_APPLE } from '@environment/userAgent'

export type TelInputSolidProps = {
  /** полное значение поля — «+7 701 234 56 78» (код страны внутри) */
  value: string
  /** остаток маски для подсказки `::after` */
  leftPattern: string
  error?: boolean
  label: JSX.Element
  autoFocus?: boolean
  /** доступ к полю снаружи: карточка возвращает в него фокус после выбора страны */
  ref?: (el: HTMLDivElement) => void
  /** сырой текст поля — форматирование и детект страны делает владелец состояния */
  onInput: (raw: string) => void
  onEnter: () => void
}

export default function TelInput(props: TelInputSolidProps): JSX.Element {
  let el!: HTMLDivElement
  // Значение, посчитанное в обработчике `paste`: в contenteditable
  // `preventDefault()` вставку НЕ отменяет, поэтому tweb считает правильное
  // значение на paste и подменяет им содержимое в следующем `input`.
  let pasted: string | undefined

  onMount(() => {
    props.ref?.(el)

    // tweb: на retina-Apple полю ставится отрицательный трекинг, на Android — 0,
    // при dpr = 1 свойство не выставляется вовсе.
    const pixelRatio = window.devicePixelRatio
    if (pixelRatio > 1) {
      if (IS_APPLE) el.style.setProperty('--letter-spacing', `${pixelRatio * -0.16}px`)
      else if (IS_ANDROID) el.style.setProperty('--letter-spacing', '0px')
    }

    // tweb `focusWhenConnected(telEl)`; каретка — в конец, иначе первая цифра
    // уйдёт перед кодом страны (в поле уже лежит «+7»).
    if (props.autoFocus) placeCaretAtEnd(el)

    // keypress/paste — нативными слушателями: Solid их либо не даёт (paste в
    // contenteditable нужен до `input`), либо помечает устаревшими (keypress).
    const onKeyPress = (e: KeyboardEvent) => {
      // InputField: перевода строки в поле быть не должно.
      if (e.key === 'Enter') {
        e.preventDefault()
        props.onEnter()
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
        pasted = '+' + (pastedDigits.startsWith('00') ? pastedDigits.slice(2) : pastedDigits)
      } else {
        // Национальный номер — код страны в поле остаётся, ведущий «0» отбрасывается.
        const currentDigits = (el.textContent ?? '').replace(/\D/g, '')
        pasted = '+' + currentDigits + (currentDigits ? pastedDigits.replace(/^0/, '') : pastedDigits)
      }
    }

    el.addEventListener('keypress', onKeyPress)
    el.addEventListener('paste', onPaste)
  })

  // Отражение значения из пропа в contenteditable (tweb `setValueSilently` +
  // `placeCaretAtEnd`): Solid не держит текст value как детей, узел мутирует
  // браузер. `createEffect`, а не `createRenderEffect` — вызов стоит ВЫШЕ JSX
  // по тексту функции, и `ref={el}` присваивается только когда JSX реально
  // строится; `createRenderEffect` выполнился бы синхронно ДО этого момента
  // (el ещё `undefined`) и первое значение осталось бы неотражённым до первой
  // же смены `props.value`. `createEffect` идёт отдельным проходом ПОСЛЕ
  // коммита — el уже назначен.
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

  return (
    <div class="input-field input-field-phone">
      <div
        ref={el}
        class={classNames('input-field-input', props.error ? 'error' : '')}
        contentEditable
        inputMode="decimal"
        data-no-linebreaks="1"
        data-left-pattern={props.leftPattern}
        onInput={() => {
          if (pasted !== undefined) {
            el.textContent = pasted
            pasted = undefined
            placeCaretAtEnd(el)
          }
          props.onInput(el.textContent ?? '')
        }}
      />
      <div class="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span>{props.label}</span>
      </label>
    </div>
  )
}
