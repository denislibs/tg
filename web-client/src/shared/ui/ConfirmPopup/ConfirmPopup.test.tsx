// Пин DOM-структуры конфирма по дампам tweb
// (`docs/tweb/dom/dumps/17-popup-03-delete-message.json`, `06-delete-popup.json`):
//   div.popup.popup-peer.popup-delete-chat >
//     div.popup-container.z-depth-1[.have-checkbox] >
//       div.popup-header (avatar + div.popup-title)
//       + p.popup-description
//       + label.checkbox-field.checkbox-ripple.hover-effect.rp > span.checkbox-caption
//       + div.popup-buttons > button.popup-button.btn.danger.rp
//                           + button.popup-button.btn.primary.rp
// Геометрию и цвет дают партиалы `popups/_popup.scss` / `popups/_peer.scss` и
// утилиты `.danger`/`.primary` — потеря класса ломает вёрстку молча.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import ConfirmPopup from './ConfirmPopup'

const noop = () => {}

describe('ConfirmPopup — разметка tweb PopupPeer', () => {
  afterEach(cleanup)

  it('корень popup popup-peer + модификатор, контейнер z-depth-1', () => {
    render(
      <ConfirmPopup
        className="popup-delete-chat"
        avatar={<div className="avatar avatar-32" />}
        title="Delete message"
        description="Are you sure you want to delete this message?"
        buttons={[{ text: 'Delete', danger: true, onClick: noop }]}
        onClose={noop}
      />,
    )

    const root = document.querySelector('.popup')!
    expect(root.classList.contains('popup-peer')).toBe(true)
    expect(root.classList.contains('popup-delete-chat')).toBe(true)

    const container = root.querySelector('.popup-container')!
    expect(container.classList.contains('z-depth-1')).toBe(true)
    // без чекбоксов have-checkbox не вешается (tweb peer.ts:85)
    expect(container.classList.contains('have-checkbox')).toBe(false)

    // хедер: аватар 32 ПЕРЕД заголовком (tweb header.prepend(node))
    const header = container.querySelector(':scope > .popup-header')!
    expect(header.firstElementChild!.classList.contains('avatar-32')).toBe(true)
    expect(header.querySelector('.popup-title')!.textContent).toBe('Delete message')

    // описание — именно <p class="popup-description"> (tweb peer.ts:68-70)
    const description = container.querySelector(':scope > p.popup-description')!
    expect(description.textContent).toBe('Are you sure you want to delete this message?')
  })

  it('кнопки: popup-buttons > .popup-button.btn.danger, затем .popup-button.btn.primary (Cancel)', () => {
    const onDelete = vi.fn()
    render(
      <ConfirmPopup
        title="Delete message"
        buttons={[{ text: 'Delete', danger: true, onClick: onDelete }]}
        onClose={noop}
      />,
    )

    const buttons = document.querySelector('.popup-container > .popup-buttons')!
    // ряд горизонтальный, пока кнопок с авто-Cancel меньше трёх
    expect(buttons.classList.contains('is-vertical-layout')).toBe(false)

    const els = [...buttons.querySelectorAll('button')]
    expect(els.length).toBe(2)
    expect([...els[0].classList]).toEqual(expect.arrayContaining(['popup-button', 'btn', 'danger', 'rp']))
    expect(els[0].classList.contains('primary')).toBe(false)
    expect(els[0].textContent).toBe('Delete')
    expect([...els[1].classList]).toEqual(expect.arrayContaining(['popup-button', 'btn', 'primary', 'rp']))
    expect(els[1].classList.contains('danger')).toBe(false)
    // ripple — первым ребёнком каждой кнопки (tweb ripple(button))
    expect(els[0].firstElementChild!.className).toBe('c-ripple')

    fireEvent.click(els[0])
  })

  it('≥3 кнопок с авто-Cancel — popup-buttons is-vertical-layout', () => {
    render(
      <ConfirmPopup
        title="T"
        buttons={[{ text: 'A', onClick: noop }, { text: 'B', onClick: noop }]}
        onClose={noop}
      />,
    )
    expect(document.querySelector('.popup-buttons')!.classList.contains('is-vertical-layout')).toBe(true)
  })

  it('чекбокс: контейнер have-checkbox, строка — label.checkbox-field.checkbox-ripple.hover-effect.rp', () => {
    render(
      <ConfirmPopup
        title="Delete message"
        checkboxes={[{ text: 'Also delete for Maya' }]}
        buttons={[{ text: 'Delete', danger: true, onClick: noop }]}
        onClose={noop}
      />,
    )

    const container = document.querySelector('.popup-container')!
    expect(container.classList.contains('have-checkbox')).toBe(true)

    const label = container.querySelector('label.checkbox-field')!
    expect(label.tagName).toBe('LABEL')
    expect([...label.classList]).toEqual(
      expect.arrayContaining(['checkbox-field', 'checkbox-ripple', 'hover-effect', 'rp']),
    )
    // подпись есть ⇒ checkbox-without-caption НЕ вешается (tweb checkboxField.ts)
    expect(label.classList.contains('checkbox-without-caption')).toBe(false)
    expect(label.querySelector('span.checkbox-caption')!.textContent).toBe('Also delete for Maya')
    expect(label.querySelector('input.checkbox-field-input')).not.toBeNull()
    expect(label.querySelector('.checkbox-box .checkbox-box-check')).not.toBeNull()
  })

  it('состояние чекбокса уезжает в колбэк кнопки', () => {
    const onDelete = vi.fn()
    render(
      <ConfirmPopup
        open
        title="Delete message"
        checkboxes={[{ text: 'Delete for all members' }]}
        buttons={[{ text: 'Delete', danger: true, onClick: onDelete }]}
        onClose={noop}
      />,
    )

    fireEvent.click(document.querySelector('label.checkbox-field')!)
    fireEvent.click(document.querySelector('.popup-buttons button')!)
    expect(onDelete).toHaveBeenCalledWith([true])
  })
})
