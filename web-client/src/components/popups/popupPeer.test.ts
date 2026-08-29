// Тесты порта tweb `components/popups/peer.ts` + `simpleConfirmation.ts` (см.
// `popupPeer.ts` рядом — там же ссылки file:line на исходник). Как и
// `popupElement.test.ts`, гоняют НАСТОЯЩИЕ классы на реальном DOM (happy-dom),
// без моков.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initHotkeys } from '@core/hotkeys'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { confirmationPopup } from './popupPeer'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('confirmationPopup — порт tweb popups/peer.ts + simpleConfirmation.ts', () => {
  it('заголовок и описание попадают в разметку', () => {
    // отмену никто не проверяет в этом тесте — гасим необработанный reject
    void confirmationPopup({
      titleLangKey: 'Delete Chat',
      descriptionLangKey: 'Are you sure?',
      button: { text: 'Delete' }
    }).catch(() => {})

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.querySelector('.popup-title')?.textContent).toBe('Delete Chat')
    expect(root.querySelector('.popup-description')?.textContent).toBe('Are you sure?')
  })

  it('клик по кнопке подтверждения резолвит промис, попап закрывается после исхода', async() => {
    vi.useFakeTimers()

    const promise = confirmationPopup({
      titleLangKey: 'Delete Chat',
      descriptionLangKey: 'Are you sure?',
      button: { text: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    const buttons = root.querySelectorAll<HTMLButtonElement>('.popup-button')
    expect(buttons).toHaveLength(2) // options.button + авто-Cancel (addCancelButton)

    const confirmButton = Array.from(buttons).find((b) => b.classList.contains('danger'))!
    confirmButton.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await expect(promise).resolves.toBeUndefined()

    // не остаётся висеть: destroy() уже начался (клик сам зовёт hide()),
    // узел снимается по таймеру базы (popupElement.ts destroy(), 250мс)
    expect(document.body.contains(root)).toBe(true)
    vi.advanceTimersByTime(300)
    expect(document.body.contains(root)).toBe(false)
  })

  it('клик по Cancel реджектит промис, попап закрывается после исхода', async() => {
    vi.useFakeTimers()

    const promise = confirmationPopup({
      titleLangKey: 'Delete Chat',
      descriptionLangKey: 'Are you sure?',
      button: { text: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    const cancelButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.popup-button'))
      .find((b) => !b.classList.contains('danger'))!
    cancelButton.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await expect(promise).rejects.toBeUndefined()

    vi.advanceTimersByTime(300)
    expect(document.body.contains(root)).toBe(false)
  })

  it('Esc реджектит промис (отмена), а не оставляет попап висеть без исхода', async() => {
    vi.useFakeTimers()
    const deactivate = initHotkeys({})

    const promise = confirmationPopup({
      titleLangKey: 'Delete Chat',
      descriptionLangKey: 'Are you sure?',
      button: { text: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    // closeAfterTimeout (реджект «на отмену без кнопки») стреляет через 250мс
    // после destroy(), которую Esc запускает синхронно через pushEsc → hide()
    vi.advanceTimersByTime(300)

    await expect(promise).rejects.toBeUndefined()
    expect(document.body.contains(root)).toBe(false)

    deactivate()
  })
})
