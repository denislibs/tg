// Колонка папок зеркалит градиент обоев в свой холст — порт tweb
// foldersSidebarContent/index.tsx:94-116 (`renderer.attachMirror(backgroundCanvas)`).
// Без зеркала колонка безусловно уходила в дорогую ветку
// `backdrop-filter: blur(40px)`: у нас она стояла в SCSS статикой, поэтому
// «нет зеркала» не отличалось от «есть».
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import FoldersSidebar, { type MainMenuHandlers } from './FoldersSidebar'
import { setActiveGradientRenderer } from '../../core/chat/activeGradient'
import type ChatBackgroundGradientRenderer from '../../core/chat/gradientRenderer'
import s from './FoldersSidebar.module.scss'

// Главное меню тянет менеджеры воркера (useManagers) — к зеркалу градиента
// отношения не имеет, подменяем заглушкой.
vi.mock('../MainMenu', () => ({ default: () => null }))

const menu: MainMenuHandlers = {
  onOpenSettings: () => {},
  onOpenContacts: () => {},
  onOpenSaved: () => {},
  onOpenPremium: () => {},
}

function renderSidebar() {
  const host = document.createElement('div')
  host.id = 'main-columns'
  document.body.append(host)
  const r = render(
    <FoldersSidebar
      folders={[]}
      selectedId={0}
      counts={{}}
      onSelect={() => {}}
      onContextMenu={() => {}}
      onOpenFolderSettings={() => {}}
      menu={menu}
    />,
  )
  return { host, ...r }
}

afterEach(() => {
  act(() => setActiveGradientRenderer(undefined))
  cleanup()
  document.getElementById('main-columns')?.remove()
})

describe('FoldersSidebar — зеркало градиента обоев', () => {
  it('активные обои с градиентом → холст колонки цепляется зеркалом', () => {
    const detach = vi.fn()
    const attachMirror = vi.fn(() => detach)
    act(() => setActiveGradientRenderer(
      { attachMirror } as unknown as ChatBackgroundGradientRenderer,
      { isDarkMaskPattern: false },
    ))

    const { host } = renderSidebar()

    const canvas = host.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(attachMirror).toHaveBeenCalledWith(canvas)
    // Зеркало есть — ветка --no-gradient (backdrop-filter) выключена.
    expect(host.querySelector(`.${s.backgroundNoGradient}`)).toBeNull()
  })

  it('обои без градиента (картинка/цвет) — падаем обратно на backdrop-filter', () => {
    act(() => setActiveGradientRenderer(undefined))
    const { host } = renderSidebar()

    expect(host.querySelector(`.${s.backgroundNoGradient}`)).not.toBeNull()
  })

  it('смена обоев отцепляет прошлое зеркало и цепляет новое; тёмный узор дотемняет тинт', () => {
    const detach = vi.fn()
    const first = { attachMirror: vi.fn(() => detach) } as unknown as ChatBackgroundGradientRenderer
    act(() => setActiveGradientRenderer(first, { isDarkMaskPattern: false }))
    const { host } = renderSidebar()

    const second = { attachMirror: vi.fn(() => vi.fn()) } as unknown as ChatBackgroundGradientRenderer
    act(() => setActiveGradientRenderer(second, { isDarkMaskPattern: true }))

    expect(detach).toHaveBeenCalledTimes(1)
    expect(second.attachMirror).toHaveBeenCalledWith(host.querySelector('canvas'))
    expect(host.querySelector(`.${s.backgroundDarkPattern}`)).not.toBeNull()
  })
})
