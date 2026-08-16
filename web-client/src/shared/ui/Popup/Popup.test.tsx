// Пин DOM-структуры попапа по дампам tweb (`docs/research/tweb-dom/
// 17-popup-01-forward-share.json`, `17-popup-06-date-picker.json`):
//   div.popup[.<модификатор>] > div.popup-container.z-depth-1 >
//     div.popup-header + div.popup-body +
//     div.popup-footer.popup-footer-abitlarger >
//       button.popup-footer-button.btn-primary.btn-color-primary
// Классы держат ВСЮ геометрию (партиалы styles/tweb/popups/*), поэтому потеря
// любого из них — молчаливая поломка вёрстки: ни тайпчек, ни сборка её не ловят.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { initHotkeys } from '../../../core/hotkeys'
import { render, cleanup, fireEvent } from '@testing-library/react'
import Popup from './Popup'

const noop = () => {}

describe('Popup — разметка tweb', () => {
  afterEach(cleanup)

  it('корень несёт popup + модификатор, контейнер — popup-container z-depth-1', () => {
    render(<Popup open title="Share with" className="popup-forward" onClose={noop}>тело</Popup>)

    const root = document.querySelector('.popup')!
    expect(root).not.toBeNull()
    expect(root.classList.contains('popup-forward')).toBe(true)

    const container = root.querySelector('.popup-container')!
    expect(container).not.toBeNull()
    expect(container.classList.contains('z-depth-1')).toBe(true)
    // хедер — прямой ребёнок контейнера, с popup-close и popup-title
    const header = container.querySelector(':scope > .popup-header')!
    expect(header.querySelector('.popup-close')).not.toBeNull()
    expect(header.querySelector('.popup-title')!.textContent).toBe('Share with')
  })

  it('тело — глобальный popup-body (tweb popups/index.ts:208)', () => {
    render(<Popup open title="T" onClose={noop}>содержимое</Popup>)

    const body = document.querySelector('.popup-container > .popup-body')!
    expect(body).not.toBeNull()
    expect(body.textContent).toBe('содержимое')
  })

  it('body={false} — дети ложатся прямо в контейнер (как у календаря)', () => {
    render(<Popup open title="T" body={false} onClose={noop}><div className="own-scrollable" /></Popup>)

    expect(document.querySelector('.popup-body')).toBeNull()
    expect(document.querySelector('.popup-container > .own-scrollable')).not.toBeNull()
  })

  it('action — popup-footer popup-footer-abitlarger + popup-footer-button btn-primary btn-color-primary', () => {
    const onClick = vi.fn()
    render(<Popup open title="T" onClose={noop} action={{ label: 'Copy Link', onClick }}>тело</Popup>)

    const footer = document.querySelector('.popup-container > .popup-footer')!
    expect(footer).not.toBeNull()
    expect(footer.classList.contains('popup-footer-abitlarger')).toBe(true)

    const button = footer.querySelector('button')!
    expect([...button.classList]).toEqual(
      expect.arrayContaining(['popup-footer-button', 'btn-primary', 'btn-color-primary', 'rp']),
    )
    // ripple — ПЕРВЫЙ ребёнок (tweb ripple() делает prepend)
    expect(button.firstElementChild!.className).toBe('c-ripple')
    expect(button.textContent).toBe('Copy Link')

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// Esc обязан закрывать попап. В tweb клавиша и Back ведут в один LIFO-стек
// (appNavigationController); у нас Back ведёт useNavLayer (popstate), а Escape
// popstate не порождает — поэтому попап отдельно регистрируется в стеке
// `core/hotkeys`. Без этого календарь/«Поделиться»/выбор контакта закрывались
// только крестиком или кликом по скриму.
describe('Popup — закрытие по Esc', () => {
  it('Escape зовёт onClose у открытого попапа', () => {
    initHotkeys({})
    const onClose = vi.fn()
    render(<Popup open title="T" onClose={onClose}>x</Popup>)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).toHaveBeenCalled()
  })

  it('закрытый попап Esc не перехватывает', () => {
    initHotkeys({})
    const onClose = vi.fn()
    render(<Popup open={false} title="T" onClose={onClose}>x</Popup>)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
