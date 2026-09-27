/** @jsxImportSource solid-js */
/**
 * Контроллер экрана блокировки — порт tweb `passcodeLockScreenController.tsx`
 * (812502980), `lock(fromLockIcon, onAnimationEnd)`:
 *  • с иконкой кнопки замка — корень `--hidden`, в нём клон иконки
 *    (`__animated-lock-icon`, `--x`/`--y` по центру иконки), экран получает клон и
 *    `onAnimationEnd`; через `doubleRaf` корень проявляется;
 *  • `true` (сочетание) — только проявление и `onAnimationEnd` через 200 мс;
 *  • без аргументов — сразу, без анимации;
 *  • корень — в `getOverlayRoot()`: в выносе клиента — в body окна выноса.
 *
 * Сам экран — заглушка, записывающая пропы (его анимацию пинует
 * `passcodeLockScreen.solid.test.tsx`), канал к воркеру — шпион.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppWindow } from '@helpers/appWindow'
import { useLockStore } from '@/stores/lockStore'

vi.mock('@/client/passcodeClient', () => ({ invokePasscode: vi.fn(async() => undefined) }))

type ScreenProps = { onUnlock: () => void, fromLockIcon?: HTMLElement, onAnimationEnd?: () => void }
const screen = vi.hoisted(() => ({ props: undefined as ScreenProps | undefined }))
vi.mock('./passcodeLockScreen.solid', () => ({
  default: (props: ScreenProps) => {
    screen.props = props
    return null
  },
}))

import PasscodeLockScreenController from './passcodeLockScreenController.solid'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function lockIcon() {
  const button = document.createElement('button')
  button.className = 'btn-icon sidebar-lock-button'
  const icon = document.createElement('span')
  icon.className = 'sidebar-lock-button-icon'
  icon.innerHTML = '<svg viewBox="0 0 23 22"><path class="lock-icon-shackle"></path></svg>'
  icon.getBoundingClientRect = () => ({ left: 300, top: 20, width: 24, height: 24 }) as DOMRect
  button.append(icon)
  document.body.append(button)
  return icon
}

const root = (doc: Document = document) => doc.querySelector<HTMLElement>('.passcode-lock-screen')

afterEach(async() => {
  PasscodeLockScreenController.unlock()
  // снятие гасит корень паузами 120 + 250 + 120 мс
  await vi.waitFor(() => expect(document.querySelector('.passcode-lock-screen')).toBeNull())
  setAppWindow(window)
  screen.props = undefined
  document.body.replaceChildren()
})

describe('PasscodeLockScreenController.lock (tweb :82-130)', () => {
  it('с иконкой кнопки замка: корень скрыт, в нём клон иконки у её центра; клон и onAnimationEnd — экрану; затем проявление', async() => {
    const icon = lockIcon()
    const onAnimationEnd = vi.fn()

    await PasscodeLockScreenController.lock(icon, onAnimationEnd)

    expect(useLockStore.getState().locked).toBe(true)
    const element = root()!
    expect(element.parentElement).toBe(document.body)
    expect(element.classList.contains('passcode-lock-screen--hidden')).toBe(true)

    const clone = element.querySelector<HTMLElement>(':scope > .passcode-lock-screen__animated-lock-icon')!
    expect(clone).not.toBeNull()
    expect(clone).not.toBe(icon)
    expect(clone.classList.contains('sidebar-lock-button-icon')).toBe(true)
    expect(clone.querySelector('path.lock-icon-shackle')).not.toBeNull()
    expect(clone.style.getPropertyValue('--x')).toBe('312px')
    expect(clone.style.getPropertyValue('--y')).toBe('32px')
    // исходная иконка — на месте, в кнопке
    expect(icon.parentElement!.classList.contains('sidebar-lock-button')).toBe(true)

    expect(screen.props!.fromLockIcon).toBe(clone)
    expect(screen.props!.onAnimationEnd).toBe(onAnimationEnd)

    await vi.waitFor(() => expect(element.classList.contains('passcode-lock-screen--hidden')).toBe(false))
    // конец анимации с иконкой объявляет экран, не контроллер
    await pause(300)
    expect(onAnimationEnd).not.toHaveBeenCalled()
  })

  it('`true` (сочетание): без клона, проявление и onAnimationEnd через 200 мс', async() => {
    const onAnimationEnd = vi.fn()

    await PasscodeLockScreenController.lock(true, onAnimationEnd)

    const element = root()!
    expect(element.classList.contains('passcode-lock-screen--hidden')).toBe(true)
    expect(element.querySelector('.passcode-lock-screen__animated-lock-icon')).toBeNull()
    expect(screen.props!.fromLockIcon).toBeUndefined()
    expect(onAnimationEnd).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(element.classList.contains('passcode-lock-screen--hidden')).toBe(false))
    await vi.waitFor(() => expect(onAnimationEnd).toHaveBeenCalledTimes(1))
  })

  it('без аргументов (старт под замком, автоблокировка) — сразу, без анимации', async() => {
    await PasscodeLockScreenController.lock()

    const element = root()!
    expect(element.classList.contains('passcode-lock-screen--hidden')).toBe(false)
    expect(element.querySelector('.passcode-lock-screen__animated-lock-icon')).toBeNull()
    expect(screen.props!.fromLockIcon).toBeUndefined()
  })

  it('в выносе клиента (setAppWindow) экран встаёт в body окна выноса, не вкладки', async() => {
    const doc = document.implementation.createHTMLDocument('pip')
    setAppWindow({ document: doc } as unknown as Window)

    await PasscodeLockScreenController.lock()

    expect(root(doc)?.parentElement).toBe(doc.body)
    expect(root()).toBeNull()

    PasscodeLockScreenController.unlock()
    await vi.waitFor(() => expect(root(doc)).toBeNull())
  })
})
