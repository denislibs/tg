// Сочетание блокировки код-паролем (`useLockScreenShortcut.ts`, порт tweb
// `lib/appManagers/utils/useLockScreenShortcut.ts`, 812502980): предмет —
// блокирует ли настоящее `keydown` приложение (`useLockStore.locked`) при
// разных настройках. Настройки и стор блокировки — настоящие.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSettingsStore } from '@/settings'
import { useLockStore } from '@/stores/lockStore'
import { useLockScreenShortcut } from './useLockScreenShortcut'

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  const event = new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

beforeEach(() => {
  useLockStore.getState().unlock()
  useSettingsStore.getState().update({
    passcodeEnabled: true,
    passcodeLockShortcutEnabled: true,
    passcodeLockShortcut: ['Alt'],
  })
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('useLockScreenShortcut', () => {
  it('Alt+L (по event.code, не по раскладке) блокирует и гасит событие', () => {
    renderHook(() => useLockScreenShortcut())
    const event = press({ altKey: true, key: 'д' })
    expect(useLockStore.getState().locked).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('без модификатора, без кода или с выключенным сочетанием — не блокирует', () => {
    renderHook(() => useLockScreenShortcut())
    press({})
    expect(useLockStore.getState().locked).toBe(false)

    act(() => useSettingsStore.getState().update({ passcodeLockShortcutEnabled: false }))
    press({ altKey: true })
    expect(useLockStore.getState().locked).toBe(false)

    act(() => useSettingsStore.getState().update({ passcodeLockShortcutEnabled: true, passcodeEnabled: false }))
    press({ altKey: true })
    expect(useLockStore.getState().locked).toBe(false)
  })

  it('смена сочетания подхватывается без перемонтирования', () => {
    renderHook(() => useLockScreenShortcut())
    act(() => useSettingsStore.getState().update({ passcodeLockShortcut: ['Ctrl', 'Shift'] }))
    press({ altKey: true })
    expect(useLockStore.getState().locked).toBe(false)
    press({ ctrlKey: true, shiftKey: true })
    expect(useLockStore.getState().locked).toBe(true)
  })

  it('Shift+L не блокирует, пока фокус в поле ввода (tweb :60-66)', () => {
    act(() => useSettingsStore.getState().update({ passcodeLockShortcut: ['Shift'] }))
    renderHook(() => useLockScreenShortcut())
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    press({ shiftKey: true }, input)
    expect(useLockStore.getState().locked).toBe(false)

    input.blur()
    press({ shiftKey: true })
    expect(useLockStore.getState().locked).toBe(true)
  })

  it('под блокировкой слушателя нет; размонтирование снимает его', () => {
    const { unmount } = renderHook(() => useLockScreenShortcut())
    act(() => useLockStore.getState().lock())
    const underLock = press({ altKey: true })
    expect(underLock.defaultPrevented).toBe(false)

    act(() => useLockStore.getState().unlock())
    unmount()
    press({ altKey: true })
    expect(useLockStore.getState().locked).toBe(false)
  })
})

// Проводка: хук живёт, только пока его зовёт оболочка (у tweb — конструктор
// `appImManager`, `appImManager.ts:630`). Вызов проверяется сканом исходника —
// приём `components/Chat.feedMount.test.ts`: `App.tsx` в тестах не монтируется.
describe('проводка', () => {
  it('App.tsx зовёт useLockScreenShortcut() рядом с useAutoLock()', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(src).toMatch(/^\s*useAutoLock\(\)\n\s*useLockScreenShortcut\(\)$/m)
  })
})
