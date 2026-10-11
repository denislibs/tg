/** @jsxImportSource solid-js */
// Ряд «Повторять» календаря планирования (порт tweb `RepeatRow`,
// scheduleSendingPopup.tsx:110-155, без премиум-гейта — решение 2026-10-10).
// Предмет: ряд живёт островом внутри React-попапа, контейнер которого гасит
// всплытие щелчка (`shared/ui/Popup/Popup.tsx`), — выбор периода обязан
// открываться и там; выбранный период уходит в `onChange`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import ScheduleRepeatRow from './scheduleRepeatRow.solid'

const settle = async() => {
  for(let i = 0; i < 6; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

// В jsdom нет WAAPI, а список раскрывается `Element.animate` (inlineSelect.solid.tsx:103)
const originalAnimate = Element.prototype.animate
beforeEach(() => {
  Element.prototype.animate = function() {
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation
  }
})

let dispose: (() => void) | undefined
afterEach(() => {
  Element.prototype.animate = originalAnimate
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('ScheduleRepeatRow', () => {
  it('щелчок по ряду внутри контейнера, гасящего всплытие, открывает выбор периода; выбор уходит в onChange', async() => {
    const popupContainer = document.createElement('div')
    // как React-обработчик `onClick={(e) => e.stopPropagation()}` контейнера попапа
    popupContainer.addEventListener('click', (e) => e.stopPropagation())
    document.body.append(popupContainer)
    const onChange = vi.fn()
    dispose = render(() => <ScheduleRepeatRow initValue={0} onChange={onChange} />, popupContainer)

    const row = popupContainer.querySelector<HTMLElement>('.popup-schedule-repeat')!
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()

    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(options.length).toBe(8)
    options[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(onChange).toHaveBeenCalledWith(86400)
  })
})
