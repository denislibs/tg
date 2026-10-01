// src/core/hooks/useRightColumnShown.test.ts — мост экрана поиска стикеров/GIF
// к `AppSidebarRight` (ВРЕМЕННО до 0б-11). Класс настоящий, на настоящем
// `#column-right`: мост обязан ходить через `toggleSidebar`, писателя класса
// на body у него своего нет (скан — `sidebarRight/index.test.ts`).
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import appNavigationController from '@core/navigation/appNavigationController'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME, type AppSidebarRight } from '@components/sidebarRight'
import { installSidebarRight } from '../../test/sidebarRight'
import { useRightColumnShown } from './useRightColumnShown'

const shown = () => document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)
let sidebar: AppSidebarRight
let column: ReturnType<typeof installSidebarRight>

beforeEach(() => {
  vi.useFakeTimers()
  column = installSidebarRight()
  sidebar = column.sidebar
})

afterEach(() => {
  cleanup()
  column.dispose()
  vi.advanceTimersByTime(2000)
  appNavigationController.spliceItems(0, Infinity)
  vi.advanceTimersByTime(2000)
  vi.useRealTimers()
  document.body.className = ''
  document.body.replaceChildren()
})

describe('useRightColumnShown — мост к AppSidebarRight', () => {
  it('колонка закрыта: монтирование открывает её классом, размонтирование — закрывает', () => {
    const spy = vi.spyOn(sidebar, 'toggleSidebar')
    const { unmount } = renderHook(() => useRightColumnShown())
    expect(spy).toHaveBeenLastCalledWith(true)
    expect(shown()).toBe(true)
    unmount()
    expect(spy).toHaveBeenLastCalledWith(false)
    expect(shown()).toBe(false)
  })

  it('колонка уже открыта (профиль): закрытие поиска её не трогает', () => {
    void sidebar.toggleSidebar(true)
    const { unmount } = renderHook(() => useRightColumnShown())
    unmount()
    expect(shown()).toBe(true)
  })
})
