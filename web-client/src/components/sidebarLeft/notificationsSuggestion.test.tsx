// ── ПИН tweb 72c50bfef: плашка «Включите уведомления» без Web Notifications API ─
//
// Без API плашку не предлагаем вовсе (`available`), а если она уже на экране —
// клик её закрывает, а не роняет `Notification.requestPermission` (tweb
// notificationsSuggestion.tsx:19-23, :50-53).
import { cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const support = vi.hoisted(() => ({ value: false }))
vi.mock('@environment/notificationSupport', () => ({
  get default() { return support.value },
}))

import { useSettingsStore } from '../../settings'
import { applyLang } from '../../test/lang'
import useNotificationsSuggestion from './notificationsSuggestion'

beforeEach(async () => {
  await applyLang('en')
  useSettingsStore.getState().update({ notifySuggested: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('плашка уведомлений без Web Notifications API (tweb 72c50bfef)', () => {
  it('не предлагается, если API нет', () => {
    support.value = false
    const { result } = renderHook(() => useNotificationsSuggestion())
    expect(result.current.available).toBe(false)
  })

  it('предлагается, если API есть и разрешения ещё нет', () => {
    support.value = true
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission: vi.fn() }))
    const { result } = renderHook(() => useNotificationsSuggestion())
    expect(result.current.available).toBe(true)
  })

  it('клик без API закрывает плашку, а не зовёт requestPermission', () => {
    support.value = false
    const { result } = renderHook(() => useNotificationsSuggestion())
    const Component = result.current.component
    const { container } = render(<Component collapsed={false} />)
    ;(container.querySelector('.row-clickable') as HTMLElement).click()
    expect(useSettingsStore.getState().notifySuggested).toBe(true)
  })
})
