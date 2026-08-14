// Пин DOM-структуры календаря по дампу tweb
// (`docs/research/tweb-dom/17-popup-06-date-picker.json`):
//   div.popup.popup-schedule.popup-date-picker > div.popup-container.z-depth-1 >
//     div.popup-header (popup-close + div.popup-title > .date-picker-month-title
//                       + .date-picker-controls > .date-picker-prev/.date-picker-next)
//     + div.scrollable.scrollable-y.popup-scrollable.date-picker-scrollable
//         > .date-picker-months > .date-picker-month-section
//             > .date-picker-month-label + .date-picker-weekdays > .date-picker-weekday
//               + .date-picker-month-grid > .date-picker-spacer
//                                         / button.btn-icon.date-picker-month-date
//                                             > span.date-picker-day-num
//     + div.popup-footer.popup-footer-abitlarger > button.popup-footer-button
// Вся геометрия сетки живёт в `styles/tweb/popups/_datePicker.scss` и цепляется
// ТОЛЬКО за эти классы — своего модуля у попапа больше нет.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import DatePickerPopup from './DatePickerPopup'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'

const noop = () => {}
// 15 августа 2026 — день внутри месяца, чтобы в сетке были и спейсеры, и дни
const INIT = new Date(2026, 7, 15, 12, 0, 0).getTime()

function renderPicker(props: Partial<Parameters<typeof DatePickerPopup>[0]> = {}) {
  const managers = { messages: { calendarMonth: vi.fn().mockResolvedValue([]) } } as unknown as Managers
  render(
    <ManagersProvider managers={managers}>
      <DatePickerPopup open initDate={INIT} minDate={INIT} onClose={noop} onPick={noop} {...props} />
    </ManagersProvider>,
  )
}

describe('DatePickerPopup — разметка tweb', () => {
  afterEach(cleanup)

  it('корень popup-schedule popup-date-picker, тела popup-body нет', () => {
    renderPicker()
    const root = document.querySelector('.popup')!
    expect(root.classList.contains('popup-schedule')).toBe(true)
    expect(root.classList.contains('popup-date-picker')).toBe(true)
    // tweb datePicker.tsx:811 — роль тела играет сам PopupElement.Scrollable
    expect(root.querySelector('.popup-body')).toBeNull()
  })

  it('хедер: .popup-title > .date-picker-month-title + .date-picker-controls со стрелками', () => {
    renderPicker()
    const header = document.querySelector('.popup-container > .popup-header')!
    expect(header.querySelector('.popup-title > .date-picker-month-title')!.textContent).toContain('2026')

    const controls = header.querySelector(':scope > .date-picker-controls')!
    const prev = controls.querySelector('.date-picker-prev')!
    const next = controls.querySelector('.date-picker-next')!
    // tweb ButtonIconTsx: btn-icon + `primary` (цвет из base.scss-утилиты)
    for (const btn of [prev, next]) {
      expect(btn.classList.contains('btn-icon')).toBe(true)
      expect(btn.classList.contains('primary')).toBe(true)
    }
  })

  it('скроллер — .scrollable.scrollable-y.popup-scrollable.date-picker-scrollable.scrollable-y-bordered', () => {
    renderPicker()
    const scrollable = document.querySelector('.popup-container > .date-picker-scrollable')!
    expect([...scrollable.classList]).toEqual(
      expect.arrayContaining(['scrollable', 'scrollable-y', 'popup-scrollable', 'date-picker-scrollable', 'scrollable-y-bordered']),
    )
    // без прокрутки верхняя линия скрыта (tweb withBorders="both")
    expect(scrollable.classList.contains('scrolled-start')).toBe(true)
  })

  it('секция месяца: label + weekdays + grid со спейсерами и днями', () => {
    renderPicker()
    const months = document.querySelector('.date-picker-scrollable > .date-picker-months')!
    const section = months.querySelector(':scope > .date-picker-month-section')!
    expect(section.querySelector(':scope > .date-picker-month-label')!.textContent).toContain('2026')

    const weekdays = section.querySelectorAll(':scope > .date-picker-weekdays > .date-picker-weekday')
    expect(weekdays.length).toBe(7)
    // выходные помечены глобальным .danger
    expect([...weekdays].filter((w) => w.classList.contains('danger')).length).toBe(2)

    const grid = section.querySelector(':scope > .date-picker-month-grid')!
    expect(grid.querySelectorAll(':scope > .date-picker-spacer').length).toBeGreaterThan(0)

    const day = grid.querySelector('button.date-picker-month-date')!
    expect(day.classList.contains('btn-icon')).toBe(true)
    expect(day.querySelector('span.date-picker-day-num')).not.toBeNull()

    // выбранный день — .active и БЕЗ .danger (глобальный .danger идёт с !important)
    const active = grid.querySelector('button.date-picker-month-date.active')!
    expect(active.querySelector('.date-picker-day-num')!.textContent).toBe('15')
    expect(active.classList.contains('danger')).toBe(false)
  })

  it('футер: popup-footer popup-footer-abitlarger > popup-footer-button btn-primary btn-color-primary', () => {
    renderPicker()
    const footer = document.querySelector('.popup-container > .popup-footer')!
    expect(footer.classList.contains('popup-footer-abitlarger')).toBe(true)
    expect([...footer.querySelector('button')!.classList]).toEqual(
      expect.arrayContaining(['popup-footer-button', 'btn-primary', 'btn-color-primary']),
    )
  })

  it('withTime: .date-picker-time вне футера, вторичная кнопка — popup-schedule-secondary', () => {
    renderPicker({ withTime: true, secondaryAction: { label: 'Send when online', onClick: noop } })

    const time = document.querySelector('.popup-container > .date-picker-time')!
    expect(time).not.toBeNull()
    expect(time.querySelector('.date-picker-time-delimiter')!.textContent).toBe(':')
    expect(time.querySelectorAll('.input-field').length).toBe(2)

    const buttons = document.querySelectorAll('.popup-footer > button')
    expect(buttons.length).toBe(2)
    expect([...buttons[1].classList]).toEqual(
      expect.arrayContaining(['popup-footer-button', 'btn-primary', 'btn-transparent', 'primary', 'popup-schedule-secondary']),
    )
  })
})
