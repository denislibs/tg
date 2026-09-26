// ── ПИН tweb 9909f2b1a: переводчик браузера не переписывает сообщение ─────────
//
// Значение инпута читается обратно из DOM (`getRichValueWithCaret` у tweb,
// `core/richtext/markdown.ts` у нас): переведённый инпут отправил бы то, что
// написал переводчик, — с поломанными сущностями и кастом-эмодзи. tweb ставит
// `translate = false` на инпут (inputField.ts:543-546) и на зеркало высоты
// (inputFieldAnimated.ts:40), чтобы они не разошлись.
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import MessageInput from './MessageInput'

afterEach(() => {
  cleanup()
})

describe('MessageInput без перевода (tweb 9909f2b1a)', () => {
  it('и инпут, и зеркало высоты несут translate="no"', () => {
    const inputRef = createRef<HTMLDivElement>()
    const fakeRef = createRef<HTMLDivElement>()
    render(
      <MessageInput
        inputRef={inputRef}
        fakeRef={fakeRef}
        empty
        placeholder="Message"
        onInput={() => {}}
        onKeyDown={() => {}}
        onPaste={() => {}}
        onDrop={() => {}}
      />,
    )
    expect(inputRef.current!.getAttribute('translate')).toBe('no')
    expect(fakeRef.current!.getAttribute('translate')).toBe('no')
  })
})
