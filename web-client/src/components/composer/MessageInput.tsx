// src/components/composer/MessageInput.tsx
// Инпут композера — дерево tweb `chat/input.ts:1028` + `inputField.ts:650-657`
// + `inputFieldAnimated.ts:37-41` (монтаж всех трёх узлов — input.ts:2936):
//
//   div.input-message-container
//     div.input-message-input.is-empty.scrollable.scrollable-y.no-scrollbar.forwards[contenteditable]
//     span.input-field-placeholder.i18n.is-empty
//     div.input-message-input.is-empty.scrollable.scrollable-y.no-scrollbar.input-field-input-fake[contenteditable]
//
// Плейсхолдер — отдельный СИБЛИНГ инпута, а не оверлей поверх него; `is-empty`
// висит на обоих узлах сразу (inputField.ts:776-780), CSS уводит плейсхолдер
// прозрачностью и `translateX(1rem)` (_input.scss:230-252).
import type { ClipboardEvent, DragEvent, KeyboardEvent, RefObject } from 'react'
import classNames from '../../shared/lib/classNames'

interface Props {
  inputRef: RefObject<HTMLDivElement | null>
  fakeRef: RefObject<HTMLDivElement | null>
  empty: boolean
  placeholder: string
  /** data-peer-id, как в tweb (input.ts) — маркер «инпут этого пира» */
  peerId?: number
  onInput: () => void
  onKeyDown: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  onDrop: (e: DragEvent) => void
}

export default function MessageInput({
  inputRef, fakeRef, empty, placeholder, peerId, onInput, onKeyDown, onPaste, onDrop,
}: Props) {
  const emptyCls = empty ? 'is-empty' : ''
  // `scrollable scrollable-y no-scrollbar` в tweb приходят от `new Scrollable(...)`,
  // `forwards` — от SetTransition вокруг `is-changing-height` (inputFieldAnimated.ts:87-97);
  // в живом дампе оба набора висят на инпуте постоянно.
  const base = classNames('input-message-input', emptyCls, 'scrollable', 'scrollable-y', 'no-scrollbar')

  return (
    <div className="input-message-container">
      <div
        ref={inputRef}
        className={classNames(base, 'forwards')}
        contentEditable
        suppressContentEditableWarning
        data-peer-id={peerId}
        // отступление от tweb: явные role/aria — у оригинала их нет, но без них
        // contenteditable не виден ассистивным технологиям (и тестам по роли).
        role="textbox"
        aria-multiline
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
      />
      <span className={classNames('input-field-placeholder', emptyCls)}>{placeholder}</span>
      {/* Фейк-инпут заполняется ТОЛЬКО через ref (useInputHeight), никогда через
          children: иначе React перерисовывал бы кастом-эмодзи и спойлеры дважды. */}
      <div
        ref={fakeRef}
        className={classNames(base, 'input-field-input-fake')}
        contentEditable
        suppressContentEditableWarning
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}
