// ── ПИН tweb 72c50bfef: настройки уведомлений без Web Notifications API ───────
//
// API уведомлений есть не везде (iOS Safari вне PWA, встроенные браузеры).
// Раньше клик «Включить уведомления» там молча ничего не делал; tweb
// показывает тост `Notifications.Restricted`. Тот же тост — на отказе в
// разрешении (notifications.tsx:395-406).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const support = vi.hoisted(() => ({ value: false }))
vi.mock('@environment/notificationSupport', () => ({
  get default() { return support.value },
}))
const toastNew = vi.hoisted(() => vi.fn())
vi.mock('../toast', () => ({ toastNew }))

import { ManagersProvider } from '../../core/hooks/useManagers'
import { applyLang } from '../../test/lang'
import NotificationsSettings from './NotificationsSettings'

function renderScreen() {
  render(
    <ManagersProvider managers={{} as never}>
      <NotificationsSettings onBack={() => {}} />
    </ManagersProvider>,
  )
}

beforeEach(async () => {
  await applyLang('en')
  toastNew.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotificationsSettings без Web Notifications API (tweb 72c50bfef)', () => {
  it('«Включить уведомления» показывает Notifications.Restricted, а не молчит', () => {
    support.value = false
    renderScreen()
    fireEvent.click(screen.getByText('Enable Notifications'))
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Notifications.Restricted' })
  })

  it('отказ в разрешении — тот же тост', async () => {
    support.value = true
    const requestPermission = vi.fn(async () => 'denied' as NotificationPermission)
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission }))
    renderScreen()
    fireEvent.click(screen.getByText('Enable Notifications'))
    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Notifications.Restricted' }))
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })
})
