/**
 * Врезка мастера 2FA в React-экран «Конфиденциальность» (задача 19 плана 2D):
 * строка открывает вкладку слайдером своей вкладки — какую, решает состояние
 * пароля (tweb `privacyAndSecurity.tsx:257-271`). Перечитывания своего у экрана
 * нет: конец мастера срезает его из истории (`sliceTabsUntilTab(AppSettingsTab)`,
 * пин — `sidebarLeft/reactScreenTab.wiring.test.tsx`), и следующее открытие
 * собирает его заново, как у tweb.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import lang from '@/lang'
import type { PasswordState } from '../../core/managers/authManager'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { AppTwoStepVerificationEnterPasswordTab, AppTwoStepVerificationTab } from '../solidJsTabs/tabs'
import type SliderSuperTab from '../sliderTab'
import PrivacySecuritySettings from './PrivacySecuritySettings'

const open = vi.fn(async() => {})
const createTab = vi.fn(() => ({ open }))
const tab = { slider: { createTab } } as unknown as SliderSuperTab

let passwordState: ReturnType<typeof vi.fn<() => Promise<PasswordState>>>

function renderScreen() {
  const managers = {
    auth: { passwordState, passkeysList: async() => [] },
    privacy: { autoDelete: async() => 0 },
  }
  return render(
    <ManagersProvider managers={managers as never}>
      <PrivacySecuritySettings tab={tab} onBack={() => {}} />
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
  createTab.mockClear()
  open.mockClear()
})

afterEach(cleanup)

describe('«Конфиденциальность» → мастер 2FA', () => {
  it('пароль включён — вкладка ввода текущего пароля с состоянием', async() => {
    const state: PasswordState = { enabled: true, hint: 'кот', email: '' }
    passwordState = vi.fn(async() => state)
    const { container, findByText } = renderScreen()
    await findByText(lang['PrivacyAndSecurity.Item.On'])

    fireEvent.click(twoStepRow(container))
    expect(createTab).toHaveBeenCalledWith(AppTwoStepVerificationEnterPasswordTab)
    expect(open).toHaveBeenCalledWith({ state })
  })

  it('пароля нет — главная вкладка 2FA с состоянием', async() => {
    passwordState = vi.fn(async() => ({ enabled: false, hint: '', email: '' }))
    const { container, findByText } = renderScreen()
    await findByText(lang.Off)

    fireEvent.click(twoStepRow(container))
    expect(createTab).toHaveBeenCalledWith(AppTwoStepVerificationTab)
    expect(open).toHaveBeenCalledWith({ state: { enabled: false, hint: '', email: '' } })
  })

  it('пока состояние не пришло, строка ничего не открывает (tweb twoFactorFrozen)', () => {
    passwordState = vi.fn(() => new Promise<PasswordState>(() => {}))
    const { container } = renderScreen()
    fireEvent.click(twoStepRow(container))
    expect(createTab).not.toHaveBeenCalled()
  })
})
