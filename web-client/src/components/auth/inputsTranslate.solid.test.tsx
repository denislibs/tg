/** @jsxImportSource solid-js */
// ── ПИН tweb 9909f2b1a: переводчик браузера не переписывает вводимое ──────────
//
// Перевод страницы (и расширения-переводчики) заменяют текстовые узлы прямо
// внутри contenteditable, а значение поля читается из DOM — ушёл бы перевод.
// `notranslate` в index.html гасит только автопредложение. tweb ставит
// `input.translate = false` на каждое contenteditable-поле `InputField`
// (inputField.ts:543-546) — у нас это три Solid-поля экрана входа.
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'

import InputField from './InputField.solid'
import TelInput from './TelInput.solid'
import CountryInput from './CountryInput.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

function editable(mountFn: () => unknown): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(mountFn as () => never, host)
  return host.querySelector<HTMLElement>('[contenteditable]')!
}

describe('contenteditable-поля без перевода (tweb 9909f2b1a)', () => {
  it('InputField', () => {
    const el = editable(() => <InputField value="" label="Name" onInput={() => {}} />)
    expect(el.getAttribute('translate')).toBe('no')
  })

  it('TelInput', () => {
    const el = editable(() => <TelInput value="+" leftPattern="" label="Phone" onInput={() => {}} onEnter={() => {}} />)
    expect(el.getAttribute('translate')).toBe('no')
  })

  it('CountryInput', () => {
    const el = editable(() => <CountryInput value={null} onChange={() => {}} />)
    expect(el.getAttribute('translate')).toBe('no')
  })
})
