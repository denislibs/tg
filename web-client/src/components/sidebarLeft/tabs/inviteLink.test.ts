/**
 * Виджет ссылки-приглашения `inviteLink.ts` — порт tweb
 * `sidebarLeft/tabs/inviteLink.ts` (812502980). Меню ⋮ и копирование плашкой
 * держит `sharedFolder.solid.test.tsx` (единственный наш вызывающий); здесь —
 * остальные формы конструктора оригинала: кнопка «копировать» справа, без неё,
 * кнопки под ссылкой, свой класс контейнера, срез схемы в адресе.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import { InviteLink } from './inviteLink'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const copyTextToClipboard = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@helpers/clipboard', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@helpers/clipboard')>()),
  copyTextToClipboard,
}))

let listenerSetter: ListenerSetter

beforeEach(() => {
  listenerSetter = new ListenerSetter()
  toastNew.mockReset()
  copyTextToClipboard.mockClear()
})

afterEach(() => {
  listenerSetter.removeAll()
  document.body.replaceChildren()
})

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('InviteLink', () => {
  it('без buttons — справа кнопка «копировать» с aria-label; клик по ней копирует адрес', () => {
    const link = new InviteLink({ listenerSetter, url: 'https://t.me/addlist/abc' })
    document.body.append(link.container)

    const right = link.container.querySelector<HTMLElement>('.invite-link > .btn-icon.invite-link-menu')!
    expect(right.getAttribute('aria-label')).toBe('Copy Link')
    expect(right.classList.contains('btn-menu-toggle')).toBe(false)
    click(right)
    expect(copyTextToClipboard).toHaveBeenCalledWith('https://t.me/addlist/abc')
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LinkCopied' })
  })

  it('адрес показан без схемы; кнопки под ссылкой по умолчанию нет (расхождение 1)', () => {
    const link = new InviteLink({ listenerSetter, url: 'https://t.me/addlist/abc' })
    expect(link.textElement.textContent).toBe('t.me/addlist/abc')
    expect(link.url).toBe('https://t.me/addlist/abc')
    expect(link.button).toBeUndefined()
    expect([...link.container.children].map((el) => el.className)).toEqual(['invite-link rp-overflow rp'])
  })

  it('noRightButton — справа ничего; onClick плашки — свой', () => {
    const onClick = vi.fn()
    const link = new InviteLink({ listenerSetter, url: 'https://t.me/x', noRightButton: true, onClick })
    expect(link.container.querySelector('.invite-link-menu')).toBeNull()
    click(link.container.querySelector('.invite-link')!)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(copyTextToClipboard).not.toHaveBeenCalled()
  })

  it('две кнопки под ссылкой — в ряд .invite-link-buttons, каждая btn-primary btn-color-primary invite-link-button; свой класс контейнера', () => {
    const a = document.createElement('button')
    const b = document.createElement('button')
    const link = new InviteLink({ listenerSetter, url: 'https://t.me/x', button: [a, b], class: 'call-link  extra' })
    expect(link.container.className).toBe('invite-link-container call-link extra')
    const row = link.container.lastElementChild!
    expect(row.className).toBe('invite-link-buttons')
    expect([...row.children]).toEqual([a, b])
    expect(a.className).toBe('btn-primary btn-color-primary invite-link-button')
    expect(link.button).toBe(a)
  })
})
