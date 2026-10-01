// Пин: экран поиска правой колонки (стикеры/GIF) обязан сужать чат тем же
// классом body.is-right-column-shown, что и панель профиля — иначе (баг из ТЗ)
// панель ложится ПОВЕРХ чата вместо того, чтобы его сузить
// (styles/tweb/_chat.scss:438,458,513 — сдвиг #column-center только под этим
// классом). Класс пишет только `AppSidebarRight` (`sidebarRight/index.ts`),
// экран просит его мостом `useRightColumnShown` (ВРЕМЕННО до 0б-11); колонка,
// открытая до экрана (профиль), его закрытие переживает — сам мост покрыт в
// useRightColumnShown.test.ts, здесь пинится, что RightSearchTab им пользуется.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import appNavigationController from '@core/navigation/appNavigationController'
import type { AppSidebarRight } from '@components/sidebarRight'
import { installSidebarRight } from '../../test/sidebarRight'
import RightSearchTab from './RightSearchTab'

const noop = () => {}
const shown = () => document.body.classList.contains('is-right-column-shown')
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

const renderTab = () => render(
  <RightSearchTab id="stickers-container" placeholder="StickersTab.SearchPlaceholder" value="" onChange={noop} onClose={noop}>
    {null}
  </RightSearchTab>,
)

describe('RightSearchTab и сдвиг контента', () => {
  it('пока открыт (смонтирован), на body висит класс сужения чата', () => {
    renderTab()
    expect(shown()).toBe(true)
  })

  it('снимает класс при размонтировании (закрытии), если колонку открывал он', () => {
    const { unmount } = renderTab()
    unmount()
    expect(shown()).toBe(false)
  })

  it('не снимает класс при закрытии, пока открыт профиль, бывший до него', () => {
    void sidebar.toggleSidebar(true)
    const { unmount } = renderTab()
    unmount()
    expect(shown()).toBe(true)
  })
})
