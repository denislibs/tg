/**
 * Врезка вкладок правил приватности в React-экран «Конфиденциальность» (задача 17
 * плана 2D): строка правила открывает вкладку слайдера через хост, как tweb
 * `privacyAndSecurity.tsx:416-466` (`tab.slider.createTab(AppPrivacy…Tab).open()`),
 * а не React-подэкран. Уходит вместе с экраном в задаче 23.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import lang from '@/lang'
import { ManagersProvider } from '../../core/hooks/useManagers'
import {
  AppPrivacyAboutTab,
  AppPrivacyAddToGroupsTab,
  AppPrivacyBirthdayTab,
  AppPrivacyCallsTab,
  AppPrivacyForwardMessagesTab,
  AppPrivacyLastSeenTab,
  AppPrivacyMessagesTab,
  AppPrivacyPhoneNumberTab,
  AppPrivacyProfilePhotoTab,
  AppPrivacyReadTimeTab,
  AppPrivacyVoicesTab,
} from '../solidJsTabs/tabs'
import PrivacySecuritySettings from './PrivacySecuritySettings'

const host = vi.hoisted(() => ({
  openTab: vi.fn(async() => ({})),
  onTabsEmpty: vi.fn(() => () => {}),
}))
vi.mock('../sidebarLeft/settingsSliderHost', () => ({
  getSettingsSliderHost: () => host,
  openActiveSessionsTab: vi.fn(),
}))

function renderScreen() {
  const managers = {
    auth: { passwordState: () => new Promise(() => {}), passkeysList: async() => [] },
    privacy: { autoDelete: async() => 0 },
  }
  return render(
    <ManagersProvider managers={managers as never}>
      <PrivacySecuritySettings onBack={() => {}} />
    </ManagersProvider>,
  )
}

function rowByTitle(container: HTMLElement, title: string) {
  const el = [...container.querySelectorAll<HTMLElement>('.row-title')].find((n) => n.textContent === title)
  expect(el, title).toBeDefined()
  return el!.closest<HTMLElement>('.row')!
}

beforeEach(() => host.openTab.mockClear())
afterEach(cleanup)

describe('«Конфиденциальность» → вкладки правил', () => {
  it.each([
    ['PrivacyPhoneTitle', AppPrivacyPhoneNumberTab],
    ['LastSeenTitle', AppPrivacyLastSeenTab],
    ['PrivacyProfilePhotoTitle', AppPrivacyProfilePhotoTab],
    ['Privacy.BioRow', AppPrivacyAboutTab],
    ['WhoCanCallMe', AppPrivacyCallsTab],
    ['PrivacyForwardsTitle', AppPrivacyForwardMessagesTab],
    ['PrivacyGroupsTitle', AppPrivacyAddToGroupsTab],
    ['PrivacyVoiceMessagesTitle', AppPrivacyVoicesTab],
    ['PrivacyMessagesTitle', AppPrivacyMessagesTab],
    ['Privacy.BirthdayRow', AppPrivacyBirthdayTab],
    ['PrivacyReadTimeTitle', AppPrivacyReadTimeTab],
  ] as const)('строка %s открывает свою вкладку через хост', (title, tab) => {
    const { container } = renderScreen()
    fireEvent.click(rowByTitle(container, lang[title]))
    expect(host.openTab).toHaveBeenCalledTimes(1)
    expect(host.openTab).toHaveBeenCalledWith(tab)
  })
})
