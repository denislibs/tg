/**
 * Врезка вкладки «Автоудаление» в React-экран «Конфиденциальность» (задача 20
 * плана 2D): строка `AutoDeleteMessages` открывает `AppMessagesAutoDeleteTab`
 * слайдером своей вкладки с текущим периодом, как tweb `privacyAndSecurity.tsx:238-247`,
 * а `onSaved` обновляет подпись строки (`:370-376`). Пока период не пришёл —
 * строка «заморожена» (`autoDeleteFrozen`). Уходит вместе с экраном в задаче 23.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import lang from '@/lang'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { AppMessagesAutoDeleteTab } from '../solidJsTabs/tabs'
import type SliderSuperTab from '../sliderTab'
import PrivacySecuritySettings from './PrivacySecuritySettings'

const DAY = 86400

const open = vi.fn(async(_payload: { period: number, onSaved: (period: number) => void }) => {})
const createTab = vi.fn(() => ({ open }))
const screenTab = { slider: { createTab } } as unknown as SliderSuperTab

function renderScreen(autoDelete: () => Promise<number>) {
  const managers = {
    auth: { passwordState: () => new Promise(() => {}), passkeysList: async() => [] },
    privacy: { getBlocked: async() => ({ count: 0, peerIds: [] }), autoDelete },
  }
  return render(
    <ManagersProvider managers={managers as never}>
      <PrivacySecuritySettings tab={screenTab} onBack={() => {}} />
    </ManagersProvider>,
  )
}

function autoDeleteRow(container: HTMLElement) {
  const el = [...container.querySelectorAll<HTMLElement>('.row-title')].find((n) => n.textContent === lang.AutoDeleteMessages)
  expect(el).toBeDefined()
  return el!.closest<HTMLElement>('.row')!
}

beforeEach(() => {
  createTab.mockClear()
  open.mockClear()
})
afterEach(cleanup)

describe('«Конфиденциальность» → вкладка «Автоудаление»', () => {
  it('строка открывает вкладку с текущим периодом; onSaved обновляет подпись', async() => {
    const { container } = renderScreen(async() => 3 * DAY)
    const row = autoDeleteRow(container)
    await vi.waitFor(() => expect(row.textContent).toContain('3 days'))

    fireEvent.click(row)
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith(AppMessagesAutoDeleteTab)
    expect(open).toHaveBeenCalledTimes(1)
    const payload = open.mock.calls[0][0]
    expect(payload.period).toBe(3 * DAY)

    act(() => payload.onSaved(0))
    expect(autoDeleteRow(container).textContent).toContain(lang.Off)
    act(() => payload.onSaved(31 * DAY))
    expect(autoDeleteRow(container).textContent).toContain('1 month')
  })

  it('пока период не пришёл, строка ничего не открывает', () => {
    const { container } = renderScreen(() => new Promise(() => {}))
    fireEvent.click(autoDeleteRow(container))
    expect(createTab).not.toHaveBeenCalled()
  })
})
