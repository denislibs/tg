/**
 * Тесты порта `deleteContacts.ts` (tweb `components/popups/deleteContacts.ts`,
 * 812502980): один контакт — с аватаром и вопросом «этот контакт», несколько —
 * числом в заголовке; красная кнопка «Delete» выполняет промис, отмена отклоняет.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import confirmDeleteContacts from './deleteContacts'

vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async() => {} } } }),
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const click = (el: Element) => el.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true, cancelable: true }))
const lastPopup = () => [...document.querySelectorAll<HTMLElement>('.popup-confirmation')].pop()!

afterEach(async() => {
  await pause(400)
  document.body.replaceChildren()
})

describe('confirmDeleteContacts', () => {
  it('один контакт: аватар пира, заголовок и вопрос; «Delete» выполняет промис', async() => {
    const done = confirmDeleteContacts([2])
    const popup = lastPopup()
    expect(popup.querySelector('.popup-header .avatar')).not.toBeNull()
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Delete contact')
    expect(popup.querySelector('.popup-description')!.textContent).toBe('Are you sure you want to delete this contact?')

    const danger = popup.querySelector<HTMLElement>('.popup-button.danger')!
    expect(danger.textContent).toBe('Delete')
    click(danger)
    await expect(done).resolves.toBeUndefined()
  })

  it('несколько: число в заголовке, без аватара; отмена отклоняет', async() => {
    const done = confirmDeleteContacts([2, 3, 4])
    const popup = lastPopup()
    expect(popup.querySelector('.popup-header .avatar')).toBeNull()
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Delete 3 contacts')
    expect(popup.querySelector('.popup-description')!.textContent).toBe('Are you sure you want to delete these contacts?')

    click([...popup.querySelectorAll<HTMLElement>('.popup-button')].find((b) => !b.classList.contains('danger'))!)
    await expect(done).rejects.toBeUndefined()
  })
})
