/**
 * Врезка мастера 2FA в React-экран «Конфиденциальность» (задача 19 плана 2D):
 * строка открывает вкладку слайдера через хост — какую, решает состояние пароля
 * (tweb `privacyAndSecurity.tsx:257-271`), — а когда стек вкладок опустел,
 * экран перечитывает состояние (у tweb его пересобирает срез истории).
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import lang from '@/lang'
import type { PasswordState } from '../../core/managers/authManager'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { AppTwoStepVerificationEnterPasswordTab, AppTwoStepVerificationTab } from '../solidJsTabs/tabs'
import PrivacySecuritySettings from './PrivacySecuritySettings'

const host = vi.hoisted(() => ({
  openTab: vi.fn(async() => ({})),
  onTabsEmpty: vi.fn(),
}))
vi.mock('../sidebarLeft/settingsSliderHost', () => ({
  getSettingsSliderHost: () => host,
  openActiveSessionsTab: vi.fn(),
}))

let passwordState: ReturnType<typeof vi.fn<() => Promise<PasswordState>>>

function renderScreen() {
  const managers = {
    auth: { passwordState, passkeysList: async() => [] },
    privacy: { autoDelete: async() => 0 },
  }
  return render(
    <ManagersProvider managers={managers as never}>
      <PrivacySecuritySettings onBack={() => {}} />
    </ManagersProvider>,
  )
}

function twoStepRow(container: HTMLElement) {
  const title = [...container.querySelectorAll<HTMLElement>('.row-title')]
    .find((el) => el.textContent === lang.TwoStepVerification)
  expect(title).toBeDefined()
  return title!.closest<HTMLElement>('.row')!
}

beforeEach(() => {
  host.openTab.mockClear()
  host.onTabsEmpty.mockReset()
  host.onTabsEmpty.mockReturnValue(() => {})
})

afterEach(cleanup)

describe('«Конфиденциальность» → мастер 2FA', () => {
  it('пароль включён — вкладка ввода текущего пароля с состоянием', async() => {
    const state: PasswordState = { enabled: true, hint: 'кот', email: '' }
    passwordState = vi.fn(async() => state)
    const { container, findByText } = renderScreen()
    await findByText(lang['PrivacyAndSecurity.Item.On'])

    fireEvent.click(twoStepRow(container))
    expect(host.openTab).toHaveBeenCalledWith(AppTwoStepVerificationEnterPasswordTab, { state })
  })

  it('пароля нет — главная вкладка 2FA; опустевший стек вкладок перечитывает состояние', async() => {
    passwordState = vi.fn(async() => ({ enabled: false, hint: '', email: '' }))
    const { container, findByText } = renderScreen()
    await findByText(lang.Off)

    fireEvent.click(twoStepRow(container))
    expect(host.openTab).toHaveBeenCalledWith(AppTwoStepVerificationTab, { state: { enabled: false, hint: '', email: '' } })
    expect(host.onTabsEmpty).toHaveBeenCalledTimes(1)

    passwordState.mockResolvedValue({ enabled: true, hint: '', email: '' })
    const onEmpty = host.onTabsEmpty.mock.calls[0][0] as () => void
    await act(async() => onEmpty())
    await findByText(lang['PrivacyAndSecurity.Item.On'])

    // повторное открытие не плодит подписок
    fireEvent.click(twoStepRow(container))
    expect(host.onTabsEmpty).toHaveBeenCalledTimes(1)
  })

  it('пока состояние не пришло, строка ничего не открывает (tweb twoFactorFrozen)', () => {
    passwordState = vi.fn(() => new Promise<PasswordState>(() => {}))
    const { container } = renderScreen()
    fireEvent.click(twoStepRow(container))
    expect(host.openTab).not.toHaveBeenCalled()
  })
})
