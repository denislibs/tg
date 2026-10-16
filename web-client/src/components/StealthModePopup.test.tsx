// Окно режима «невидимка»: длительности строк берутся из конфига приложения
// (`stories_stealth_past_period` / `_future_period`, секунды — tweb
// `popups/storiesStealthMode.tsx:58`, `:65`), а не из зашитых подписей.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StealthModePopup from './StealthModePopup'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'

function renderWith(config: { stories_stealth_past_period?: number, stories_stealth_future_period?: number }) {
  const managers = {
    stories: { stealthState: vi.fn().mockResolvedValue({}), activateStealth: vi.fn() },
    appConfig: { getAppConfig: vi.fn().mockResolvedValue(config) },
  } as unknown as Managers
  return render(
    <ManagersProvider managers={managers}>
      <StealthModePopup onClose={() => {}} />
    </ManagersProvider>,
  )
}

describe('StealthModePopup', () => {
  afterEach(cleanup)

  // Значения НЕ совпадают с 300/1500, которые сервер отдаёт сейчас: подпись
  // «5 min»/«25 min» из кода не пройдёт.
  it('длительности строк — из конфига: 120 с → «2 minutes», 3600 с → «1 hour»', async () => {
    renderWith({ stories_stealth_past_period: 120, stories_stealth_future_period: 3600 })

    expect(await screen.findByText('Hide my views from the past 2 minutes.')).toBeTruthy()
    expect(await screen.findByText('Hide my views for the next 1 hour.')).toBeTruthy()
  })

  it('300 с и 1500 с (значения сервера) — «5 minutes» и «25 minutes»', async () => {
    renderWith({ stories_stealth_past_period: 300, stories_stealth_future_period: 1500 })

    expect(await screen.findByText('Hide my views from the past 5 minutes.')).toBeTruthy()
    expect(await screen.findByText('Hide my views for the next 25 minutes.')).toBeTruthy()
  })
})
