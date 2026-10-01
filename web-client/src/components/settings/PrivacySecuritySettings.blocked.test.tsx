/**
 * Врезка вкладки «Заблокированные» в React-экран «Конфиденциальность» (задача 22
 * плана 2D): первая страница чёрного списка грузится заранее и уезжает во
 * вкладку полезной нагрузкой (tweb `privacyAndSecurity.tsx:130-139`, `:217`);
 * пока она не пришла, строка «заморожена»; `peer_block` перечитывает страницу
 * (`:313-337`). Уходит вместе с экраном в задаче 23.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import { usePrivacyStore } from '@stores/privacyStore'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { AppBlockedUsersTab } from '../solidJsTabs/tabs'
import type SliderSuperTab from '../sliderTab'
import PrivacySecuritySettings from './PrivacySecuritySettings'

const open = vi.fn(async() => {})
const createTab = vi.fn(() => ({ open }))
const screenTab = { slider: { createTab } } as unknown as SliderSuperTab

let getBlocked: ReturnType<typeof vi.fn>

function renderScreen() {
  const managers = {
    auth: { passwordState: () => new Promise(() => {}), passkeysList: async() => [] },
    privacy: { getBlocked, autoDelete: async() => 0 },
  }
  return render(
    <ManagersProvider managers={managers as never}>
      <PrivacySecuritySettings tab={screenTab} onBack={() => {}} />
    </ManagersProvider>,
  )
}

const blockedRow = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.row-title')]
  .find((n) => n.textContent === lang.BlockedUsers)!.closest<HTMLElement>('.row')!

const flush = () => act(async() => { for(let i = 0; i < 5; ++i) await Promise.resolve() })

beforeEach(() => {
  createTab.mockClear()
  open.mockClear()
  usePrivacyStore.setState({ blockedTotal: 0 })
})
afterEach(cleanup)

describe('«Конфиденциальность» → «Заблокированные»', () => {
  it('до ответа строка заморожена; после — открывает AppBlockedUsersTab с первой страницей', async() => {
    let resolve!: (v: { count: number, peerIds: PeerId[] }) => void
    getBlocked = vi.fn(() => new Promise((r) => { resolve = r }))
    const { container } = renderScreen()

    fireEvent.click(blockedRow(container))
    expect(createTab).not.toHaveBeenCalled()

    resolve({ count: 3, peerIds: [5, 9, 7] })
    await flush()
    fireEvent.click(blockedRow(container))
    expect(createTab).toHaveBeenCalledWith(AppBlockedUsersTab)
    expect(open).toHaveBeenCalledWith({ peerIds: [5, 9, 7] })
    expect(usePrivacyStore.getState().blockedTotal).toBe(3)
  })

  it('peer_block перечитывает первую страницу и счётчик', async() => {
    getBlocked = vi.fn(async() => ({ count: 1, peerIds: [5] }))
    const { container } = renderScreen()
    await flush()

    getBlocked.mockResolvedValue({ count: 2, peerIds: [6, 5] })
    rootScope.dispatchEventSingle('peer_block', { peerId: 6, blocked: true })
    await flush()

    expect(getBlocked).toHaveBeenCalledTimes(2)
    expect(usePrivacyStore.getState().blockedTotal).toBe(2)
    fireEvent.click(blockedRow(container))
    expect(open).toHaveBeenCalledWith({ peerIds: [6, 5] })
  })
})
