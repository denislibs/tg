/** @jsxImportSource solid-js */
/**
 * Кнопка замка шапки левой колонки — порт tweb `sidebarLeft/lockButton.tsx`
 * (812502980): ванильный узел из `createRoot` с разметкой оригинала, щелчок —
 * `PasscodeLockScreenController.lock(иконка, onAnimationEnd)`, и только по концу
 * анимации — завершение воркера с перезагрузкой (`lockAndReload`, tweb
 * `apiManagerProxy.lock()`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => vi.fn(async(_icon?: HTMLElement | boolean, _onAnimationEnd?: () => void) => {}))
vi.mock('@components/passcodeLock/passcodeLockScreenController.solid', () => ({ default: { lock } }))

const lockAndReload = vi.hoisted(() => vi.fn())
vi.mock('@/client/passcodeClient', () => ({ lockAndReload }))

import createLockButton from './lockButton.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  lock.mockClear()
  lockAndReload.mockClear()
  document.body.replaceChildren()
})

describe('createLockButton (tweb lockButton.tsx)', () => {
  it('button.btn-icon.sidebar-lock-button > span.sidebar-lock-button-icon > svg замка со скобой', () => {
    const button = createLockButton()
    dispose = button.dispose

    const { element } = button
    expect(element.tagName).toBe('BUTTON')
    expect([...element.classList]).toEqual(['btn-icon', 'sidebar-lock-button'])
    expect(element.getAttribute('aria-label')).toBe('Tap to lock Telegram.')
    // без `title`: подсказка у tweb — тултип, не атрибут
    expect(element.hasAttribute('title')).toBe(false)

    const [icon] = Array.from(element.children) as HTMLElement[]
    expect(element.childElementCount).toBe(1)
    expect(icon.tagName).toBe('SPAN')
    expect(icon.className).toBe('sidebar-lock-button-icon')
    const svg = icon.firstElementChild!
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 23 22')
    expect(svg.querySelectorAll('path')).toHaveLength(2)
    expect(svg.querySelector('path.lock-icon-shackle')).not.toBeNull()
  })

  it('щелчок — lock(обёртка иконки, …); воркер и перезагрузка — только в onAnimationEnd', () => {
    const button = createLockButton()
    dispose = button.dispose
    document.body.append(button.element)

    button.element.click()

    expect(lock).toHaveBeenCalledTimes(1)
    const [icon, onAnimationEnd] = lock.mock.calls[0]
    expect(icon).toBe(button.element.querySelector('.sidebar-lock-button-icon'))
    expect(lockAndReload).not.toHaveBeenCalled()

    onAnimationEnd!()
    expect(lockAndReload).toHaveBeenCalledTimes(1)
  })
})
