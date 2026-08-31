// Тесты порта tweb `components/popups/mute.ts` (см. `popupMute.ts` рядом —
// там же ссылки file:line на исходник). Как и `popupPeer.test.ts`, гоняют
// НАСТОЯЩИЙ класс на реальном DOM (happy-dom), без моков — кроме менеджера
// аватарки (`AvatarManagers`, тот же приём, что в `popupPeer.test.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest'
// Подписи строк — живые узлы ядра (`_i18n`, задача 8), а строки в ядро кладёт
// создание хранилища языка. В продукте это делает холодный старт
// (`client/boot.ts`), в прогоне — только явный импорт; без него на экран поехали
// бы имена ключей, и это красил бы пин `test/domKeyLeak`.
import '@/i18n'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import type { AvatarManagers } from '@components/avatar'
import PopupMute from './popupMute'

afterEach(() => {
  document.body.replaceChildren()
})

function mkManagers(): AvatarManagers {
  return { peers: { fillMirror: vi.fn(async() => {}) } }
}

describe('PopupMute — порт tweb mute.ts', () => {
  it('аватар (peerId) + заголовок Notifications + шесть радио-строк, Forever отмечен по умолчанию', () => {
    const onMute = vi.fn()
    new PopupMute(12345, mkManagers(), onMute)

    const root = document.querySelector('.popup-mute') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.querySelector('.popup-header .avatar')).not.toBeNull() // peer.ts:46-54
    expect(root.querySelector('.popup-title')?.textContent).toBe('Notifications')

    const rows = root.querySelectorAll('[role="radio"]')
    expect(rows).toHaveLength(6) // mute.ts:7-27 — 1ч/4ч/8ч/1д/3д/Forever
    // «Forever» — последняя строка (mute.ts:24-27, checked:true)
    expect(rows[rows.length - 1].getAttribute('aria-checked')).toBe('true')
    expect(rows[0].getAttribute('aria-checked')).toBe('false')
  })

  it('клик по строке переключает выбор — старая гаснет, новая зажигается (взаимоисключающее радио)', () => {
    new PopupMute(1, mkManagers(), vi.fn())
    const rows = document.querySelectorAll<HTMLElement>('.popup-mute [role="radio"]')
    const forever = rows[rows.length - 1]
    const oneHour = rows[0]

    expect(forever.getAttribute('aria-checked')).toBe('true')
    oneHour.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(oneHour.getAttribute('aria-checked')).toBe('true')
    expect(forever.getAttribute('aria-checked')).toBe('false') // взаимоисключение — не два выбранных сразу
  })

  it('MUTE без выбора строки — Forever по умолчанию, onMute(null) (mute.ts: value===-1 → MUTE_UNTIL)', () => {
    const onMute = vi.fn()
    new PopupMute(1, mkManagers(), onMute)

    // Обе кнопки несут класс `primary` (`setButtons`, popupElement.ts:217:
    // `isDanger ? 'danger' : 'primary'` — у Cancel `isDanger` тоже не задан).
    // Порядок DOM решает: MUTE — первая (addCancelButton дописывает Cancel
    // ПОСЛЕДНИМ, peer.ts:41).
    const buttons = document.querySelectorAll<HTMLButtonElement>('.popup-mute .popup-button')
    buttons[0].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onMute).toHaveBeenCalledWith(null)
  })

  it('выбор «For 1 Hour» + MUTE — onMute(3600), а не Forever по умолчанию', () => {
    const onMute = vi.fn()
    new PopupMute(1, mkManagers(), onMute)

    document.querySelector<HTMLElement>('.popup-mute [role="radio"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelectorAll<HTMLButtonElement>('.popup-mute .popup-button')[0]
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onMute).toHaveBeenCalledWith(3600)
  })

  it('Cancel закрывает без onMute — авто-Cancel PopupPeer, не наша кнопка', () => {
    const onMute = vi.fn()
    new PopupMute(1, mkManagers(), onMute)

    const buttons = document.querySelectorAll<HTMLButtonElement>('.popup-mute .popup-button')
    buttons[buttons.length - 1].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onMute).not.toHaveBeenCalled()
  })
})
