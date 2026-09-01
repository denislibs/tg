// Тесты порта tweb `components/popups/index.ts` (см. `popupElement.ts` рядом
// — там же ссылки file:line на исходник). Тесты гоняют НАСТОЯЩИЙ класс на
// реальном DOM (happy-dom), без моков DOM — как остальные ванильные порты
// (`clickEvent.test.ts`, `openMediaViewer.test.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initHotkeys } from '@core/hotkeys'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import PopupElement, { type PopupButton, type PopupOptions } from './popupElement'

// Тестовый потомок: setButtons — protected (как в tweb), конкретные попапы
// зовут его сами из своего конструктора. Наш упрощённый PopupOptions (в
// отличие от tweb) не несёт `buttons` — кнопки не часть базовых опций.
class TestPopup extends PopupElement {
  constructor(className: string, options?: PopupOptions, buttons?: PopupButton[]) {
    super(className, options)
    if(buttons) this.setButtons(buttons)
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('PopupElement — база (порт tweb popups/index.ts)', () => {
  it('show() вешает узел в DOM, hide() снимает его ПОСЛЕ анимации (не сразу)', () => {
    vi.useFakeTimers()
    const popup = new PopupElement('popup-show-hide-test')
    popup.show()

    const root = document.querySelector('.popup-show-hide-test')
    expect(root).not.toBeNull()
    expect(document.body.contains(root)).toBe(true)
    expect(root!.classList.contains('active')).toBe(true)

    popup.hide()
    // сразу после hide() узел ещё в DOM — снимается по таймеру (tweb :438-448)
    expect(document.body.contains(root)).toBe(true)
    expect(root!.classList.contains('hiding')).toBe(true)

    vi.advanceTimersByTime(249)
    expect(document.body.contains(root)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(document.body.contains(root)).toBe(false)
  })

  it('Esc закрывает попап и НЕ доходит до фолбэка «закрыть чат» (урок дефекта a8ad0788)', () => {
    vi.useFakeTimers()
    const escFallback = vi.fn()
    const deactivate = initHotkeys({ escFallback })

    const popup = new PopupElement('popup-esc-test')
    popup.show()
    expect(document.querySelector('.popup-esc-test')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    // фолбэк планируется таймером ТОЛЬКО когда Esc-стек пуст (core/hotkeys.ts) —
    // ждём его окно, чтобы поймать регрессию, а не молчаливо разминуться с ней
    vi.advanceTimersByTime(10)

    expect(escFallback).not.toHaveBeenCalled()
    expect(document.querySelector('.popup-esc-test')!.classList.contains('hiding')).toBe(true)

    deactivate()
  })

  it('клик по оверлею закрывает, клик по телу — нет', () => {
    const popup = new PopupElement('popup-overlay-test', { overlayClosable: true, body: true })
    popup.show()

    const root = document.querySelector('.popup-overlay-test') as HTMLElement
    const body = root.querySelector('.popup-body') as HTMLElement
    expect(body).not.toBeNull()

    body.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(root.classList.contains('hiding')).toBe(false)

    root.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(root.classList.contains('hiding')).toBe(true)
  })

  it('setButtons: порядок массива, isDanger → класс danger, клик зовёт callback и закрывает попап', () => {
    const onDelete = vi.fn()
    const popup = new TestPopup('popup-buttons-test', {}, [
      // `langKey` — КЛЮЧ (переводит попап), `text` — готовый УЗЕЛ. Раскол «строка это
      // ключ или уже перевод?» снят задачей 7 именно типом: строку сюда не положить.
      { langKey: 'Cancel', isCancel: true },
      { langKey: 'Delete', isDanger: true, callback: onDelete },
    ])
    popup.show()

    const root = document.querySelector('.popup-buttons-test') as HTMLElement
    const buttons = root.querySelectorAll<HTMLButtonElement>('.popup-button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('Cancel')
    expect(buttons[1].textContent).toBe('Delete')
    expect(buttons[0].classList.contains('primary')).toBe(true)
    expect(buttons[1].classList.contains('danger')).toBe(true)

    buttons[1].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(root.classList.contains('hiding')).toBe(true)
  })

  it('destroy() снимает слушатели: после него Esc ничего не зовёт (стек пуст — срабатывает фолбэк)', () => {
    vi.useFakeTimers()
    const escFallback = vi.fn()
    const deactivate = initHotkeys({ escFallback })

    const popup = new PopupElement('popup-destroy-test')
    popup.show()
    popup.forceHide() // → destroy() сразу (без ожидания анимации)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    vi.advanceTimersByTime(10)
    // стек пуст: раз попап снял свой Esc-обработчик, Escape уходит в фолбэк
    expect(escFallback).toHaveBeenCalledTimes(1)

    deactivate()
  })
})
