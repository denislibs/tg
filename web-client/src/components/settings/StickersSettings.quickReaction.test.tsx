/**
 * ПИН НА ДОСТИЖИМОСТЬ «Быстрой реакции».
 *
 * До задачи 14 плана 2D экран «Быстрая реакция» существовал, но открыть его было
 * нечем: единственный вход — мок-строка `SCREENS` прежнего React-роутера подэкранов, чью
 * ветку рендера перехватывали «Общие» (поправка 10 плана). У tweb вход один —
 * строка `DoubleTapSetting` экрана «Стикеры и эмодзи» (`stickersAndEmoji.tsx:60-66`,
 * `clickable={() => tab.slider.createTab(AppQuickReactionTab).open()}`).
 *
 * Экран «Стикеры и эмодзи» пока React (переезд — задача 15), но уже содержимое
 * вкладки `AppStickersAndEmojiTab` (мост `sidebarLeft/reactScreenTab.tsx`), и
 * вкладку он открывает слайдером своей вкладки, как оригинал. Слайдер здесь —
 * заглушка; проверяется, что строка ЕСТЬ, стоит первой, как у оригинала, и
 * открывает именно `AppQuickReactionTab` ровно один раз. Уходит вместе с экраном
 * в задаче 15.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

import type { ReactNode } from 'react'

import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { ManagersProvider } from '@core/hooks/useManagers'
import { AppQuickReactionTab } from '../solidJsTabs/tabs'
import type SliderSuperTab from '../sliderTab'
import StickersSettings from './StickersSettings'

const open = vi.fn(async() => undefined)
const createTab = vi.fn(() => ({ open }))
const tab = { slider: { createTab } } as unknown as SliderSuperTab

const managers = {
  stickers: { mySets: async() => [], searchSets: async() => ({ sets: [] }) },
} as unknown as Managers

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

describe('«Стикеры и эмодзи» → «Быстрая реакция»', () => {
  afterEach(() => {
    cleanup()
    createTab.mockClear()
    open.mockClear()
  })

  it('строка DoubleTapSetting — первая в первой секции', () => {
    const { container } = render(<StickersSettings tab={tab} onBack={() => {}} />, { wrapper })

    const firstRow = container.querySelector('.row')!
    expect(firstRow.textContent).toBe(lang.DoubleTapSetting)
  })

  it('клик открывает вкладку AppQuickReactionTab ровно один раз', () => {
    render(<StickersSettings tab={tab} onBack={() => {}} />, { wrapper })

    fireEvent.click(screen.getByText(lang.DoubleTapSetting))

    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith(AppQuickReactionTab)
    expect(open).toHaveBeenCalledTimes(1)
  })
})
