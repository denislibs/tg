/** @jsxImportSource solid-js */
/**
 * Пин на `onFocusChange` (`CodeInput.solid.tsx`) — единственный потребитель
 * пропа сегодня — `TrackingMonkey.solid.tsx` (закрывает/открывает глаза на
 * фокусе поля кода, tweb `monkeys/tracking.ts:24-33`). Проп зовётся ровно из
 * тех же обработчиков, где инпут реально получает/теряет фокус (`onFocus`/
 * `onBlur` на самом `<input>`), а не из производного состояния — поэтому пин
 * дёргает НАСТОЯЩИЕ DOM-события `focus`/`blur`, а не читает внутренний сигнал.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import CodeInput from './CodeInput.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function unmount() {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
}

function mount(onFocusChange: (focused: boolean) => void) {
  unmount()
  const [value, setValue] = createSignal('')
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <CodeInput
        length={5}
        value={value()}
        onChange={setValue}
        onComplete={() => {}}
        onFocusChange={onFocusChange}
      />
    ),
    host,
  )
  return { el: () => host!.querySelector('input') as HTMLInputElement }
}

describe('CodeInput.solid: onFocusChange', () => {
  it('фокус на инпуте зовёт onFocusChange(true)', () => {
    const onFocusChange = vi.fn()
    const { el } = mount(onFocusChange)

    el().dispatchEvent(new Event('focus'))

    expect(onFocusChange).toHaveBeenCalledWith(true)
  })

  it('потеря фокуса зовёт onFocusChange(false)', () => {
    const onFocusChange = vi.fn()
    const { el } = mount(onFocusChange)

    el().dispatchEvent(new Event('focus'))
    onFocusChange.mockClear()
    el().dispatchEvent(new Event('blur'))

    expect(onFocusChange).toHaveBeenCalledWith(false)
  })

  it('без пропа фокус/блюр не падают (проп опционален)', () => {
    unmount()
    const [value, setValue] = createSignal('')
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(
      () => <CodeInput length={5} value={value()} onChange={setValue} onComplete={() => {}} />,
      host,
    )
    const el = host.querySelector('input') as HTMLInputElement
    expect(() => {
      el.dispatchEvent(new Event('focus'))
      el.dispatchEvent(new Event('blur'))
    }).not.toThrow()
  })
})
