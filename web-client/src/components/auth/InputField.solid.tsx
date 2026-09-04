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
// а `PasswordCard` строит своё поле руками). ЗАГОТОВКА С НАЗВАННЫМ БУДУЩИМ
// ПОТРЕБИТЕЛЕМ, не спекулятивный код: React `SignUpCard.tsx:32,163,174`
// инстанцирует `InputField` дважды (имя/фамилия, `maxLength` 70/64) — этот же
// узел понадобится `SignUpCard.solid.tsx` в задаче 5. До тех пор компонент
// не смонтирован НИГДЕ — как и у React-версии до её собственного первого
// потребителя.
//
// ── Вычеты против 843-строчного `inputField.ts` (сверх урезки, которую уже
// объявила шапка React-версии) ────────────────────────────────────────────
// Не портированы (нет потребителя ни у SignUpCard, ни в этой задаче):
// rich-text вставка (`insertRichTextAsHTML`, кастомные эмодзи, `paste`-хендлер
// ядра — SignUp просит только plain-text имя); `validate`/`isValid`/
// `isValidToChange`/`required` (React SignUpCard проверяет пустоту САМ, без
// встроенной валидации поля); `setState`/`InputState`/`setError` (у SignUp
// нет серверной ошибки уровня ПОЛЯ — только `NameRequired`/`NameTooLong`
// текстом); `placeholder`/`placeholderAsElement`; `autocomplete`;
// `withLinebreaks`/`plainText`-режим на `<input>`; `originalValue`/
// `isChanged`/`setOriginalValue`/`setDraftValue` (черновики — не наш REST-
// поток регистрации); `select()`/`setHidden`/`toggleForceFocus`;
// `canHaveFormatting`/`canWrapCustomEmojis` (форматирование — предмет чата,
// не имени при регистрации). Появится реальный потребитель — портировать
// точечно под него, не заранее.
//
// Как и у CountryInput/TelInput: содержимое contenteditable мутирует браузер,
// поэтому Solid не держит текст value как детей — он отражается императивно
// в эффекте (аналог React `useLayoutEffect` + `setValueSilently`).
import { createEffect, on, onMount, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { placeCaretAtEnd, syncContentEditableValue } from '@shared/lib/caret'

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
  //
  // `syncContentEditableValue`, а не голое `el.textContent = value` за
  // guard'ом строкового равенства — см. её докблок в `shared/lib/caret.ts`:
  // строковое сравнение не отличает ЧИСТЫЙ пустой узел от узла с одиноким
  // `<br>`, который браузер оставляет после удаления последнего символа
  // (найдено и исправлено в `TelInput.solid.tsx` — тот же паттерн здесь до
  // первого потребителя, но landmine тот же).
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!el) return
        syncContentEditableValue(el, value)
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
        onInput={() => {
          const raw = el.textContent ?? ''
          // Самоисцеление ДО и ПОСЛЕ вызова владельца — см. подробный
          // докблок в `TelInput.solid.tsx`: без ДО остаётся мусорный узел
          // (`<br>` после удаления последнего символа), без ПОСЛЕ поле не
          // подхватывает авторитетное значение владельца, если оно совпало
          // со старым (Solid-сигнал тогда не меняется, и нижестоящий
          // `createEffect(on(() => props.value, …))` не перезапускается).
          syncContentEditableValue(el, raw)
          props.onInput(raw)
          syncContentEditableValue(el, props.value)
        }}
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
