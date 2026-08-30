// Тесты порта tweb `components/buttonMenu.ts` (см. шапку файла рядом).
import { afterEach, describe, expect, it, vi } from 'vitest'
import ButtonMenu, { ButtonMenuItem, ButtonMenuSync, type ButtonMenuItemOptions } from './buttonMenu'

// Подписи пунктов — КЛЮЧИ (`LangPackKey`), а не готовые строки: с задачи 7 роль поля
// выражена типом, и выдуманное 'x' сюда не положить. Строки в ядро кладёт создание
// хранилища языка — в продукте это делает холодный старт, здесь нужен явный импорт.
import '@/i18n'
import contextMenuController from '@helpers/contextMenuController'
import ListenerSetter from '@helpers/listenerSetter'

afterEach(() => {
  contextMenuController.close()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** Меню, помеченное `active`: клик по пункту НЕактивного меню оригинал глушит. */
function mountActiveMenu(el: HTMLElement) {
  el.classList.add('active')
  document.body.append(el)
}

describe('ButtonMenuItem: разметка', () => {
  it('пункт — div.btn-menu-item.rp-overflow с иконкой-глифом и span.i18n.btn-menu-item-text', () => {
    const [item] = ButtonMenuItem({ icon: 'delete', text: 'Delete', onClick: () => {} })

    expect(item.tagName).toBe('DIV')
    expect(item.classList.contains('btn-menu-item')).toBe(true)
    expect(item.classList.contains('rp-overflow')).toBe(true)

    const icon = item.children[0] as HTMLElement
    expect(icon.classList.contains('tgico')).toBe(true)
    expect(icon.classList.contains('btn-menu-item-icon')).toBe(true)

    const text = item.children[1] as HTMLElement
    expect(text.classList.contains('i18n')).toBe(true)
    expect(text.classList.contains('btn-menu-item-text')).toBe(true)
    expect(text.textContent).toBe('Delete')
  })

  it('хвост опции icon после первого слова уезжает в className пункта', () => {
    const [item] = ButtonMenuItem({ icon: 'delete danger-cls', text: 'Copy', onClick: () => {} })

    expect(item.classList.contains('danger-cls')).toBe(true)
    // сам глиф берётся из первого слова
    expect(item.children[0].classList.contains('tgico')).toBe(true)
  })

  it('danger / className / secondary → is-secondary + is-multiline', () => {
    const [danger] = ButtonMenuItem({ text: 'Copy', danger: true, className: 'my', onClick: () => {} })
    expect(danger.classList.contains('danger')).toBe(true)
    expect(danger.classList.contains('my')).toBe(true)

    const [secondary] = ButtonMenuItem({ text: 'Copy', secondary: true, onClick: () => {} })
    expect(secondary.classList.contains('is-secondary')).toBe(true)
    expect(secondary.classList.contains('is-multiline')).toBe(true)
  })

  it('emptyIcon даёт пустой span.btn-menu-item-icon, iconElement — переданный узел', () => {
    const [empty] = ButtonMenuItem({ text: 'Copy', emptyIcon: true, onClick: () => {} })
    const placeholder = empty.children[0] as HTMLElement
    expect(placeholder.tagName).toBe('SPAN')
    expect(placeholder.classList.contains('btn-menu-item-icon')).toBe(true)
    expect(placeholder.classList.contains('tgico')).toBe(false)

    const custom = document.createElement('i')
    const [withCustom] = ButtonMenuItem({ text: 'Copy', iconElement: custom, onClick: () => {} })
    expect(withCustom.children[0]).toBe(custom)
    expect(custom.classList.contains('btn-menu-item-icon')).toBe(true)
  })

  it('separator кладёт <hr> ПЕРЕД пунктом, separatorDown — ПОСЛЕ', () => {
    const up = ButtonMenuItem({ text: 'Copy', separator: true, onClick: () => {} })
    expect(up[0].tagName).toBe('HR')
    expect(up[1].classList.contains('btn-menu-item')).toBe(true)

    const down = ButtonMenuItem({ text: 'Copy', separatorDown: true, onClick: () => {} })
    expect(down[0].classList.contains('btn-menu-item')).toBe(true)
    expect(down[1].tagName).toBe('HR')
  })

  it('regularText кладётся через setInnerHTML и сбрасывает dir', () => {
    const [item] = ButtonMenuItem({ regularText: 'сырой текст', onClick: () => {} })
    const text = item.querySelector('.btn-menu-item-text') as HTMLElement
    expect(text.textContent).toBe('сырой текст')
    expect(text.getAttribute('dir')).toBe('')
  })

  it('готовый options.element возвращается как есть (пункт не пересобирается)', () => {
    const existing = document.createElement('div')
    existing.classList.add('ready')
    const ret = ButtonMenuItem({ element: existing, onClick: () => {} })
    expect(ret).toEqual([existing])
  })
})

describe('ButtonMenuItem: клик', () => {
  it('клик зовёт onClick и закрывает меню через contextMenuController', () => {
    const onClick = vi.fn()
    const close = vi.spyOn(contextMenuController, 'close')
    const el = ButtonMenuSync({ buttons: [{ text: 'Copy', onClick }] })
    mountActiveMenu(el)

    ;(el.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalled()
  })

  it('keepOpen: onClick зовётся, меню НЕ закрывается', () => {
    const onClick = vi.fn()
    const close = vi.spyOn(contextMenuController, 'close')
    const el = ButtonMenuSync({ buttons: [{ text: 'Copy', onClick, keepOpen: true }] })
    mountActiveMenu(el)

    ;(el.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('checkForClose() === false отменяет закрытие', () => {
    const close = vi.spyOn(contextMenuController, 'close')
    const el = ButtonMenuSync({ buttons: [{ text: 'Copy', onClick: () => {}, checkForClose: () => false }] })
    mountActiveMenu(el)

    ;(el.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(close).not.toHaveBeenCalled()
  })

  it('клик по пункту НЕактивного меню игнорируется', () => {
    const onClick = vi.fn()
    const el = ButtonMenuSync({ buttons: [{ text: 'Copy', onClick }] })
    document.body.append(el) // без класса active

    ;(el.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('ButtonMenuSync / ButtonMenu', () => {
  it('контейнер — div.btn-menu, пункты и разделители лежат плоско', () => {
    const el = ButtonMenuSync({
      buttons: [
        { text: 'Copy', onClick: () => {} },
        { text: 'Forward', onClick: () => {}, separator: true },
      ],
    })

    expect(el.classList.contains('btn-menu')).toBe(true)
    expect([...el.children].map((c) => c.tagName)).toEqual(['DIV', 'HR', 'DIV'])
  })

  it('listenerSetter прокидывается в options каждого пункта и снимает клики', () => {
    const listenerSetter = new ListenerSetter()
    const onClick = vi.fn()
    const buttons: ButtonMenuItemOptions[] = [{ text: 'Copy', onClick }]
    const el = ButtonMenuSync({ buttons, listenerSetter })
    mountActiveMenu(el)

    expect(buttons[0].options?.listenerSetter).toBe(listenerSetter)

    listenerSetter.removeAll()
    ;(el.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('асинхронный ButtonMenu ждёт все loadPromise', async() => {
    let resolved = false
    const loadPromise = new Promise<void>((resolve) => setTimeout(() => {
      resolved = true
      resolve()
    }, 0))

    const el = await ButtonMenu({ buttons: [{ text: 'Copy', onClick: () => {}, loadPromise }] })

    expect(resolved).toBe(true)
    expect(el.classList.contains('btn-menu')).toBe(true)
  })
})
